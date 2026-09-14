import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const { createStore } = tmp.store
  const store = createStore(db)
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  let server
  const base = (await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(`http://127.0.0.1:${addr.port}`)
    })
    server.once('error', reject)
  }))
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json())
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
  const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
  const del = (p, body) => fetch(`${base}${p}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
  const close = () => new Promise((r) => server.close(r))
  const cleanup = () => { close(); tmp.cleanup() }
  return { tmp, store, base, get, post, patch, del, close, cleanup }
}

// ---------- 健康 / schema / revision ----------

test('GET /api/health', async () => {
  const { tmp, get, close } = await setup()
  const r = await get('/api/health')
  assert.equal(r.ok, true)
  assert.ok(typeof r.revision === 'number')
  await close()
  tmp.cleanup()
})

test('GET /api/schema', async () => {
  const { tmp, get, close } = await setup()
  const r = await get('/api/schema')
  assert.ok(Array.isArray(r.nodeTypes))
  assert.ok(Array.isArray(r.tools))
  assert.ok(r.tools.includes('schema'))
  await close()
  tmp.cleanup()
})

test('GET /api/revision', async () => {
  const { tmp, get, close } = await setup()
  const r = await get('/api/revision')
  assert.ok(typeof r.revision === 'number')
  await close()
  tmp.cleanup()
})

// ---------- 节点 CRUD ----------

test('POST /api/nodes 创建项目', async () => {
  const { tmp, post, get, close } = await setup()
  const r = await post('/api/nodes', { type: 'project', name: '测试项目' })
  assert.equal(r.type, 'project')
  assert.equal(r.name, '测试项目')
  const tree = await get('/api/tree')
  assert.equal(tree.nodes.length, 1)
  await close()
  tmp.cleanup()
})

test('POST /api/nodes 父子校验失败返回 400', async () => {
  const { tmp, post, close } = await setup()
  const r = await post('/api/nodes', { type: 'task', name: '孤任务' }) // task 不能是根
  assert.ok(r.error)
  assert.equal(r.error.code, 'PARENT_TYPE_INVALID')
  await close()
  tmp.cleanup()
})

test('PATCH /api/nodes/:id 更新节点', async () => {
  const { tmp, post, patch, close } = await setup()
  const p = await post('/api/nodes', { type: 'project', name: 'P' })
  const u = await patch(`/api/nodes/${p.id}`, { name: 'P-改', status: 'doing' })
  assert.equal(u.name, 'P-改')
  assert.equal(u.status, 'doing')
  await close()
  tmp.cleanup()
})

test('DELETE /api/nodes/:id 需要 confirm', async () => {
  const { tmp, post, del, close } = await setup()
  const p = await post('/api/nodes', { type: 'project', name: 'P' })
  const r = await del(`/api/nodes/${p.id}`, { confirm: false })
  assert.equal(r.error.code, 'CONFIRM_REQUIRED')
  await close()
  tmp.cleanup()
})

test('DELETE /api/nodes/:id 带 confirm 正常删除', async () => {
  const { tmp, post, del, get, close } = await setup()
  const p = await post('/api/nodes', { type: 'project', name: 'P' })
  await del(`/api/nodes/${p.id}`, { confirm: true })
  const tree = await get('/api/tree')
  assert.equal(tree.nodes.length, 0)
  await close()
  tmp.cleanup()
})

// ---------- 文档 ----------

test('POST /api/nodes/:id/documents 与 upsert', async () => {
  const { tmp, post, get, close } = await setup()
  const p = await post('/api/nodes', { type: 'project', name: 'P' })
  // 先创建一个新文档
  const d = await post(`/api/nodes/${p.id}/documents`, { name: '备注', content: '正文' })
  assert.equal(d.name, '备注')

  // upsert 预置的「描述」文档（项目新建时自动创建），幂等更新内容
  const upsert = await post(`/api/nodes/${p.id}/documents/upsert`, { name: '描述', content: '新正文' })
  assert.equal(upsert.created, false)

  const docs = await get(`/api/nodes/${p.id}/documents`)
  assert.equal(docs.length, 2)
  const desc = docs.find((d) => d.name === '描述')
  assert.equal(desc.content, '新正文')
  await close()
  tmp.cleanup()
})

// ---------- upsert / batch / import ----------

test('POST /api/nodes/upsert 按路径幂等', async () => {
  const { tmp, post, get, close } = await setup()
  const r1 = await post('/api/nodes/upsert', { path: '项目A/需求1' })
  assert.equal(r1.node.name, '需求1')
  assert.equal(r1.steps.length, 2)

  const r2 = await post('/api/nodes/upsert', { path: '项目A/需求1' })
  assert.equal(r2.steps.length, 0)

  const tree = await get('/api/tree')
  assert.equal(tree.nodes[0].children.length, 1)
  await close()
  tmp.cleanup()
})

test('POST /api/batch 批量操作', async () => {
  const { tmp, post, close } = await setup()
  const p = await post('/api/nodes', { type: 'project', name: 'P' })
  const r = await post('/api/batch', {
    ops: [
      { op: 'node.create', parentId: p.id, type: 'requirement', name: 'R1' },
      { op: 'node.create', parentId: p.id, type: 'requirement', name: 'R2' }
    ]
  })
  assert.equal(r.total, 2)
  assert.equal(r.failed, 0)
  await close()
  tmp.cleanup()
})

test('POST /api/import 大纲导入', async () => {
  const { tmp, post, get, close } = await setup()
  const md = '- 项目\n  - 需求A\n    - 子需求1'
  const r = await post('/api/import', { content: md })
  assert.equal(r.count, 3)
  const tree = await get('/api/tree')
  assert.equal(tree.nodes.length, 1)
  assert.equal(tree.nodes[0].children[0].children[0].name, '子需求1')
  await close()
  tmp.cleanup()
})

// ---------- 属性 ----------

test('属性定义 CRUD', async () => {
  const { tmp, post, get, close } = await setup()
  const def = await post('/api/attr-defs', { nodeType: 'requirement', key: 'priority', label: '优先级', dataType: 'text' })
  assert.equal(def.key, 'priority')

  const list = await get('/api/attr-defs')
  assert.ok(list.some((d) => d.key === 'priority'))
  await close()
  tmp.cleanup()
})

// ---------- 仓库 ----------

test('仓库 CRUD', async () => {
  const { tmp, post, get, close } = await setup()
  const repo = await post('/api/repos', { name: 'xp-charge', localPath: '/tmp/test' })
  assert.equal(repo.name, 'xp-charge')

  const list = await get('/api/repos')
  assert.ok(list.some((r) => r.name === 'xp-charge'))
  await close()
  tmp.cleanup()
})

// ---------- commit ----------

test('commit 登记与删除', async () => {
  const { tmp, post, get, close } = await setup()
  await post('/api/repos', { name: 'test-repo' })
  const p = await post('/api/nodes', { type: 'project', name: 'P' })
  const r = await post(`/api/nodes/${p.id}/commits`, { repo: 'test-repo', sha: 'abc1234', note: '测试提交' })
  assert.equal(r.sha, 'abc1234')
  assert.equal(r.created, true)

  // 幂等
  const r2 = await post(`/api/nodes/${p.id}/commits`, { repo: 'test-repo', sha: 'abc1234' })
  assert.equal(r2.created, false)

  const list = await get(`/api/nodes/${p.id}/commits`)
  assert.equal(list.length, 1)
  await close()
  tmp.cleanup()
})

// ---------- 配置 ----------

test('GET /api/config', async () => {
  const { tmp, get, close } = await setup()
  const r = await get('/api/config')
  assert.equal(r.port, 3210)
  await close()
  tmp.cleanup()
})

// ---------- 404 ----------

// ---------- agent 运行时 / 会话 / 任务 ----------

function makeTree(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return t
}

test('运行时：注册 / 列表 / 心跳 / 状态 / 删除', async () => {
  const { tmp, store, get, post, patch, del, close } = await setup()
  const rt = await post('/api/runtimes', { name: 'Host A', daemonId: 'host-a', provider: 'qodercli' })
  assert.equal(rt.status, 'online')

  const list = await get('/api/runtimes')
  assert.equal(list.items.length, 1)
  assert.equal(list.summary.online, 1)

  const beat = await post(`/api/runtimes/${rt.id}/heartbeat`, {})
  assert.equal(beat.status, 'online')

  const off = await patch(`/api/runtimes/${rt.id}`, { status: 'offline' })
  assert.equal(off.status, 'offline')

  const removed = await del(`/api/runtimes/${rt.id}`, {})
  assert.equal(removed.ok, true)
  assert.equal((await get('/api/runtimes')).items.length, 0)

  await close()
  tmp.cleanup()
})

test('会话：新建 / 列表 / 归档', async () => {
  const { tmp, store, post, get, del, close } = await setup()
  const task = makeTree(store)
  const s = await post(`/api/nodes/${task.id}/agent-sessions`, { agent: 'qodercli', title: '第一次评审' })
  assert.equal(s.status, 'active')
  assert.equal(s.runCount, 0)

  const list = await get(`/api/nodes/${task.id}/agent-sessions`)
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '第一次评审')

  const archived = await del(`/api/agent-sessions/${s.id}`, {})
  assert.equal(archived.status, 'archived')

  await close()
  tmp.cleanup()
})

test('任务：派单 echo → 消息流 → 终态；列表与详情一致', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { tmp, store, base, get, close } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-http-agent-'))
  const task = makeTree(store)
  store.addRepo({ name: 'demo', localPath: dir })
  store.addCommit(task.id, { repo: 'demo', sha: 'abcdef1' })

  const run = await fetch(`${base}/api/nodes/${task.id}/agent-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '验证 HTTP 链路', agent: 'echo', cwd: dir })
  }).then((r) => r.json())
  assert.ok(run.id > 0)
  assert.ok(run.sessionId > 0)
  assert.ok(run.runtimeId > 0) // 自动注册本机运行时

  // 等任务结束
  let done = run
  for (let i = 0; i < 60 && done.status === 'running'; i++) {
    await new Promise((res) => setTimeout(res, 100))
    done = await get(`/api/agent-runs/${run.id}`)
  }
  assert.equal(done.status, 'success')

  const messages = await get(`/api/agent-runs/${run.id}/messages`)
  assert.ok(messages.length > 0)
  assert.deepEqual(messages.map((m) => m.seq).sort((a, b) => a - b), messages.map((m) => m.seq))
  assert.ok(messages.some((m) => (m.content || '').includes('验证 HTTP 链路')))

  const runs = await get(`/api/nodes/${task.id}/agent-runs`)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'success')

  // 会话沉淀：runCount 与消息流
  const sessions = await get(`/api/nodes/${task.id}/agent-sessions`)
  assert.equal(sessions[0].runCount, 1)

  await close()
  tmp.cleanup()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('任务：取消未结束任务 / 重试已结束任务（attempt+1 指向原任务）', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { tmp, store, get, post, close } = await setup()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-http-retry-'))
  const task = makeTree(store)
  // agent=echo：重试会真的重新执行，可以验证 dispatch 生效（本机未必装了 qodercli）
  const run = store.createAgentRun(task.id, { prompt: 'p', agent: 'echo', cwd: dir })

  const cancelled = await post(`/api/agent-runs/${run.id}/cancel`, { reason: 'user_cancelled' })
  assert.equal(cancelled.status, 'cancelled')

  const retried = await post(`/api/agent-runs/${run.id}/retry`, {})
  assert.equal(retried.attempt, 2)
  assert.equal(retried.parentRunId, run.id)
  assert.equal(retried.sessionId, run.sessionId)

  // 重试会立刻拉起子进程：等它跑完，确认不是卡在 running
  let done = retried
  for (let i = 0; i < 60 && done.status === 'running'; i++) {
    await new Promise((res) => setTimeout(res, 100))
    done = await get(`/api/agent-runs/${retried.id}`)
  }
  assert.equal(done.status, 'success')
  const msgs = await get(`/api/agent-runs/${retried.id}/messages`)
  assert.ok(msgs.length > 0)

  await close()
  tmp.cleanup()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('任务：重试超过 maxAttempts 硬上限时 HTTP 400 拒绝（VALIDATION_FAILED）', async () => {
  const { tmp, store, base, get, post, close } = await setup()
  const task = makeTree(store)
  const run = store.createAgentRun(task.id, { prompt: 'p', agent: 'echo', cwd: '/tmp', maxAttempts: 1 })
  store.finishAgentRun(run.id, { status: 'failed', failureReason: 'timeout' })

  const res = await fetch(`${base}/api/agent-runs/${run.id}/retry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.error.code, 'VALIDATION_FAILED')
  assert.equal(body.error.details.maxAttempts, 1)

  // 拒绝后不落库
  assert.equal((await get(`/api/nodes/${task.id}/agent-runs`)).length, 1)

  await close()
  tmp.cleanup()
})

test('任务：派单可显式指定 maxAttempts，回读一致', async () => {
  const { tmp, store, post, close } = await setup()
  const task = makeTree(store)
  const run = await post(`/api/nodes/${task.id}/agent-runs`, { prompt: 'p', agent: 'echo', cwd: '/tmp', maxAttempts: 5 })
  assert.equal(run.maxAttempts, 5)

  // 非法值拒绝
  const bad = await post(`/api/nodes/${task.id}/agent-runs`, { prompt: 'p', agent: 'echo', cwd: '/tmp', maxAttempts: 0 })
  assert.equal(bad.error.code, 'VALIDATION_FAILED')

  await close()
  tmp.cleanup()
})

test('任务：回写（PATCH）置终态并沉淀 cliSessionId', async () => {
  const { tmp, store, get, patch, close } = await setup()
  const task = makeTree(store)
  const run = store.createAgentRun(task.id, { prompt: 'p', cwd: '/tmp' })

  const updated = await patch(`/api/agent-runs/${run.id}`, {
    status: 'success',
    output: '结论',
    cliSessionId: 'cli-xyz'
  })
  assert.equal(updated.status, 'success')

  const session = await get(`/api/agent-sessions/${run.sessionId}`)
  assert.equal(session.cliSessionId, 'cli-xyz')

  await close()
  tmp.cleanup()
})

test('未知路由返回 404', async () => {
  const { tmp, get, close } = await setup()
  const r = await get('/api/unknown')
  assert.equal(r.error.code, 'NOT_FOUND')
  await close()
  tmp.cleanup()
})
