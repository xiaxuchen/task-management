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

const checkOf = (readiness, key) => readiness.items.find((i) => i.key === key)

/** 把一条需求补成全部门禁通过 */
function fillRequirement(store, id) {
  const nodeId = id && typeof id === 'object' ? id.id : id
  store.upsertDocument(nodeId, '需求内容', '需求正文')
  store.upsertDocument(nodeId, '概要设计', '设计正文')
  store.upsertTestCase(nodeId, { name: '回归用例', prompt: '跑单测' })
}

test('readiness：新建需求预置空文档不算通过（存在 ≠ 写完）', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  // createNode 预置了空白「需求内容」文档，若只判存在会立刻“就绪”
  const out = store.buildRequirementReadiness(r.id)
  assert.equal(out.ready, false)
  assert.equal(checkOf(out, 'requirement_doc').passed, false)
  assert.equal(checkOf(out, 'design_doc').passed, false)
  assert.equal(checkOf(out, 'regressable_cases').passed, false)
  assert.equal(out.totals.units, 1)
  assert.equal(out.totals.passed, 0)
  assert.equal(out.totals.failed, 3)
})

test('readiness：三条门禁各自独立判定', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '需求正文')
  let out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'requirement_doc').passed, true)
  assert.equal(checkOf(out, 'design_doc').passed, false)
  assert.equal(out.ready, false)

  store.upsertDocument(r.id, '概要设计', '设计正文')
  out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'design_doc').passed, true)
  assert.equal(checkOf(out, 'regressable_cases').passed, false)
  assert.equal(out.ready, false)

  store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'regressable_cases').passed, true)
  assert.equal(out.ready, true)
  assert.equal(out.totals.readyUnits, 1)
  assert.equal(out.totals.pendingUnits, 0)
  assert.deepEqual(out.blockers, [])
})

test('readiness：文档正文只有空白不算通过', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '   \n\t  ')
  store.upsertDocument(r.id, '概要设计', '')
  store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测' })
  const out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'requirement_doc').passed, false)
  assert.equal(checkOf(out, 'design_doc').passed, false)
  assert.equal(checkOf(out, 'regressable_cases').passed, true)
  assert.equal(out.ready, false)
})

test('readiness：停用用例与 code_check 都不算「可回归」', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '正文')
  store.upsertDocument(r.id, '概要设计', '正文')
  // 只有代码检查用例：不在可回归类型里
  store.upsertTestCase(r.id, { name: '代码检查', prompt: '检查', kind: 'code_check' })
  let out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'regressable_cases').passed, false)

  // 补一条 regression，但停用：仍不算通过
  const rc = store.upsertTestCase(r.id, { name: '回归用例', prompt: '跑单测', kind: 'regression' })
  store.updateTestCase(rc.id, { enabled: 0 })
  out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'regressable_cases').passed, false)

  // 启用后通过
  store.updateTestCase(rc.id, { enabled: 1 })
  out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'regressable_cases').passed, true)
  assert.equal(out.ready, true)
})

test('readiness：acceptance 类型也是可回归用例', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '需求内容', '正文')
  store.upsertDocument(r.id, '概要设计', '正文')
  store.upsertTestCase(r.id, { name: '验收用例', prompt: '验收', kind: 'acceptance' })
  const out = store.buildRequirementReadiness(r.id)
  assert.equal(checkOf(out, 'regressable_cases').passed, true)
  assert.equal(out.ready, true)
})

test('readiness：scope=subtree 汇总子树内所有需求两层', async (t) => {
  const { tmp, store, p, r, s } = await setup()
  t.after(() => tmp.cleanup())
  fillRequirement(store, r)
  // 子需求还不齐备
  let out = store.buildRequirementReadiness(p.id, { scope: 'subtree' })
  assert.equal(out.totals.units, 2)
  assert.equal(out.totals.readyUnits, 1)
  assert.equal(out.totals.pendingUnits, 1)
  assert.equal(out.ready, false)
  assert.equal(out.units.find((u) => u.nodeId === s.id).ready, false)
  // 阻塞项按需求带上名字
  assert.ok(out.blockers.every((b) => b.nodeId === s.id))
  assert.equal(out.blockers.length, 3)

  fillRequirement(store, s)
  out = store.buildRequirementReadiness(p.id, { scope: 'subtree' })
  assert.equal(out.ready, true)
  assert.equal(out.totals.readyUnits, 2)
  assert.equal(out.blockers.length, 0)
})

test('readiness：scope=self 在非需求节点上拒绝，并提示改用 subtree', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())
  assert.throws(() => store.buildRequirementReadiness(p.id), /VALIDATION_FAILED/)
  assert.throws(() => store.buildRequirementReadiness(p.id), /scope=subtree/)
})

test('readiness：子树无需求时返回空态 ready=null（不伪造成 true/false，也不抛错）', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())
  // 把唯一需求删掉，项目子树里就没有需求了
  const r = store.listChildren(p.id)[0]
  store.deleteNode(r.id)
  const out = store.buildRequirementReadiness(p.id, { scope: 'subtree' })
  assert.equal(out.ready, null)
  assert.equal(out.totals.units, 0)
  assert.equal(out.totals.checks, 0)
  assert.deepEqual(out.units, [])
  assert.deepEqual(out.blockers, [])
})

test('readiness：纯读聚合，不产生 revision', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  fillRequirement(store, r)
  const before = store.getRevision()
  store.buildRequirementReadiness(r.id)
  store.buildRequirementReadiness(r.id, { scope: 'subtree' })
  assert.equal(store.getRevision(), before)
})

test('readiness：markdown 渲染含结论与阻塞项', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const { renderReadinessMd } = await import('../server/ops.mjs')
  let md = renderReadinessMd(store.buildRequirementReadiness(r.id))
  assert.match(md, /尚不可进入回归测试/)
  assert.match(md, /阻塞项/)

  fillRequirement(store, r)
  md = renderReadinessMd(store.buildRequirementReadiness(r.id))
  assert.match(md, /可进入回归测试/)
  assert.ok(!/阻塞项/.test(md))
})
