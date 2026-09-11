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

test('未知路由返回 404', async () => {
  const { tmp, get, close } = await setup()
  const r = await get('/api/unknown')
  assert.equal(r.error.code, 'NOT_FOUND')
  await close()
  tmp.cleanup()
})