import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tempHome } from './helpers.mjs'

const execFileP = promisify(execFile)
const CLI = path.resolve(import.meta.dirname, '../bin/taskboard.js')

async function setup() {
  const tmp = await tempHome()
  const home = tmp.dir
  const store = tmp.store.createStore(tmp.openDb())
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    tmp,
    home,
    store,
    base,
    close: async () => new Promise((r) => server.close(r))
  }
}

test('HTTP 需求管理：列表、创建、状态流转、文档更新后就绪状态可见', async (t) => {
  const ctx = await setup()
  t.after(async () => {
    await ctx.close()
    ctx.tmp.cleanup()
  })
  const p = ctx.store.createNode({ type: 'project', name: 'P' })

  const created = await fetch(`${ctx.base}/api/requirements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: p.id, name: '需求A' })
  }).then((r) => r.json())
  assert.equal(created.status, 'todo')
  assert.deepEqual(created.canTransitionTo, ['doing', 'cancelled'])

  let list = await fetch(`${ctx.base}/api/requirements?projectId=${p.id}`).then((r) => r.json())
  assert.equal(list.items.length, 1)
  assert.equal(list.summary.byStatus.todo, 1)

  const moved = await fetch(`${ctx.base}/api/requirements/${created.id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'doing' })
  }).then((r) => r.json())
  assert.equal(moved.status, 'doing')

  const rejected = await fetch(`${ctx.base}/api/requirements/${created.id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'done' })
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.error.code, 'VALIDATION_FAILED')

  await fetch(`${ctx.base}/api/nodes/${created.id}/documents/upsert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '需求内容', content: '正文' })
  })
  list = await fetch(`${ctx.base}/api/requirements?projectId=${p.id}`).then((r) => r.json())
  assert.equal(list.items[0].docState.find((d) => d.name === '需求内容').filled, true)
  assert.equal(list.summary.missingRequirementDoc, 0)
})

test('CLI 需求管理：create / list / transition 全链路', async (t) => {
  const ctx = await setup()
  t.after(() => ctx.tmp.cleanup())
  await ctx.close()
  const cli = (args) =>
    execFileP('node', [CLI, ...args], { env: { ...process.env, TASKBOARD_HOME: ctx.home }, encoding: 'utf8' }).then((r) =>
      JSON.parse(r.stdout)
    )

  await cli(['node', 'upsert', '--path', 'P'])
  const created = await cli(['requirement', 'create', '--project', 'P', '--name', 'R'])
  assert.equal(created.type, 'requirement')
  const list = await cli(['requirement', 'list', '--project', 'P'])
  assert.equal(list.items.length, 1)
  const moved = await cli(['requirement', 'transition', 'P/R', '--status', 'doing'])
  assert.equal(moved.status, 'doing')
})

test('MCP 需求管理：真实协议调用与 store 返回一致', async (t) => {
  const ctx = await setup()
  t.after(async () => {
    await ctx.close()
    ctx.tmp.cleanup()
  })
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = createMcpServer({ store: ctx.store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'taskboard-requirement-test', version: '1.0.0' })
  await client.connect(clientTransport)
  t.after(async () => {
    await client.close()
    await server.close()
  })
  const call = (name, args) => client.callTool({ name, arguments: args })

  const p = ctx.store.createNode({ type: 'project', name: 'P' })
  const createdOut = await call('requirement_create', { project: 'P', name: 'R' })
  assert.equal(createdOut.isError, undefined)
  const created = JSON.parse(createdOut.content[0].text)
  assert.deepEqual(created, ctx.store.listRequirements({ projectId: p.id })[0])

  const bad = await call('requirement_transition', { ref: 'P/R', status: 'done' })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /VALIDATION_FAILED/)

  const listOut = await call('requirement_list', { project: 'P' })
  const list = JSON.parse(listOut.content[0].text)
  assert.equal(list.items.length, 1)
  assert.equal(list.summary.byStatus.todo, 1)
})
