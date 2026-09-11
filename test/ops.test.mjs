import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const { createStore } = tmp.store
  const store = createStore(db)
  const { buildSchema, renderTreeMd, upsertByPath, parseOutline, importOutline, applyBatch } = await import('../server/ops.mjs')
  return { tmp, db, store, buildSchema, renderTreeMd, upsertByPath, parseOutline, importOutline, applyBatch }
}

// ---------- buildSchema ----------

test('buildSchema 返回节点类型与状态定义', async () => {
  const { tmp, store, buildSchema } = await setup()
  const schema = buildSchema(store, { status: { labels: { todo: '待开始' }, allowed: { project: ['todo'] } } })
  assert.ok(Array.isArray(schema.nodeTypes))
  assert.ok(schema.nodeTypes.find((n) => n.type === 'project'))
  assert.equal(schema.nodeTypes.find((n) => n.type === 'task').allowedChildren[0], 'defect')
  assert.equal(schema.status.labels.todo, '待开始')
  assert.ok(Array.isArray(schema.tools))
  assert.ok(schema.tools.includes('schema'))
  tmp.cleanup()
})

// ---------- renderTreeMd ----------

test('renderTreeMd 输出 markdown 缩进树', async () => {
  const { tmp, store, renderTreeMd, buildSchema } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const tree = store.listTree()
  const md = renderTreeMd(store, tree)
  assert.ok(md.startsWith('- P'))
  assert.ok(md.includes('- R'))
  tmp.cleanup()
})

test('renderTreeMd 支持 task/defect 标签', async () => {
  const { tmp, store, renderTreeMd } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  store.createNode({ parentId: t.id, type: 'defect', name: 'D' })
  const md = renderTreeMd(store, store.listTree())
  assert.ok(md.includes('[task] T'))
  assert.ok(md.includes('[defect] D'))
  tmp.cleanup()
})

// ---------- upsertByPath ----------

test('upsertByPath 幂等创建与属性更新', async () => {
  const { tmp, store, upsertByPath } = await setup()
  const out1 = upsertByPath(store, '项目/需求1')
  assert.equal(out1.node.name, '需求1')
  assert.equal(out1.steps.length, 2) // project + requirement 新建

  const out2 = upsertByPath(store, '项目/需求1')
  assert.equal(out2.steps.length, 0) // 已存在

  const out3 = upsertByPath(store, '项目/需求1', { type: 'requirement', attrs: { start_date: '2026-01-01' } })
  assert.equal(out3.node.name, '需求1')
  assert.ok(out3.steps.some((s) => s.action === 'attr'))

  tmp.cleanup()
})

test('upsertByPath 支持 dryRun', async () => {
  const { tmp, store, upsertByPath } = await setup()
  const out = upsertByPath(store, '新项目/子', { dryRun: true })
  assert.equal(out.steps.length, 2)
  assert.equal(out.node.id, null) // 未实际创建
  assert.equal(store.listTree().length, 0)
  tmp.cleanup()
})

// ---------- parseOutline / importOutline ----------

test('parseOutline 解析 markdown 大纲', async () => {
  const { tmp, parseOutline } = await setup()
  const md = `- 项目A
  - 需求1
    - [task] 子任务1
      - 预估工时: 8
    - [defect] 缺陷1
  - 需求2`
  const tree = parseOutline(md)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].name, '项目A')
  assert.equal(tree[0].children.length, 2)
  assert.equal(tree[0].children[0].children[0].type, 'task')
  assert.equal(tree[0].children[0].children[0].attrs['预估工时'], '8')
  tmp.cleanup()
})

test('parseOutline 跳过 # 注释行', async () => {
  const { tmp, parseOutline } = await setup()
  const tree = parseOutline('# 注释\n- 项目\n  - 需求')
  assert.equal(tree.length, 1)
  assert.equal(tree[0].children.length, 1)
  tmp.cleanup()
})

test('importOutline 导入整棵树', async () => {
  const { tmp, store, importOutline } = await setup()
  const md = `- 项目
  - 需求A
    - 子需求1
      - 任务组1
        - [task] 子任务1`
  const result = importOutline(store, md)
  assert.equal(result.count, 5)
  assert.equal(store.listTree().length, 1)
  const root = store.listTree()[0]
  assert.equal(root.name, '项目')
  assert.equal(root.children[0].children[0].children[0].children[0].type, 'task')
  tmp.cleanup()
})

test('importOutline dryRun 不写库', async () => {
  const { tmp, store, importOutline } = await setup()
  const md = '- 项目\n  - 需求'
  const result = importOutline(store, md, { dryRun: true })
  assert.equal(result.dryRun, true)
  assert.equal(result.count, 2)
  assert.equal(store.listTree().length, 0)
  tmp.cleanup()
})

test('importOutline 支持 parentPath', async () => {
  const { tmp, store, importOutline } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const md = `- 需求1
  - 子需求1`
  const result = importOutline(store, md, { parentPath: 'P' })
  assert.equal(result.count, 2)
  assert.equal(store.listChildren(p.id).length, 1)
  tmp.cleanup()
})

// ---------- applyBatch ----------

test('applyBatch 批量创建节点', async () => {
  const { tmp, store, applyBatch } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const ops = [
    { op: 'node.create', parentId: p.id, type: 'requirement', name: '需求1' },
    { op: 'node.create', parentId: p.id, type: 'requirement', name: '需求2' }
  ]
  const result = applyBatch(store, ops)
  assert.equal(result.total, 2)
  assert.equal(result.failed, 0)
  assert.equal(store.listChildren(p.id).length, 2)
  tmp.cleanup()
})

test('applyBatch 单个失败不影响其余', async () => {
  const { tmp, store, applyBatch } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const ops = [
    { op: 'node.create', parentId: p.id, type: 'requirement', name: 'R1' },
    { op: 'node.create', parentId: 99999, type: 'requirement', name: 'R2' }, // 父节点不存在
    { op: 'node.create', parentId: p.id, type: 'requirement', name: 'R3' }
  ]
  const result = applyBatch(store, ops)
  assert.equal(result.total, 3)
  assert.equal(result.failed, 1)
  assert.equal(result.results[0].ok, true)
  assert.equal(result.results[1].ok, false)
  assert.equal(result.results[2].ok, true)
  tmp.cleanup()
})

test('applyBatch 支持 node.upsert 与 doc.upsert', async () => {
  const { tmp, store, applyBatch } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const ops = [
    { op: 'node.upsert', path: 'P/需求1' },
    { op: 'doc.upsert', ref: 'P', name: '描述', content: '项目描述正文' }
  ]
  const result = applyBatch(store, ops)
  assert.equal(result.total, 2)
  assert.equal(result.failed, 0)
  const docs = store.listDocuments(p.id)
  assert.ok(docs.some((d) => d.name === '描述' && d.content === '项目描述正文'))
  tmp.cleanup()
})