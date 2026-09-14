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
  return { tmp, store, p, r, s }
}

const branchOf = (map, stage, unitId) =>
  map.nodes.find((n) => n.type === 'branch' && n.stage === stage && n.unitId === unitId)
const stageOf = (map, key) => map.stages.find((s) => s.key === key)

test('workflow_map：把文档 / 用例 / 报告 / 验收 / 上线项投影为主线阶段', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '需求正文')
  store.upsertDocument(r.id, '概要设计', '设计正文')
  const testCase = store.upsertTestCase(r.id, { name: '登录回归', prompt: '跑单测' })
  const report = store.createTestReport(r.id, { caseId: testCase.id, kind: 'regression' })
  store.finishTestReport(report.id, { status: 'pass', summary: '全绿' })
  store.upsertReleaseItem(r.id, { name: '上线配置 A', kind: 'config', status: 'done' })
  store.upsertReleaseItem(r.id, { name: '执行上线 SQL', kind: 'sql', status: 'pending' })
  const codeCheck = store.upsertTestCase(r.id, { name: '代码检查', prompt: '跑检查', kind: 'code_check' })
  const codeReport = store.createTestReport(r.id, { caseId: codeCheck.id, kind: 'code_check' })
  store.finishTestReport(codeReport.id, { status: 'pass', summary: '代码检查通过' })

  const map = store.buildWorkflowMap(r.id)
  assert.equal(map.node.id, r.id)
  assert.equal(map.scope, 'self')
  assert.equal(map.units.length, 1)
  assert.equal(map.stages.length, 12)
  assert.equal(branchOf(map, 'requirement', r.id).status, 'pass')
  assert.equal(branchOf(map, 'design', r.id).status, 'pass')
  assert.equal(branchOf(map, 'regression', r.id).status, 'pass')
  assert.equal(branchOf(map, 'test_report', r.id).status, 'pass')
  assert.equal(branchOf(map, 'acceptance', r.id).status, 'pass')
  assert.equal(branchOf(map, 'release_config', r.id).status, 'pass')
  assert.equal(branchOf(map, 'release_sql', r.id).status, 'fail')
  assert.equal(branchOf(map, 'code_check', r.id).status, 'pass')
  assert.equal(stageOf(map, 'release_sql').status, 'fail')
  assert.equal(map.status, 'fail')
})

test('workflow_map：未填需求与未跑验收体现为待关注分支，不伪造成通过', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const testCase = store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  const report = store.createTestReport(r.id, { caseId: testCase.id, kind: 'regression', status: 'running' })

  const map = store.buildWorkflowMap(r.id)
  assert.equal(branchOf(map, 'requirement', r.id).status, 'fail')
  assert.equal(branchOf(map, 'design', r.id).status, 'fail')
  assert.equal(branchOf(map, 'test_report', r.id).status, 'pending')
  assert.equal(branchOf(map, 'acceptance', r.id).status, 'fail')
  assert.equal(stageOf(map, 'test_report').status, 'pending')
  assert.ok(report.id > 0)
})

test('workflow_map：scope=subtree 纳入需求两层并分别给出分支', async (t) => {
  const { tmp, store, p, r, s } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '需求正文')
  store.upsertDocument(r.id, '概要设计', '设计正文')
  store.upsertTestCase(r.id, { name: '父回归', prompt: '跑父需求' })

  const map = store.buildWorkflowMap(p.id, { scope: 'subtree' })
  assert.equal(map.units.length, 2)
  assert.equal(map.units.map((u) => u.id).sort((a, b) => a - b).join(','), [r.id, s.id].sort((a, b) => a - b).join(','))
  assert.equal(branchOf(map, 'requirement', r.id).status, 'pass')
  assert.equal(branchOf(map, 'requirement', s.id).status, 'fail')
  assert.equal(stageOf(map, 'requirement').counts.pass, 1)
  assert.equal(stageOf(map, 'requirement').counts.fail, 1)
})

test('workflow_map：纯读聚合，不产生 revision', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '需求正文')
  const before = store.getRevision()
  store.buildWorkflowMap(r.id)
  store.buildWorkflowMap(r.id, { scope: 'subtree' })
  assert.equal(store.getRevision(), before)
})

test('workflow_map：非法 scope 与其它聚合接口同口径拒绝', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  assert.throws(() => store.buildWorkflowMap(r.id, { scope: 'Subtree' }), /VALIDATION_FAILED/)
})

test('workflow_map：markdown 渲染含阶段与待关注分支', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const { renderWorkflowMapMd } = await import('../server/ops.mjs')
  const md = renderWorkflowMapMd(store.buildWorkflowMap(r.id))
  assert.match(md, /^# 研发主线思维导图：R/m)
  assert.match(md, /需求管理/)
  assert.match(md, /上线 SQL/)
  assert.match(md, /待关注分支/)
})

test('workflow_map：登记进能力清单（MCP / CLI / REST 1:1 的发现入口）', async () => {
  const { TOOLS } = await import('../server/ops.mjs')
  assert.ok(TOOLS.includes('workflow_map'))
})
