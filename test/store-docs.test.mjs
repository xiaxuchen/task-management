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

test('新建节点按类型预置空文档', async () => {
  const { tmp, store, p, task } = await setup()
  assert.deepEqual(
    store.listDocuments(p.id).map((d) => d.name),
    ['描述']
  )
  assert.deepEqual(store.listDocuments(task.id), [])
  tmp.cleanup()
})

test('按文档名 upsert 幂等，内容被覆盖', async () => {
  const { tmp, store, task } = await setup()
  const first = store.upsertDocument(task.id, '复现步骤', '第一步')
  assert.equal(first.created, true)
  const second = store.upsertDocument(task.id, '复现步骤', '第一步、第二步')
  assert.equal(second.created, false)
  assert.equal(second.id, first.id)
  const docs = store.listDocuments(task.id)
  assert.equal(docs.length, 1)
  assert.equal(docs[0].content, '第一步、第二步')
  tmp.cleanup()
})

test('重名新建报 DOC_NAME_EXISTS，改名撞名也报错', async () => {
  const { tmp, store, task } = await setup()
  store.createDocument(task.id, 'A')
  assert.throws(() => store.createDocument(task.id, 'A'), /DOC_NAME_EXISTS/)
  const b = store.createDocument(task.id, 'B')
  assert.throws(() => store.updateDocument(b.id, { name: 'A' }), /DOC_NAME_EXISTS/)
  tmp.cleanup()
})

test('排序与删除', async () => {
  const { tmp, store, task } = await setup()
  const a = store.createDocument(task.id, 'A', 'a')
  const b = store.createDocument(task.id, 'B', 'b')
  const c = store.createDocument(task.id, 'C', 'c')
  store.reorderDocuments(task.id, [c.id, a.id, b.id])
  assert.deepEqual(
    store.listDocuments(task.id).map((d) => d.name),
    ['C', 'A', 'B']
  )
  store.deleteDocument(b.id)
  assert.deepEqual(
    store.listDocuments(task.id).map((d) => d.name),
    ['C', 'A']
  )
  tmp.cleanup()
})
