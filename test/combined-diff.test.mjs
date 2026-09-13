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

function makeTask(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return { t }
}

function gitExec(dir, cmd) {
  return execSync(`git ${cmd}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

/** 造历史：commit0（不在选中）a.txt=v0；commit1 a.txt→line1；commit2 a.txt→line1\nline2 + b.txt 新增 */
function buildHistory(dir) {
  gitExec(dir, 'init -q')
  gitExec(dir, 'config user.email t@t.local')
  gitExec(dir, 'config user.name t')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v0\n')
  gitExec(dir, 'add -A')
  gitExec(dir, 'commit -q -m c0')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\n')
  gitExec(dir, 'add -A')
  gitExec(dir, 'commit -q -m c1')
  const sha1 = gitExec(dir, 'rev-parse HEAD')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\n')
  fs.writeFileSync(path.join(dir, 'b.txt'), 'new file\n')
  gitExec(dir, 'add -A')
  gitExec(dir, 'commit -q -m c2')
  const sha2 = gitExec(dir, 'rev-parse HEAD')
  return { sha1, sha2 }
}

test('combined-diff：文件并集、old=最早 commit 父版本、new=最新 commit 版本、统计相加', async (t) => {
  const { tmp, store, ops } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-combined-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { sha1, sha2 } = buildHistory(dir)
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const c1 = store.addCommit(task.id, { repo: 'demo', sha: sha1 })
  const c2 = store.addCommit(task.id, { repo: 'demo', sha: sha2 })

  const res = await ops.getCombinedDiff(store, [c1.id, c2.id])
  assert.equal(res.count, 2)
  assert.equal(res.repos.length, 1)
  // commit 明细（供 UI 展示：作者/时间/报告分支）
  assert.equal(res.commits.length, 2)
  const mc1 = res.commits.find((c) => c.sha === sha1)
  assert.equal(mc1.author, 't')
  assert.ok(mc1.date)
  assert.equal(mc1.repo, 'demo')
  const files = res.repos[0].files
  assert.equal(files.length, 2)

  const a = files.find((f) => f.path === 'a.txt')
  assert.equal(a.old, 'v0\n') // 最早选中 commit（c1）的父版本
  assert.equal(a.new, 'line1\nline2\n') // 最新选中 commit（c2）的版本
  assert.equal(a.additions, 2) // c1(+1/-1) + c2(+1/-0)
  assert.equal(a.deletions, 1)
  assert.equal(a.shas.length, 2)

  const b = files.find((f) => f.path === 'b.txt')
  assert.equal(b.old, '') // 新增文件：父版本为空
  assert.equal(b.new, 'new file\n')
  assert.equal(b.additions, 1)
  assert.equal(b.deletions, 0)
  assert.equal(b.shas.length, 1)
})

test('combined-diff：单个 cid 也能用（等价单 commit 净变更）；空 cids 报错', async (t) => {
  const { tmp, store, ops } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-combined-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { sha1 } = buildHistory(dir)
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const c1 = store.addCommit(task.id, { repo: 'demo', sha: sha1 })

  const res = await ops.getCombinedDiff(store, [c1.id])
  assert.equal(res.count, 1)
  const a = res.repos[0].files.find((f) => f.path === 'a.txt')
  assert.equal(a.old, 'v0\n')
  assert.equal(a.new, 'line1\n')

  await assert.rejects(() => ops.getCombinedDiff(store, []), (e) => e.code === 'VALIDATION_FAILED')
})
