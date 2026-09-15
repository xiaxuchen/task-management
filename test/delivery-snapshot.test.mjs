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
  const store = tmp.store.createStore(tmp.openDb())
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '需求内容', '需求正文')
  store.upsertDocument(r.id, '概要设计', '设计正文')
  const testCase = store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  const report = store.createTestReport(r.id, { caseId: testCase.id, status: 'running', kind: 'regression' })
  store.finishTestReport(report.id, { status: 'pass', summary: '全绿' })
  return { tmp, store, p, r, testCase }
}

test('delivery snapshot：冻结当前交付结论并保存完整证据', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const before = store.getRevision()
  const snapshot = store.captureDeliverySnapshot(r.id, { note: '上线审批留痕' }, 'ai')

  assert.equal(snapshot.nodeId, r.id)
  assert.equal(snapshot.scope, 'self')
  assert.equal(snapshot.decision, 'ready')
  assert.equal(snapshot.ready, true)
  assert.equal(snapshot.note, '上线审批留痕')
  assert.equal(snapshot.createdBy, 'ai')
  assert.match(snapshot.fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(snapshot.gate.decision, 'ready')
  assert.deepEqual(snapshot.gate.blockers, [])
  assert.equal(snapshot.drift.status, 'current')
  assert.equal(store.getRevision(), before + 1)
})

test('delivery snapshot：无改动时 current；源证据变化后 drifted 且不改写冻结结论', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const snapshot = store.captureDeliverySnapshot(r.id)
  assert.equal(snapshot.drift.status, 'current')

  store.createReleaseItem(r.id, { name: '执行上线 SQL', kind: 'sql', status: 'pending' })
  const [again] = store.listDeliverySnapshots(r.id)
  assert.equal(again.id, snapshot.id)
  assert.equal(again.decision, 'ready')
  assert.equal(again.gate.decision, 'ready')
  assert.equal(again.drift.status, 'drifted')
  assert.equal(again.drift.currentDecision, 'not_ready')
  assert.notEqual(again.drift.currentFingerprint, again.fingerprint)
})

test('delivery snapshot：scope=subtree 冻结子树证据，并按 scope 列表隔离', async (t) => {
  const { tmp, store, p, r } = await setup()
  t.after(() => tmp.cleanup())
  const selfSnapshot = store.captureDeliverySnapshot(r.id, { scope: 'self' })
  const subtreeSnapshot = store.captureDeliverySnapshot(p.id, { scope: 'subtree' })

  assert.equal(subtreeSnapshot.scope, 'subtree')
  assert.equal(subtreeSnapshot.decision, 'ready')
  assert.equal(store.listDeliverySnapshots(p.id, { scope: 'subtree' }).length, 1)
  assert.equal(store.listDeliverySnapshots(p.id, { scope: 'self' }).length, 0)
  assert.equal(store.getDeliverySnapshot(selfSnapshot.id).id, selfSnapshot.id)
})

test('delivery snapshot：未知 scope / 快照 id 返回稳定错误码', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  for (const bad of ['sub', '', 'Subtree']) {
    assert.throws(() => store.captureDeliverySnapshot(r.id, { scope: bad }), /VALIDATION_FAILED/)
    assert.throws(() => store.listDeliverySnapshots(r.id, { scope: bad }), /VALIDATION_FAILED/)
  }
  assert.throws(() => store.getDeliverySnapshot(999999), /NOT_FOUND/)
})

test('delivery snapshot：节点删除后快照随节点级联删除', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const snapshot = store.captureDeliverySnapshot(r.id)
  store.deleteNode(r.id)
  assert.throws(() => store.getDeliverySnapshot(snapshot.id), /NOT_FOUND/)
})

