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
  return { tmp, store, p, r, testCase }
}

function passCase(store, nodeId, caseId, summary = '全绿') {
  const report = store.createTestReport(nodeId, { caseId, status: 'running', kind: 'regression' })
  return store.finishTestReport(report.id, { status: 'pass', summary })
}

test('验收签收：测试通过但未签收时 pending，签收 accepted 后交付门禁通过', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  t.after(() => tmp.cleanup())

  passCase(store, r.id, testCase.id)
  let status = store.buildAcceptanceStatus(r.id)
  assert.equal(status.state, 'pending')
  assert.equal(status.accepted, false)
  assert.equal(status.signoff, null)
  assert.equal(store.buildDeliveryGate(r.id).decision, 'not_ready')
  assert.match(store.buildDeliveryGate(r.id).blockers[0].detail, /尚未完成验收签收/)

  const signed = store.upsertAcceptanceSignoff(r.id, { decision: 'accepted', comment: '业务确认通过' }, 'cli')
  assert.equal(signed.decision, 'accepted')
  assert.equal(signed.signedBy, 'cli')
  assert.equal(signed.stale, false)

  status = store.buildAcceptanceStatus(r.id)
  assert.equal(status.state, 'accepted')
  assert.equal(status.accepted, true)
  assert.equal(store.buildDeliveryGate(r.id).decision, 'ready')
})

test('验收签收：rejected 阻塞交付，重新 accepted 后恢复', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  t.after(() => tmp.cleanup())
  passCase(store, r.id, testCase.id)

  store.upsertAcceptanceSignoff(r.id, { decision: 'rejected', comment: '验收不通过' })
  assert.equal(store.buildAcceptanceStatus(r.id).state, 'rejected')
  assert.equal(store.buildDeliveryGate(r.id).decision, 'not_ready')
  assert.equal(store.buildDeliveryGate(r.id).blockers.at(-1).detail, '验收已驳回')

  store.upsertAcceptanceSignoff(r.id, { decision: 'accepted', comment: '复验通过' })
  assert.equal(store.buildDeliveryGate(r.id).decision, 'ready')
})

test('验收签收：签收后测试证据变化自动 stale 并阻塞交付', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  t.after(() => tmp.cleanup())
  passCase(store, r.id, testCase.id)
  store.upsertAcceptanceSignoff(r.id, { decision: 'accepted' })
  assert.equal(store.buildDeliveryGate(r.id).decision, 'ready')

  const next = store.createTestReport(r.id, { caseId: testCase.id, status: 'running', kind: 'regression' })
  store.finishTestReport(next.id, { status: 'fail', summary: '复跑失败' })

  const status = store.buildAcceptanceStatus(r.id)
  assert.equal(status.state, 'stale')
  assert.equal(status.signoff.stale, true)
  const gate = store.buildDeliveryGate(r.id)
  assert.equal(gate.decision, 'not_ready')
  assert.equal(gate.sources.find((s) => s.key === 'acceptance').evidence.signoffState, 'stale')
  assert.ok(gate.blockers.some((b) => b.detail === '最近结果：fail'))
})

test('验收签收：用例期望变化也会让旧签收失效', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  t.after(() => tmp.cleanup())
  passCase(store, r.id, testCase.id)
  store.upsertAcceptanceSignoff(r.id, { decision: 'accepted' })
  assert.equal(store.buildDeliveryGate(r.id).decision, 'ready')

  store.updateTestCase(testCase.id, { expectation: '新增验收口径' })
  assert.equal(store.buildAcceptanceStatus(r.id).state, 'stale')
  assert.equal(store.buildDeliveryGate(r.id).decision, 'not_ready')
  assert.equal(store.buildDeliveryGate(r.id).blockers.at(-1).detail, '验收签收已失效（测试证据已变化）')
})

test('验收签收：没有用例时拒绝签收，状态为 not_applicable', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.db.prepare('DELETE FROM test_cases WHERE node_id = ?').run(r.id)
  const status = store.buildAcceptanceStatus(r.id)
  assert.equal(status.state, 'not_applicable')
  assert.equal(status.accepted, false)
  assert.throws(() => store.upsertAcceptanceSignoff(r.id, { decision: 'accepted' }), /没有可验收的测试用例/)
  assert.equal(store.buildDeliveryGate(r.id).sources.find((s) => s.key === 'acceptance').status, 'not_applicable')
})

