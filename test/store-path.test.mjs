import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

test('resolveRef 支持 id 与路径，歧义与不存在分别报错', async () => {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const p = store.createNode({ type: 'project', name: '充电平台' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: '3.1 收发货' })

  assert.equal(store.resolveRef(s.id).id, s.id)
  assert.equal(store.resolveRef(String(s.id)).id, s.id)
  assert.equal(store.resolveRef('充电平台/26Q3/3.1 收发货').id, s.id)

  assert.throws(() => store.resolveRef('充电平台/不存在'), /PATH_NOT_FOUND/)

  // 同名兄弟 → 歧义
  store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3' })
  assert.throws(() => store.resolveRef('充电平台/26Q3'), /PATH_AMBIGUOUS/)
  tmp.cleanup()
})
