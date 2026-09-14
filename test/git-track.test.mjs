import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tempHome } from './helpers.mjs'

/** 临时 git 仓库：main + feature（feature 上有新提交 b，默认未合并回 main） */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-track-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])
  g(['checkout', '-q', '-b', 'feature'])
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat: b'])
  const featureSha = g(['rev-parse', '--short', 'HEAD']).trim()
  g(['checkout', '-q', 'main'])
  return { dir, g, featureSha }
}

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const ops = await import('../server/ops.mjs')
  const git = await import('../server/git.mjs')
  return { tmp, store, ops, git }
}

function makeTask(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return { p, r, s, t }
}

test('branchContains：未合并 false → merge 后 true；分支缺失 ref-not-found', async (t) => {
  const { tmp, git } = await setup()
  const { dir, g, featureSha } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  let r = await git.branchContains(dir, featureSha, 'main')
  assert.equal(r.contained, false)
  assert.equal(r.ref, 'refs/heads/main')

  g(['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature'])
  r = await git.branchContains(dir, featureSha, 'main')
  assert.equal(r.contained, true)

  const miss = await git.branchContains(dir, featureSha, 'no-such-branch')
  assert.equal(miss.contained, null)
  assert.equal(miss.reason, 'ref-not-found')

  const empty = await git.branchContains(dir, featureSha, null)
  assert.equal(empty.contained, null)
  assert.equal(empty.reason, 'not-configured')
})

test('branchContains 支持 tag 目标', async (t) => {
  const { tmp, git } = await setup()
  const { dir, g, featureSha } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  // 指向 feature 提交的 tag → 包含
  g(['tag', 'v-test-1', featureSha])
  const r = await git.branchContains(dir, featureSha, 'v-test-1')
  assert.equal(r.contained, true)
  assert.equal(r.ref, 'refs/tags/v-test-1')
  // 指向 main HEAD（不含 feature 提交）的 tag → 不包含
  const mainHead = g(['rev-parse', 'main']).trim()
  g(['tag', 'v-main-0', mainHead])
  const r2 = await git.branchContains(dir, featureSha, 'v-main-0')
  assert.equal(r2.contained, false)
  assert.equal(r2.ref, 'refs/tags/v-main-0')
})

test('getCommitTrack：读出仓库三分支配置并检测', async (t) => {
  const { tmp, store, ops } = await setup()
  const { dir, featureSha } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir, testBranch: 'main', releaseBranch: 'release-x' })
  const commit = store.addCommit(task.id, { repo: 'demo', sha: featureSha, note: '未合并提交' })

  const out = await ops.getCommitTrack(store, commit.id)
  assert.equal(out.track.test.contained, false)
  assert.equal(out.track.pre.contained, null)
  assert.equal(out.track.pre.reason, 'not-configured')
  assert.equal(out.track.release.contained, null)
  assert.equal(out.track.release.reason, 'ref-not-found')
})

test('getNodeTracks：子树聚合、按 (repo, sha) 去重、回填 track', async (t) => {
  const { tmp, store, ops } = await setup()
  const { dir, featureSha } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { s, t: task1 } = makeTask(store)
  const task2 = store.createNode({ parentId: s.id, type: 'task', name: 'T2' })
  store.addRepo({ name: 'demo', localPath: dir, testBranch: 'main' })
  store.addCommit(task1.id, { repo: 'demo', sha: featureSha })
  store.addCommit(task2.id, { repo: 'demo', sha: featureSha }) // 同 (repo, sha) 去重

  const out = await ops.getNodeTracks(store, s.id, { scope: 'subtree' })
  assert.equal(out.count, 1)
  assert.equal(out.items[0].sourceNodes.length, 2)
  assert.equal(out.items[0].track.test.contained, false)
  assert.equal(out.items[0].error, null)
})

