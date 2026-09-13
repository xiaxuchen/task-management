import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tempHome } from './helpers.mjs'

/** 建一个临时 git 仓库：2 个 commit，第 2 个改 src/a.txt */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-git-'))
  const g = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  g(['init', '-q'])
  g(['config', 'user.email', 't@t.local'])
  g(['config', 'user.name', 't'])
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'line1\nline2\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat: init'])
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'line1\nline2 changed\nline3\n')
  g(['add', '.'])
  g(['commit', '-q', '-m', 'feat: change a'])
  return { dir, sha: g(['rev-parse', '--short', 'HEAD']).trim() }
}

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
  return { p, r, s, t }
}

test('getCommitDiff 读取本机 git：文件列表 / patch / old / new', async (t) => {
  const { tmp, store, ops } = await setup()
  const { dir, sha } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const commit = store.addCommit(task.id, { repo: 'demo', sha, note: '变更' })
  const out = await ops.getCommitDiff(store, commit.id)
  assert.equal(out.files.length, 1)
  const f = out.files[0]
  assert.equal(f.path, 'src/a.txt')
  assert.ok(f.patch.includes('+line2 changed'))
  assert.ok(f.old.includes('line2\n'))
  assert.ok(!f.old.includes('line2 changed'))
  assert.ok(f.new.includes('line2 changed'))
  assert.ok(out.subject.includes('change a'))
})

test('getCommitDiff：提交未标仓库 → REPO_NOT_REGISTERED', async (t) => {
  const { tmp, store, ops } = await setup()
  t.after(() => tmp.cleanup())
  const { t: task } = makeTask(store)
  const commit = store.addCommit(task.id, { sha: 'abcdef1' })
  await assert.rejects(
    () => ops.getCommitDiff(store, commit.id),
    (e) => e.code === 'REPO_NOT_REGISTERED'
  )
})

test('getCommitDiff：local_path 缺失或非 git 目录 → REPO_PATH_MISSING', async (t) => {
  const { tmp, store, ops } = await setup()
  const notGit = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-notgit-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(notGit, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'nodir', gitlabProject: 'x/y' })
  const c1 = store.addCommit(task.id, { repo: 'nodir', sha: 'abcdef1' })
  await assert.rejects(
    () => ops.getCommitDiff(store, c1.id),
    (e) => e.code === 'REPO_PATH_MISSING'
  )

  store.addRepo({ name: 'notgit', localPath: notGit })
  const c2 = store.addCommit(task.id, { repo: 'notgit', sha: 'abcdef1' })
  await assert.rejects(
    () => ops.getCommitDiff(store, c2.id),
    (e) => e.code === 'REPO_PATH_MISSING'
  )
})

test('getCommitDiff：sha 不存在 → GIT_FAILED', async (t) => {
  const { tmp, store, ops } = await setup()
  const { dir } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  const commit = store.addCommit(task.id, { repo: 'demo', sha: 'deadbeef' })
  await assert.rejects(
    () => ops.getCommitDiff(store, commit.id),
    (e) => e.code === 'GIT_FAILED'
  )
})

test('getNodeDiffs：子树聚合、按 (repo, sha) 去重、回填来源节点', async (t) => {
  const { tmp, store, ops } = await setup()
  const { dir, sha } = makeRepo()
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { s, t: task1 } = makeTask(store)
  const task2 = store.createNode({ parentId: s.id, type: 'task', name: 'T2' })
  store.addRepo({ name: 'demo', localPath: dir })
  store.addCommit(task1.id, { repo: 'demo', sha, note: 'A' })
  store.addCommit(task2.id, { repo: 'demo', sha, note: 'A' }) // 同 (repo, sha) 应去重

  const out = await ops.getNodeDiffs(store, s.id, { scope: 'subtree' })
  assert.equal(out.count, 1)
  assert.equal(out.items[0].sourceNodes.length, 2)
  assert.equal(out.items[0].files.length, 1)
  assert.equal(out.items[0].files[0].path, 'src/a.txt')
  assert.equal(out.items[0].error, null)

  const self = await ops.getNodeDiffs(store, task1.id, { scope: 'self' })
  assert.equal(self.count, 1)
})
