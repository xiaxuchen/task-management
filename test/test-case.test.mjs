import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const task = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return { tmp, store, p, r, s, task }
}

// ---------- test_cases ----------

test('test_case：创建 / 列表 / 默认类型 regression', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const c = store.createTestCase(task.id, { name: '登录回归', prompt: '跑登录单测', expectation: '全绿' })
  assert.ok(c.id > 0)
  assert.equal(c.kind, 'regression')
  assert.equal(c.enabled, true)
  assert.equal(c.expectation, '全绿')
  assert.equal(store.listTestCases(task.id).length, 1)
})

test('test_case：名称在同节点内唯一，重名报 TEST_CASE_NAME_EXISTS', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  store.createTestCase(task.id, { name: 'A', prompt: 'p' })
  assert.throws(() => store.createTestCase(task.id, { name: 'A', prompt: 'q' }), /TEST_CASE_NAME_EXISTS/)
  const b = store.createTestCase(task.id, { name: 'B', prompt: 'p' })
  assert.throws(() => store.updateTestCase(b.id, { name: 'A' }), /TEST_CASE_NAME_EXISTS/)
})

test('test_case：名称与 prompt 必填，非法 kind 拒绝', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  assert.throws(() => store.createTestCase(task.id, { name: '  ', prompt: 'p' }), /测试用例名必填/)
  assert.throws(() => store.createTestCase(task.id, { name: 'X', prompt: '  ' }), /必填/)
  assert.throws(() => store.createTestCase(task.id, { name: 'X', prompt: 'p', kind: 'bogus' }), /未知测试类型/)
})

test('test_case：upsert 按名幂等并覆盖，created 标记正确', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const first = store.upsertTestCase(task.id, { name: '回归', prompt: 'v1', expectation: 'e1' })
  assert.equal(first.created, true)
  const second = store.upsertTestCase(task.id, { name: '回归', prompt: 'v2', expectation: 'e2' })
  assert.equal(second.created, false)
  assert.equal(second.id, first.id)
  const list = store.listTestCases(task.id)
  assert.equal(list.length, 1)
  assert.equal(list[0].prompt, 'v2')
  assert.equal(list[0].expectation, 'e2')
})

test('test_case：kind 筛选与 includeDisabled', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  store.createTestCase(task.id, { name: 'R1', prompt: 'p', kind: 'regression' })
  store.createTestCase(task.id, { name: 'A1', prompt: 'p', kind: 'acceptance' })
  const off = store.createTestCase(task.id, { name: 'C1', prompt: 'p', kind: 'code_check', enabled: 0 })
  assert.equal(store.listTestCases(task.id).length, 2)
  assert.equal(store.listTestCases(task.id, { kind: 'acceptance' }).length, 1)
  assert.equal(store.listTestCases(task.id, { includeDisabled: true }).length, 3)
  assert.equal(off.enabled, false)
})

test('test_case：排序与删除', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const a = store.createTestCase(task.id, { name: 'A', prompt: 'p' })
  const b = store.createTestCase(task.id, { name: 'B', prompt: 'p' })
  const c = store.createTestCase(task.id, { name: 'C', prompt: 'p' })
  store.reorderTestCases(task.id, [c.id, a.id, b.id])
  assert.deepEqual(store.listTestCases(task.id).map((x) => x.name), ['C', 'A', 'B'])
  store.deleteTestCase(b.id)
  assert.deepEqual(store.listTestCases(task.id).map((x) => x.name), ['C', 'A'])
})

test('test_case：随节点级联删除', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  store.createTestCase(task.id, { name: 'A', prompt: 'p' })
  const taskId = task.id
  store.deleteNode(task.id)
  // 节点已删，listTestCases 会因节点不存在而报错；直接查库确认级联清空
  const left = store.db.prepare('SELECT COUNT(*) c FROM test_cases WHERE node_id = ?').get(taskId).c
  assert.equal(left, 0)
})

// ---------- test_reports ----------

test('test_report：开报告默认 running，finish 回写终态', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const c = store.createTestCase(task.id, { name: 'A', prompt: 'p' })
  const rep = store.createTestReport(task.id, { caseId: c.id, kind: 'regression' })
  assert.equal(rep.status, 'running')
  assert.equal(rep.runId, null)
  assert.equal(rep.finishedAt, null)
  const done = store.finishTestReport(rep.id, { status: 'pass', summary: '全绿' })
  assert.equal(done.status, 'pass')
  assert.ok(done.finishedAt)
  assert.equal(done.summary, '全绿')
})

test('test_report：列表倒序 + 按 caseId / kind 筛', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const c1 = store.createTestCase(task.id, { name: 'A', prompt: 'p', kind: 'regression' })
  const c2 = store.createTestCase(task.id, { name: 'B', prompt: 'p', kind: 'acceptance' })
  store.createTestReport(task.id, { caseId: c1.id, kind: 'regression' })
  store.createTestReport(task.id, { caseId: c2.id, kind: 'acceptance' })
  const all = store.listTestReports(task.id)
  assert.equal(all.length, 2)
  assert.ok(all[0].id > all[1].id)
  assert.equal(store.listTestReports(task.id, { caseId: c1.id }).length, 1)
  assert.equal(store.listTestReports(task.id, { kind: 'acceptance' }).length, 1)
})