test('addRepo / updateRepo 支持分支字段与 tags', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  const repo = store.addRepo({ name: 'demo', testBranch: 'develop', tags: '后端' })
  assert.equal(repo.testBranch, 'develop')
  assert.equal(repo.preBranch, null)
  assert.equal(repo.tags, '后端')
  const updated = store.updateRepo(repo.id, { preBranch: 'pre', releaseBranch: 'master', tags: '前端,后端' })
  assert.equal(updated.preBranch, 'pre')
  assert.equal(updated.releaseBranch, 'master')
  assert.equal(updated.testBranch, 'develop')
  assert.equal(updated.tags, '前端,后端')
})

test('commit review：状态更新与审者记录', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo' })
  const c = store.addCommit(task.id, { repo: 'demo', sha: 'abcdef1' })
  assert.equal(c.reviewStatus, 'pending')

  const r1 = store.updateCommitReview(c.id, { reviewStatus: 'approved' }, 'idea')
  assert.equal(r1.reviewStatus, 'approved')
  assert.equal(r1.reviewedBy, 'idea')
  assert.ok(r1.reviewedAt)

  const r2 = store.updateCommitReview(c.id, { reviewStatus: 'issue', note: '变量命名需调整' }, 'idea')
  assert.equal(r2.reviewStatus, 'issue')
  assert.equal(r2.reviewNote, '变量命名需调整')

  const r3 = store.updateCommitReview(c.id, { reviewStatus: 'pending' }, 'idea')
  assert.equal(r3.reviewStatus, 'pending')
  assert.equal(r3.reviewedBy, null)
  assert.equal(r3.reviewedAt, null)

  assert.throws(() => store.updateCommitReview(c.id, { reviewStatus: 'xx' }), (e) => e.code === 'VALIDATION_FAILED')
})

test('标签级分支配置 CRUD + resolveBranchTargets 继承/覆盖', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  // 新增与更新（同一标签 upsert）
  store.upsertBranchConfig('后端', { testBranch: 'develop', releaseBranch: 'master' })
  const cfg2 = store.upsertBranchConfig('后端', { testBranch: 'develop2', releaseBranch: 'master' })
  assert.equal(cfg2.testBranch, 'develop2')
  assert.equal(store.listBranchConfigs().length, 1)

  // 仓库通过标签继承
  const repo = store.addRepo({ name: 'demo', tags: '后端' })
  let targets = store.resolveBranchTargets(repo)
  assert.equal(targets.source, 'tag:后端')
  assert.equal(targets.test, 'develop2')
  assert.equal(targets.release, 'master')

  // 仓库级（任一非空）优先
  const repo2 = store.addRepo({ name: 'demo2', tags: '后端', testBranch: 'own-branch' })
  targets = store.resolveBranchTargets(repo2)
  assert.equal(targets.source, 'repo')
  assert.equal(targets.test, 'own-branch')

  // 多标签：取第一个有配置的
  store.upsertBranchConfig('前端', { testBranch: 'fe-dev' })
  const repo3 = store.addRepo({ name: 'demo3', tags: '小程序,前端' })
  targets = store.resolveBranchTargets(repo3)
  assert.equal(targets.source, 'tag:前端')
  assert.equal(targets.test, 'fe-dev')

  // 无标签 / 无配置 → 全空
  const repo4 = store.addRepo({ name: 'demo4' })
  targets = store.resolveBranchTargets(repo4)
  assert.equal(targets.source, null)
  assert.equal(targets.test, null)

  // 删除（不存在时 NOT_FOUND）
  store.deleteBranchConfig('前端')
  assert.equal(store.listBranchConfigs().length, 1)
  assert.throws(() => store.deleteBranchConfig('前端'), (e) => e.code === 'NOT_FOUND')
})

// ---------- pickBranchForCommit：开发分支推断 ----------

test('pickBranchForCommit：按提交 message 的需求编号选分支，避免误判最长的集成分支', async (t) => {
  const { tmp, git } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-pick-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])

  // 需求 3.1.1 的开发分支；提交 subject 里带需求编号
  g(['checkout', '-q', '-b', 'feature-send-receive-3.1.1-inner-buy-flag'])
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat(3.1.1): inner buy flag'])
  const sha = g(['rev-parse', '--short', 'HEAD']).trim()

  // 一条更长的集成分支也包含该提交（仅按长度会选它，属误判）
  g(['checkout', '-q', '-b', 'feature-transfer-3.4.1-material-apply-id-fix'])
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'chore: integration'])

  const picked = await git.pickBranchForCommit(dir, sha)
  assert.equal(picked, 'feature-send-receive-3.1.1-inner-buy-flag')
})