test('delivery snapshot：HTTP 捕获 / 列表 / 单条读取全链路', async (t) => {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((r) => server.close(r))
    tmp.cleanup()
  })

  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '需求内容', '需求正文')
  store.upsertDocument(r.id, '概要设计', '设计正文')
  const c = store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  const report = store.createTestReport(r.id, { caseId: c.id, status: 'running', kind: 'regression' })
  store.finishTestReport(report.id, { status: 'pass' })

  const captured = await fetch(`${base}/api/nodes/${r.id}/delivery-snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-taskboard-actor': 'ai' },
    body: JSON.stringify({ scope: 'self', note: 'HTTP 留痕' })
  }).then((x) => x.json())
  assert.equal(captured.decision, 'ready')
  assert.equal(captured.createdBy, 'ai')

  const list = await fetch(`${base}/api/nodes/${r.id}/delivery-snapshots?scope=self`).then((x) => x.json())
  assert.equal(list.length, 1)
  assert.equal(list[0].id, captured.id)
  assert.equal(list[0].drift.status, 'current')

  const one = await fetch(`${base}/api/delivery-snapshots/${captured.id}`).then((x) => x.json())
  assert.equal(one.id, captured.id)
  const md = await fetch(`${base}/api/delivery-snapshots/${captured.id}?format=md`).then((x) => x.text())
  assert.match(md, /^# 交付快照 #/m)
  assert.match(md, /与当前证据一致/)
})

test('delivery snapshot：CLI capture / list / get 全链路', async (t) => {
  const tmp = await tempHome()
  const home = tmp.dir
  const store = tmp.store.createStore(tmp.openDb())
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '需求内容', '需求正文')
  store.upsertDocument(r.id, '概要设计', '设计正文')
  const c = store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  const report = store.createTestReport(r.id, { caseId: c.id, status: 'running', kind: 'regression' })
  store.finishTestReport(report.id, { status: 'pass' })
  t.after(() => tmp.cleanup())

  const env = { ...process.env, TASKBOARD_HOME: home }
  const captured = JSON.parse(
    (await execFileP('node', [CLI, 'delivery', 'snapshot', 'P/R', '--note', 'CLI 留痕'], { env, encoding: 'utf8' })).stdout
  )
  assert.equal(captured.decision, 'ready')
  assert.equal(captured.note, 'CLI 留痕')

  const listed = JSON.parse(
    (await execFileP('node', [CLI, 'delivery', 'snapshots', 'P/R'], { env, encoding: 'utf8' })).stdout
  )
  assert.equal(listed.length, 1)
  assert.equal(listed[0].drift.status, 'current')

  const one = JSON.parse(
    (await execFileP('node', [CLI, 'delivery', 'snapshot-get', String(captured.id)], { env, encoding: 'utf8' })).stdout
  )
  assert.equal(one.id, captured.id)
})

test('delivery snapshot：MCP 真实协议捕获 / 列表 / 读取', async (t) => {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = createMcpServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'taskboard-delivery-snapshot-test', version: '1.0.0' })
  await client.connect(clientTransport)
  t.after(async () => {
    await client.close()
    await server.close()
    tmp.cleanup()
  })

  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '需求内容', '需求正文')
  store.upsertDocument(r.id, '概要设计', '设计正文')
  const c = store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  const report = store.createTestReport(r.id, { caseId: c.id, status: 'running', kind: 'regression' })
  store.finishTestReport(report.id, { status: 'pass' })

  const capturedOut = await client.callTool({
    name: 'delivery_snapshot_capture',
    arguments: { node: r.id, scope: 'self', note: 'MCP 留痕' }
  })
  assert.equal(capturedOut.isError, undefined)
  const captured = JSON.parse(capturedOut.content[0].text)
  assert.equal(captured.decision, 'ready')
  assert.equal(captured.createdBy, 'mcp')

  const listedOut = await client.callTool({ name: 'delivery_snapshot_list', arguments: { node: r.id } })
  const listed = JSON.parse(listedOut.content[0].text)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].drift.status, 'current')

  const oneOut = await client.callTool({ name: 'delivery_snapshot_get', arguments: { id: captured.id, format: 'md' } })
  assert.match(oneOut.content[0].text, /MCP 留痕/)
})

test('delivery snapshot：能力清单登记三入口 1:1', async () => {
  const { TOOLS } = await import('../server/ops.mjs')
  assert.ok(TOOLS.includes('delivery_snapshot_capture'))
  assert.ok(TOOLS.includes('delivery_snapshot_list'))
  assert.ok(TOOLS.includes('delivery_snapshot_get'))
})
