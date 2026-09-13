import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const agent = await import('../server/agent.mjs')
  return { tmp, store, agent }
}

function makeTask(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return { s, t }
}

async function waitRun(store, runId, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = store.getAgentRun(runId)
    if (r.status !== 'running') return r
    await new Promise((res) => setTimeout(res, 80))
  }
  throw new Error('agent run 未在预期时间内完成')
}

test('agent run：执行成功、输出落库、exitCode 记录', async (t) => {
  const { tmp, store, agent } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-agent-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  store.addCommit(task.id, { repo: 'demo', sha: 'abcdef1' })

  const run = agent.startAgentRun(store, task.id, { prompt: '验证链路', agent: 'echo', cwd: dir })
  assert.equal(run.status, 'running')
  assert.equal(run.agent, 'echo')
  assert.equal(run.cwd, dir)

  const done = await waitRun(store, run.id)
  assert.equal(done.status, 'success')
  assert.equal(done.exitCode, 0)
  assert.ok(done.output.includes('验证链路'))
  assert.ok(done.finishedAt)
})

test('agent run：cwd 缺省时自动推导自节点提交关联的仓库', async (t) => {
  const { tmp, store, agent } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-agent-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo', localPath: dir })
  store.addCommit(task.id, { repo: 'demo', sha: 'abcdef1' })

  assert.equal(agent.resolveRunCwd(store, task.id), dir)
  const run = agent.startAgentRun(store, task.id, { prompt: 'x', agent: 'echo' })
  assert.equal(run.cwd, dir)
  await waitRun(store, run.id)
})

test('agent run：无可用 cwd 或空 prompt → VALIDATION_FAILED', async (t) => {
  const { tmp, store, agent } = await setup()
  t.after(() => tmp.cleanup())
  const { t: task } = makeTask(store)

  assert.throws(
    () => agent.startAgentRun(store, task.id, { prompt: '没有仓库' }),
    (e) => e.code === 'VALIDATION_FAILED'
  )

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-agent-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.throws(
    () => agent.startAgentRun(store, task.id, { prompt: '   ', cwd: dir }),
    (e) => e.code === 'VALIDATION_FAILED'
  )
})

test('agent runs：历史按时间倒序、含状态与输出', async (t) => {
  const { tmp, store, agent } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-agent-'))
  t.after(() => {
    tmp.cleanup()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const { t: task } = makeTask(store)

  const r1 = agent.startAgentRun(store, task.id, { prompt: '第一次', agent: 'echo', cwd: dir })
  await waitRun(store, r1.id)
  const r2 = agent.startAgentRun(store, task.id, { prompt: '第二次', agent: 'echo', cwd: dir })
  await waitRun(store, r2.id)

  const list = store.listAgentRuns(task.id)
  assert.equal(list.length, 2)
  assert.equal(list[0].id, r2.id) // 倒序
  assert.equal(list[0].status, 'success')
  assert.ok(list[0].output.includes('第二次'))
})
