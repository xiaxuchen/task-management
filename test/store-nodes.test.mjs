import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const { createStore } = tmp.store
  const store = createStore(db)
  return { tmp, db, store }
}

test('建五级树 + 缺陷，并返回树形结构', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: '充电平台' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: '3.1 收发货' })
  const g = store.createNode({ parentId: s.id, type: 'group', name: '任务组A' })
  const t = store.createNode({ parentId: g.id, type: 'task', name: '子任务1' })
  store.createNode({ parentId: t.id, type: 'defect', name: '登录报错' })

  const tree = store.listTree()
  assert.equal(tree.length, 1)
  assert.equal(tree[0].name, '充电平台')
  assert.equal(tree[0].children[0].children[0].children[0].children[0].children[0].type, 'defect')
  assert.deepEqual(store.getNode(p.id).path, '充电平台')
  assert.equal(store.getNode(t.id).path, '充电平台/26Q3/3.1 收发货/任务组A/子任务1')
  tmp.cleanup()
})

test('父子类型非法与叶子节点被拒', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  assert.throws(() => store.createNode({ parentId: p.id, type: 'task', name: 'x' }), /PARENT_TYPE_INVALID/)
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  assert.throws(() => store.createNode({ parentId: t.id, type: 'group', name: 'x' }), /PARENT_TYPE_INVALID/)
  const d = store.createNode({ parentId: t.id, type: 'defect', name: '登录报错' })
  assert.throws(() => store.createNode({ parentId: d.id, type: 'defect', name: '套娃' }), /LEAF_NODE/)
  tmp.cleanup()
})

test('移动到自身后代被判成环', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  assert.throws(() => store.updateNode(p.id, { parentId: s.id }), /CYCLE_DETECTED/)
  tmp.cleanup()
})

test('级联删除返回删除计数', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  store.upsertDocument(t.id, '描述', '正文')
  const res = store.deleteNode(p.id)
  assert.equal(res.nodes, 4)
  assert.equal(res.documents, 4)
  assert.equal(store.listTree().length, 0)
  tmp.cleanup()
})

test('同级排序与 reorder', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const a = store.createNode({ parentId: p.id, type: 'requirement', name: 'A' })
  const b = store.createNode({ parentId: p.id, type: 'requirement', name: 'B' })
  const c = store.createNode({ parentId: p.id, type: 'requirement', name: 'C' })
  assert.ok(a.sort < b.sort && b.sort < c.sort)
  store.reorderSiblings(p.id, [c.id, a.id, b.id])
  const names = store.listChildren(p.id).map((n) => n.name)
  assert.deepEqual(names, ['C', 'A', 'B'])
  tmp.cleanup()
})