test('pickBranchForCommit：merge 提交归属其合入目标分支', async (t) => {
  const { tmp, git } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-pick-merge-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])

  g(['checkout', '-q', '-b', 'feature-something'])
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat: something'])

  g(['checkout', '-q', 'main'])
  g(['checkout', '-q', '-b', 'feature-merge'])
  g(['merge', '-q', '--no-ff', '-m', "Merge branch 'feature-something' into feature-merge", 'feature-something'])
  const mergeSha = g(['rev-parse', '--short', 'HEAD']).trim()

  // 一条更长的集成分支也包含该 merge 提交：仅按长度会选它，merge 目标规则应选 feature-merge
  g(['checkout', '-q', '-b', 'feature-merge-longer-integration-branch'])
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'chore: more integration'])

  const picked = await git.pickBranchForCommit(dir, mergeSha)
  assert.equal(picked, 'feature-merge')
})

test('pickBranchForCommit：需求编号按版本号边界匹配，不被更长分支的版本号子串命中', async (t) => {
  const { tmp, git } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-pick-boundary-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])

  // 工单 1.1.1 的真实开发分支
  g(['checkout', '-q', '-b', 'feature-login-1.1.1'])
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat(1.1.1): login'])
  const sha = g(['rev-parse', '--short', 'HEAD']).trim()

  // 版本号 11.1.1 含子串 1.1.1，且分支更长——裸 includes 会误判到它
  g(['checkout', '-q', '-b', 'feature-other-11.1.1-integration-very-long-branch'])
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'chore: integration'])

  const picked = await git.pickBranchForCommit(dir, sha)
  assert.equal(picked, 'feature-login-1.1.1')
})

test('pickBranchForCommit：GitHub PR merge 归属 subject 里的源分支', async (t) => {
  const { tmp, git } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-pick-pr-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])

  g(['checkout', '-q', '-b', 'feature-login-1.1.1'])
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat(1.1.1): login'])

  // 模拟 GitHub「Create a merge commit」：subject 只带源分支，target 不在 subject 里
  g(['checkout', '-q', 'main'])
  g(['merge', '-q', '--no-ff', '-m', 'Merge pull request #12 from org/feature-login-1.1.1', 'feature-login-1.1.1'])
  const mergeSha = g(['rev-parse', '--short', 'HEAD']).trim()

  // 更长集成分支也含该提交：无 PR 规则时会回退到最长分支，属误判
  g(['checkout', '-q', '-b', 'feature-merge-longer-integration-branch-extra'])
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'chore: more integration'])

  const picked = await git.pickBranchForCommit(dir, mergeSha)
  assert.equal(picked, 'feature-login-1.1.1')
})

test('pickBranchForCommit：squash merge 无法推断源分支时回退最长 feature，可用显式 branch 覆盖', async (t) => {
  const { tmp, git, store } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-pick-squash-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'init'])

  // GitHub「Squash and merge」的产物：落在 main 上的一条普通提交，
  // 既无 merge 元数据、也无源分支名 —— 推断只能退化为最长 feature-*。
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat: login (#12)'])
  const squashSha = g(['rev-parse', '--short', 'HEAD']).trim()

  // 一条更长的集成分支也从 main 开出，同样包含该提交
  g(['checkout', '-q', '-b', 'feature-merge-longest-integration-branch'])
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'chore: integration'])

  // 无 merge 元数据 → 只能退化为最长 feature-*（约束：squash 推断不可靠）
  const picked = await git.pickBranchForCommit(dir, squashSha)
  assert.equal(picked, 'feature-merge-longest-integration-branch')

  // 显式 branch 覆盖路径：登记时传 branch 即写入真实开发分支
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const c = store.addCommit(task.id, { repo: 'demo', sha: squashSha, branch: 'feature-login-1.1.1' })
  assert.equal(c.branch, 'feature-login-1.1.1')
})
