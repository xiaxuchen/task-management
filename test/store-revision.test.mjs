import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  return { tmp, store }
}

test('任何写入都会让 revision +1', async () => {
  const { tmp, store } = await setup()
  assert.equal(store.getRevision(), 0)
  const p = store.createNode({ type: 'project', name: 'P' })
  assert.equal(store.getRevision(), 1)
  store.updateNode(p.id, { status: 'doing' })
  assert.equal(store.getRevision(), 2)
  store.upsertDocument(p.id, '描述', '正文')
  assert.equal(store.getRevision(), 3)
  store.deleteNode(p.id)
  assert.equal(store.getRevision(), 4)
  tmp.cleanup()
})

test('created_by / updated_by 记录操作者（user | ai | cli | import | mcp）', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P', actor: 'ai' })
  assert.equal(p.createdBy, 'ai')
  assert.equal(p.updatedBy, 'ai')
  const updated = store.updateNode(p.id, { name: 'P2' }, 'cli')
  assert.equal(updated.updatedBy, 'cli')
  assert.equal(updated.createdBy, 'ai')
  const doc = store.upsertDocument(p.id, '描述', 'AI 写的', 'ai')
  assert.equal(store.listDocuments(p.id).find((d) => d.id === doc.id).updatedBy, 'ai')
  // 'mcp' 是 MCP 入口的 actor：必须在值域内原样落库，不得静默降级成 'user'（否则 AI 写的
  // 文档在审计上冒充用户写的）
  const mcpDoc = store.upsertDocument(p.id, '概要设计', 'MCP 写的', 'mcp')
  assert.equal(store.listDocuments(p.id).find((d) => d.id === mcpDoc.id).updatedBy, 'mcp')
  const mcpNode = store.createNode({ type: 'project', name: 'P4', actor: 'mcp' })
  assert.equal(mcpNode.createdBy, 'mcp')
  const bad = store.createNode({ type: 'project', name: 'P3', actor: 'someone' })
  assert.equal(bad.createdBy, 'user')
  tmp.cleanup()
})