test('test_report：删除用例后历史报告保留，caseId 置空', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const c = store.createTestCase(task.id, { name: 'A', prompt: 'p' })
  const rep = store.createTestReport(task.id, { caseId: c.id, kind: 'regression' })
  store.deleteTestCase(c.id)
  const kept = store.getTestReport(rep.id)
  assert.equal(kept.caseId, null)
})

// ---------- acceptance report ----------

test('acceptance：聚合最近结果与通过率（未执行口径）', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const a = store.createTestCase(task.id, { name: 'A', prompt: 'p', expectation: 'e' })
  const b = store.createTestCase(task.id, { name: 'B', prompt: 'p' })
  const c = store.createTestCase(task.id, { name: 'C', prompt: 'p' })
  // A 先失败后通过（应取最近一次），B 失败，C 未执行
  const ra1 = store.createTestReport(task.id, { caseId: a.id, kind: 'regression' })
  store.finishTestReport(ra1.id, { status: 'fail' })
  const ra2 = store.createTestReport(task.id, { caseId: a.id, kind: 'regression' })
  store.finishTestReport(ra2.id, { status: 'pass' })
  const rb = store.createTestReport(task.id, { caseId: b.id, kind: 'regression' })
  store.finishTestReport(rb.id, { status: 'fail' })

  const report = store.buildAcceptanceReport(task.id)
  assert.equal(report.totals.cases, 3)
  assert.equal(report.totals.run, 2)
  assert.equal(report.totals.pass, 1)
  assert.equal(report.totals.fail, 1)
  assert.equal(report.totals.notRun, 1)
  assert.equal(report.passRate, 0.5)
  const itemA = report.items.find((i) => i.caseId === a.id)
  assert.equal(itemA.latestStatus, 'pass')
  const itemC = report.items.find((i) => i.caseId === c.id)
  assert.equal(itemC.latestStatus, 'not_run')
})

test('acceptance：scope=subtree 覆盖子树用例', async (t) => {
  const { tmp, store, s, task } = await setup()
  t.after(() => tmp.cleanup())
  store.createTestCase(task.id, { name: 'T1', prompt: 'p' })
  store.createTestCase(s.id, { name: 'S1', prompt: 'p' })
  assert.equal(store.buildAcceptanceReport(task.id).totals.cases, 1)
  assert.equal(store.buildAcceptanceReport(s.id, { scope: 'subtree' }).totals.cases, 2)
})

test('acceptance：无用例时 passRate 为 null', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const report = store.buildAcceptanceReport(task.id)
  assert.equal(report.totals.cases, 0)
  assert.equal(report.passRate, null)
})

// ---------- 编排层（至少覆盖 dryRun 与提示词拼装） ----------

test('runTestCases：无用例时报错', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const { runTestCases } = await import('../server/ops.mjs')
  assert.throws(() => runTestCases(store, task.id, { dryRun: true }), /没有可执行的测试用例/)
})

test('runTestCases：dryRun 返回用例与提示词、不落库不派单', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const { runTestCases } = await import('../server/ops.mjs')
  store.createTestCase(task.id, { name: 'A', prompt: '跑 A', expectation: '绿' })
  store.createTestCase(task.id, { name: 'B', prompt: '跑 B' })
  const out = runTestCases(store, task.id, { dryRun: true })
  assert.equal(out.dryRun, true)
  assert.equal(out.cases.length, 2)
  assert.ok(out.prompt.includes('用例 1：A'))
  assert.ok(out.prompt.includes('期望结果：绿'))
  assert.ok(out.prompt.includes('PASS|FAIL|BLOCKED'))
  assert.equal(store.listTestReports(task.id).length, 0)
})

test('runTestCases：dryRun 按 kind / caseIds 过滤', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const { runTestCases } = await import('../server/ops.mjs')
  const r = store.createTestCase(task.id, { name: 'R', prompt: 'p', kind: 'regression' })
  store.createTestCase(task.id, { name: 'A', prompt: 'p', kind: 'acceptance' })
  const byKind = runTestCases(store, task.id, { dryRun: true, kind: 'acceptance' })
  assert.deepEqual(byKind.cases.map((c) => c.name), ['A'])
  const byId = runTestCases(store, task.id, { dryRun: true, caseIds: [r.id] })
  assert.deepEqual(byId.cases.map((c) => c.name), ['R'])
})

test('renderAcceptanceMd：输出可读验收报告', async (t) => {
  const { tmp, store, task } = await setup()
  t.after(() => tmp.cleanup())
  const { renderAcceptanceMd } = await import('../server/ops.mjs')
  const c = store.createTestCase(task.id, { name: 'A', prompt: 'p' })
  const rep = store.createTestReport(task.id, { caseId: c.id })
  store.finishTestReport(rep.id, { status: 'pass' })
  const md = renderAcceptanceMd(store.buildAcceptanceReport(task.id))
  assert.ok(md.startsWith('# 验收报告'))
  assert.ok(md.includes('| A |'))
  assert.ok(md.includes('100%'))
})
