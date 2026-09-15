import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const p1 = store.createNode({ type: 'project', name: '项目A' })
  const p2 = store.createNode({ type: 'project', name: '项目B' })
  return { tmp, store, p1, p2 }
}

test('需求条目：创建时关联需求内容与概要设计两份文档', async () => {
  const { tmp, store, p1 } = await setup()
  const r = store.createRequirement({ projectId: p1.id, name: '需求A' })
  assert.equal(r.type, 'requirement')
  assert.equal(r.projectId, p1.id)
  assert.deepEqual(
    r.docState.map((d) => [d.name, d.linked, d.filled]),
    [
      ['需求内容', true, false],
      ['概要设计', true, false]
    ]
  )
  assert.equal(r.readiness.ready, false)
  tmp.cleanup()
})

test('需求列表与 KPI：可按项目 / 状态筛选，并统计文档缺口', async () => {
  const { tmp, store, p1, p2 } = await setup()
  const a = store.createRequirement({ projectId: p1.id, name: 'A' })
  store.createRequirement({ projectId: p2.id, name: 'B' })
  store.transitionRequirement(a.id, { status: 'doing' })
  store.upsertDocument(a.id, '需求内容', '正文')

  assert.equal(store.listRequirements({ projectId: p1.id }).length, 1)
  assert.equal(store.listRequirements({ status: 'doing' }).length, 1)
  const summary = store.requirementSummary({ projectId: p1.id })
  assert.equal(summary.total, 1)
  assert.equal(summary.byStatus.doing, 1)
  assert.equal(summary.missingRequirementDoc, 0)
  assert.equal(summary.missingDesignDoc, 1)
  tmp.cleanup()
})

test('需求状态机：合法路径逐段推进，非法跳转拒绝', async () => {
  const { tmp, store, p1 } = await setup()
  const r = store.createRequirement({ projectId: p1.id, name: 'R' })
  assert.equal(store.transitionRequirement(r.id, { status: 'doing' }).status, 'doing')
  assert.equal(store.transitionRequirement(r.id, { status: 'testing' }).status, 'testing')
  assert.equal(store.transitionRequirement(r.id, { status: 'done' }).status, 'done')
  assert.throws(() => store.transitionRequirement(r.id, { status: 'todo' }), /VALIDATION_FAILED/)
  tmp.cleanup()
})

test('需求状态机：未完成前可取消，取消后可恢复待开始', async () => {
  const { tmp, store, p1 } = await setup()
  const r = store.createRequirement({ projectId: p1.id, name: 'R' })
  assert.equal(store.transitionRequirement(r.id, { status: 'cancelled' }).status, 'cancelled')
  assert.equal(store.transitionRequirement(r.id, { status: 'todo' }).status, 'todo')
  tmp.cleanup()
})

test('通用 node.update 也不能绕过需求状态机', async () => {
  const { tmp, store, p1 } = await setup()
  const r = store.createRequirement({ projectId: p1.id, name: 'R' })
  assert.throws(() => store.updateNode(r.id, { status: 'done' }), /VALIDATION_FAILED/)
  assert.equal(store.getNode(r.id).status, 'todo')
  tmp.cleanup()
})
