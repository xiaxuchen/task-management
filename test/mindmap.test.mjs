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
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return { tmp, store, p, r, s, t }
}

test('mindmap：scope=self 只画本节点，subtree 画整棵子树', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const self = store.buildMindmap(r.id, { scope: 'self' })
  assert.equal(self.scope, 'self')
  assert.equal(self.totals.nodes, 1)
  assert.equal(self.totals.edges, 0)
  assert.equal(self.totals.depth, 0)
  assert.equal(self.nodes[0].name, 'R')

  const subtree = store.buildMindmap(r.id, { scope: 'subtree' })
  assert.equal(subtree.totals.nodes, 3)
  assert.equal(subtree.totals.edges, 2)
  assert.equal(subtree.totals.depth, 2)
  assert.deepEqual(subtree.totals.byType, { requirement: 1, subreq: 1, task: 1 })
  // 每个非根节点恰有一条入边 → 边数 = 节点数 - 1（树的性质）
  assert.equal(subtree.edges.length, subtree.nodes.length - 1)
})

test('mindmap：对外契约字段受控（nodes 只含 id/name/type/status/depth，父子关系只由 edges 表达）', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const mm = store.buildMindmap(r.id, { scope: 'subtree' })
  for (const n of mm.nodes) {
    assert.deepEqual(Object.keys(n).sort(), ['depth', 'id', 'name', 'status', 'type'])
  }
  // 不得把内部用于遍历的 children 字段泄漏到对外 JSON（契约以 R2 为准）
  assert.ok(!JSON.stringify(mm).includes('"children"'))
  for (const e of mm.edges) assert.deepEqual(Object.keys(e).sort(), ['from', 'to'])
})

test('mindmap：mermaid 首行是 mindmap，缩进按深度逐层 +2 空格，父先于子', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const mm = store.buildMindmap(r.id, { scope: 'subtree' })
  const lines = mm.mermaid.trimEnd().split('\n')
  assert.equal(lines[0], 'mindmap')
  // 顶层节点必须唯一且不缩进（mermaid mindmap 硬约束）
  assert.equal(lines[1], '["R"]')
  assert.equal(lines[2], '  ["S"]')
  assert.equal(lines[3], '    ["T"]')
  assert.equal(lines.length, 4)
})

test('mindmap：标签转义双引号与 &（避免提前闭合节点串 / 二次转义）', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())
  const tricky = store.createNode({ parentId: p.id, type: 'requirement', name: 'a "b" & c &amp; d' })

  const mm = store.buildMindmap(tricky.id)
  // `"` → &quot;、`&` → &amp;；已存在的 &amp; 里的 & 也要被转义（先 & 后 "），不会二次转义成 &amp;amp;
  assert.match(mm.mermaid, /\["a &quot;b&quot; &amp; c &amp;amp; d"\]/)
  assert.ok(!/"b"/.test(mm.mermaid), '不应残留裸双引号导致节点串提前闭合')
})

test('mindmap：空名用占位符，避免 [""] 解析失败', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())
  // createNode 拒绝空名，故直接改库模拟历史脏数据 / 导入遗留
  const n = store.db.prepare("INSERT INTO nodes (type, parent_id, name, status, sort, created_at, updated_at, created_by, updated_by) VALUES ('requirement', ?, '', 'todo', 9, ?, ?, 'test', 'test')").run(p.id, new Date().toISOString(), new Date().toISOString())
  const mm = store.buildMindmap(Number(n.lastInsertRowid))
  assert.equal(mm.mermaid.trimEnd().split('\n')[1], '["（未命名）"]')
})

test('mindmap：maxDepth 截断子树并计数，0 只保留根', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const d0 = store.buildMindmap(r.id, { scope: 'subtree', maxDepth: 0 })
  assert.equal(d0.totals.nodes, 1)
  assert.equal(d0.totals.truncated, 1)
  assert.equal(d0.mermaid.trimEnd().split('\n').length, 2)

  const d1 = store.buildMindmap(r.id, { scope: 'subtree', maxDepth: 1 })
  assert.equal(d1.totals.nodes, 2)
  assert.equal(d1.totals.depth, 1)
  assert.equal(d1.totals.truncated, 1)
})

test('mindmap：非法 maxDepth 一律 VALIDATION_FAILED，不静默降级', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  // '' / 越界 / 非整数都必须报错——否则 `?maxDepth=` 会被 Number('') 静默截成只剩根节点
  for (const bad of ['', -1, 51, 1.5, 'x', NaN]) {
    assert.throws(
      () => store.buildMindmap(r.id, { maxDepth: bad }),
      (e) => e.code === 'VALIDATION_FAILED',
      `maxDepth=${JSON.stringify(bad)} 应当被拒绝`
    )
  }
  // 缺省不截断
  assert.equal(store.buildMindmap(r.id, { scope: 'subtree' }).totals.truncated, 0)
})

test('mindmap：纯读——不落表、不动 revision', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const before = store.getRevision()
  store.buildMindmap(r.id, { scope: 'subtree' })
  store.buildMindmap(r.id, { scope: 'subtree', maxDepth: 1 })
  assert.equal(store.getRevision(), before, '导图是只读投影，不应推进 revision')
})

test('mindmap：renderMindmapMd 输出可粘贴的 mermaid 代码块与统计行', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  const { renderMindmapMd } = await import('../server/ops.mjs')

  const md = renderMindmapMd(store.buildMindmap(r.id, { scope: 'subtree' }))
  assert.match(md, /^# 思维导图：R/m)
  assert.match(md, /- 范围：含子树/)
  assert.match(md, /- 节点：3 · 连接：2 · 深度：2/)
  assert.match(md, /```mermaid\nmindmap\n/)
  assert.match(md, /```\s*$/)
})

test('mindmap：TOOLS 清单登记（schema 自描述可见）', async (t) => {
  const { tmp } = await setup()
  t.after(() => tmp.cleanup())
  const { TOOLS } = await import('../server/ops.mjs')
  assert.ok(TOOLS.includes('mindmap'))
})
