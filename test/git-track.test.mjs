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

test('addRepo / updateRepo 支持分支字段', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  const repo = store.addRepo({ name: 'demo', testBranch: 'develop' })
  assert.equal(repo.testBranch, 'develop')
  assert.equal(repo.preBranch, null)
  const updated = store.updateRepo(repo.id, { preBranch: 'pre', releaseBranch: 'master' })
  assert.equal(updated.preBranch, 'pre')
  assert.equal(updated.releaseBranch, 'master')
  assert.equal(updated.testBranch, 'develop')
})