test('验收签收：非法 decision / scope 拒绝，revision 只在签收写入时 +1', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  t.after(() => tmp.cleanup())
  passCase(store, r.id, testCase.id)
  assert.throws(() => store.upsertAcceptanceSignoff(r.id, { decision: 'ok' }), /VALIDATION_FAILED/)
  assert.throws(() => store.upsertAcceptanceSignoff(r.id, { decision: 'accepted', scope: 'Subtree' }), /VALIDATION_FAILED/)
  const before = store.getRevision()
  store.buildAcceptanceStatus(r.id)
  assert.equal(store.getRevision(), before)
  store.upsertAcceptanceSignoff(r.id, { decision: 'accepted' })
  assert.equal(store.getRevision(), before + 1)
})

test('验收签收（HTTP）：状态 / 签收 / md 输出可用', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  const { createApp } = await import('../server/http.mjs')
  const server = await new Promise((resolve, reject) => {
    const s = createApp({ store }).listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    tmp.cleanup()
  })
  passCase(store, r.id, testCase.id)

  const pending = await fetch(`${base}/api/nodes/${r.id}/acceptance-status`).then((x) => x.json())
  assert.equal(pending.state, 'pending')

  const signed = await fetch(`${base}/api/nodes/${r.id}/acceptance-signoff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'accepted', comment: 'HTTP 验收' })
  }).then((x) => x.json())
  assert.equal(signed.decision, 'accepted')
  assert.equal(signed.signedBy, 'user')

  const accepted = await fetch(`${base}/api/nodes/${r.id}/acceptance-status`).then((x) => x.json())
  assert.equal(accepted.state, 'accepted')
  const md = await fetch(`${base}/api/nodes/${r.id}/acceptance-status?format=md`)
  assert.equal(md.status, 200)
  assert.match(md.headers.get('content-type') || '', /text\/markdown/)
  assert.match(await md.text(), /# 验收签收：R/)
})

test('验收签收（CLI）：acceptance-status / acceptance-sign 与 store 一致', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  t.after(() => tmp.cleanup())
  passCase(store, r.id, testCase.id)
  const home = tmp.dir

  const before = JSON.parse(
    (
      await execFileP('node', [CLI, 'test', 'acceptance-status', 'P/R'], {
        env: { ...process.env, TASKBOARD_HOME: home },
        encoding: 'utf8'
      })
    ).stdout
  )
  assert.equal(before.state, 'pending')

  const signed = JSON.parse(
    (
      await execFileP('node', [CLI, 'test', 'acceptance-sign', 'P/R', '--decision', 'accepted', '--comment', 'CLI 验收'], {
        env: { ...process.env, TASKBOARD_HOME: home },
        encoding: 'utf8'
      })
    ).stdout
  )
  assert.equal(signed.decision, 'accepted')
  assert.equal(signed.signedBy, 'cli')
})

test('验收签收（MCP）：acceptance_status / acceptance_sign 真实协议可用', async (t) => {
  const { tmp, store, r, testCase } = await setup()
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = createMcpServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'taskboard-acceptance-signoff-test', version: '1.0.0' })
  await client.connect(clientTransport)
  t.after(async () => {
    await client.close()
    await server.close()
    tmp.cleanup()
  })
  passCase(store, r.id, testCase.id)

  const pending = JSON.parse(
    (await client.callTool({ name: 'acceptance_status', arguments: { node: r.id } })).content[0].text
  )
  assert.equal(pending.state, 'pending')

  const signed = JSON.parse(
    (
      await client.callTool({
        name: 'acceptance_sign',
        arguments: { node: r.id, decision: 'accepted', comment: 'MCP 验收' }
      })
    ).content[0].text
  )
  assert.equal(signed.decision, 'accepted')
  assert.equal(signed.signedBy, 'mcp')

  const bad = await client.callTool({ name: 'acceptance_status', arguments: { node: r.id, scope: 'Subtree' } })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /VALIDATION_FAILED/)
})
