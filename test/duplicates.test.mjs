import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const ops = await import('../server/ops.mjs')
  return { tmp, store, ops }
}

function makeNodes(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  const t2 = store.createNode({ parentId: s.id, type: 'task', name: 'T2' })
  return { r, s, t, t2 }
}

function gitExec(dir, cmd) {
  return execSync(`git ${cmd}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

test('duplicates：同 sha 跨节点重复 + 一键去重（保留最早，安全校验）', async (t) => {
  const { tmp, store, ops } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-dup-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  gitExec(dir, 'init -q')
  gitExec(dir, 'config user.email t@t.local')
  gitExec(dir, 'config user.name t')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n')
  gitExec(dir, 'add -A && git commit -q -m c1')
  const sha = gitExec(dir, 'rev-parse HEAD')

  const { t: task, t2: task2 } = makeNodes(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const c1 = store.addCommit(task.id, { repo: 'demo', sha, note: 'worktree 登记' })
  const c2 = store.addCommit(task2.id, { repo: 'demo', sha, note: '需求分支重复登记' })

  const res = await ops.getNodeDuplicates(store, task.id, { scope: 'self' })
  assert.equal(res.groupCount, 1)
  const item = res.items.find((i) => i.cid === c1.id)
  assert.ok(item, 'c1 应有重复标记')
  const rel = item.related.find((r) => r.cid === c2.id)
  assert.ok(rel)
  assert.equal(rel.relation, 'same-sha')

  // 去重：保留 c1 删除 c2
  const deduped = store.dedupeCommits({ keepId: c1.id, removeIds: [c2.id] })
  assert.deepEqual(deduped.removed, [c2.id])
  assert.equal(store.listCommits(task2.id).length, 0)

  // 安全校验：不相关的不允许删
  const c3 = store.addCommit(task.id, { repo: 'demo', sha: 'feedbeef1', note: 'nope' })
  assert.throws(
    () => store.dedupeCommits({ keepId: c1.id, removeIds: [c3.id] }),
    (e) => e.code === 'VALIDATION_FAILED'
  )
})

test('duplicates：patch-id（同内容不同 sha——cherry-pick 场景）', async (t) => {
  const { tmp, store, ops } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-dup-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  gitExec(dir, 'init -q')
  gitExec(dir, 'config user.email t@t.local')
  gitExec(dir, 'config user.name t')
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n')
  gitExec(dir, 'add -A && git commit -q -m base')
  const mainBranch = gitExec(dir, 'rev-parse --abbrev-ref HEAD')
  // 分支 A 上新增 f.txt
  gitExec(dir, 'checkout -q -b branch-a')
  fs.writeFileSync(path.join(dir, 'f.txt'), 'feature change\n')
  gitExec(dir, 'add -A && git commit -q -m feat-a')
  const shaA = gitExec(dir, 'rev-parse HEAD')
  // 回主分支写相同内容（不同 sha、相同 diff/patch-id）
  gitExec(dir, `checkout -q ${mainBranch}`)
  fs.writeFileSync(path.join(dir, 'f.txt'), 'feature change\n')
  gitExec(dir, 'add -A && git commit -q -m feat-b')
  const shaB = gitExec(dir, 'rev-parse HEAD')
  assert.notEqual(shaA, shaB)

  const { t: task, t2: task2 } = makeNodes(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const a = store.addCommit(task.id, { repo: 'demo', sha: shaA })
  const b = store.addCommit(task2.id, { repo: 'demo', sha: shaB })

  const res = await ops.getNodeDuplicates(store, task.id, { scope: 'self' })
  const item = res.items.find((i) => i.cid === a.id)
  assert.ok(item, '应检测出 patch-id 重复')
  assert.equal(item.related.find((r) => r.cid === b.id).relation, 'patch-id')

  // 基于 patch-id 也可去重
  const deduped = store.dedupeCommits({ keepId: a.id, removeIds: [b.id] })
  assert.deepEqual(deduped.removed, [b.id])
})

test('duplicates：merge 覆盖（merge 提交包含已登记提交）', async (t) => {
  const { tmp, store, ops } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-dup-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  gitExec(dir, 'init -q')
  gitExec(dir, 'config user.email t@t.local')
  gitExec(dir, 'config user.name t')
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n')
  gitExec(dir, 'add -A && git commit -q -m base')
  const mainBranch = gitExec(dir, 'rev-parse --abbrev-ref HEAD')
  gitExec(dir, 'checkout -q -b worktree-branch')
  fs.writeFileSync(path.join(dir, 'w.txt'), 'wt\n')
  gitExec(dir, 'add -A && git commit -q -m wt-1')
  const wtSha = gitExec(dir, 'rev-parse HEAD')
  gitExec(dir, `checkout -q ${mainBranch}`)
  gitExec(dir, 'merge -q --no-ff worktree-branch -m "Merge branch worktree-branch"')
  const mergeSha = gitExec(dir, 'rev-parse HEAD')

  const { s, t: task, t2: task2 } = makeNodes(store)
  store.addRepo({ name: 'demo', localPath: dir })
  // 子任务登记了 worktree 提交；需求节点登记了合并提交
  const w = store.addCommit(task.id, { repo: 'demo', sha: wtSha, note: 'worktree 实现' })
  const m = store.addCommit(task2.id, { repo: 'demo', sha: mergeSha, note: '合并子任务' })

  const res = await ops.getNodeDuplicates(store, s.id, { scope: 'subtree' })
  const item = res.items.find((i) => i.cid === m.id)
  assert.ok(item, 'merge 提交应带覆盖标记')
  const covers = item.related.find((r) => r.cid === w.id && r.relation === 'merge-covers')
  assert.ok(covers, '应链接到被覆盖的 worktree 提交')
})
