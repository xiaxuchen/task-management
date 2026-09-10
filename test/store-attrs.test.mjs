import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  return { tmp, store, p, r }
}

test('预置属性定义可列出，且新增自定义属性', async () => {
  const { tmp, store } = await setup()
  const defs = store.listAttrDefs('requirement')
  assert.ok(defs.some((d) => d.key === 'test_submit_date' && d.dataType === 'date'))
  const created = store.addAttrDef({ nodeType: 'requirement', key: 'owner', label: '负责人', dataType: 'text' })
  assert.equal(created.key, 'owner')
  assert.equal(store.listAttrDefs('requirement').length, defs.length + 1)
  tmp.cleanup()
})

test('值校验：number / date / select / 必填 / 未知 key', async () => {
  const { tmp, store, r } = await setup()
  store.addAttrDef({
    nodeType: 'requirement',
    key: 'level',
    label: '优先级',
    dataType: 'select',
    options: [{ value: 'p0', label: 'P0' }]
  })
  store.addAttrDef({ nodeType: 'requirement', key: 'must', label: '必填项', dataType: 'text', required: true })

  store.setAttrs(r.id, { estimate_hours: '8' })
  assert.equal(store.getAttrs(r.id).estimate_hours, '8')
  assert.throws(() => store.setAttrs(r.id, { estimate_hours: '八小时' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { test_submit_date: '2026/09/11' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { level: 'p9' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { must: '' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { not_exist: 'x' }), /VALIDATION_FAILED/)
  tmp.cleanup()
})

test('属性定义停用后不再校验，历史值保留', async () => {
  const { tmp, store, r } = await setup()
  const def = store.addAttrDef({ nodeType: 'requirement', key: 'must', label: '必填项', dataType: 'text', required: true })
  store.setAttrs(r.id, { must: 'ok' })
  store.updateAttrDef(def.id, { enabled: false })
  store.setAttrs(r.id, { estimate_hours: '1' })
  assert.equal(store.getAttrs(r.id).must, 'ok')
  assert.equal(
    store.listAttrDefs('requirement').some((d) => d.key === 'must'),
    false
  )
  tmp.cleanup()
})

test('删除属性定义连带删除其值', async () => {
  const { tmp, store, r } = await setup()
  const def = store.addAttrDef({ nodeType: 'requirement', key: 'tmp_key', label: '临时', dataType: 'text' })
  store.setAttrs(r.id, { tmp_key: 'v' })
  store.deleteAttrDef(def.id)
  assert.equal(store.getAttrs(r.id).tmp_key, undefined)
  tmp.cleanup()
})
