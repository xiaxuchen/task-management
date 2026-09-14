import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s1 = store.createNode({ parentId: r.id, type: 'subreq', name: 'S1' })
  const g = store.createNode({ parentId: s1.id, type: 'group', name: 'G' })
  const t1 = store.createNode({ parentId: g.id, type: 'task', name: 'T1' })
  const s2 = store.createNode({ parentId: r.id, type: 'subreq', name: 'S2' })
  return { tmp, store, p, r, s1, g, t1, s2 }
}

const { renderDesignOutlineMd, applyDesignOutline } = await import('../server/ops.mjs')

// ---------- buildDesignOutline ----------

test('design outline：从需求树推导结构树与节点计数', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const out = store.buildDesignOutline(r.id)
  assert.equal(out.node.id, r.id)
  assert.equal(out.scope, 'self')
  assert.equal(out.totals.units, 1)
  // R + S1 + G + T1 + S2 = 5
  assert.equal(out.totals.nodes, 5)
  assert.equal(out.units[0].tree.name, 'R')
  assert.deepEqual(out.units[0].tree.children.map((c) => c.name), ['S1', 'S2'])
  assert.deepEqual(out.units[0].tree.children[0].children[0].children.map((c) => c.name), ['T1'])
})

test('design outline：scope=subtree 在项目上逐需求返回，节点计数含全部层级', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())

  // 挂在项目上 scope=subtree：项目本身不是需求，但子树里有，选用 subtree 得到逐需求单元
  const out = store.buildDesignOutline(p.id, { scope: 'subtree' })
  // R / S1 / S2 三个需求单元
  assert.equal(out.totals.units, 3)
  // 每个单元各自计入自己子树（含父子重叠，符合「逐需求各写一份骨架」的用途）
  assert.deepEqual(
    out.units.map((u) => [u.name, u.nodeCount]),
    [
      ['R', 5],
      ['S1', 3],
      ['S2', 1]
    ]
  )
  assert.equal(out.totals.nodes, 9)
})

test('design outline：子树里没有需求时 units 为空（空态不报错）', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb())
  const lonelyProject = store.createNode({ type: 'project', name: '空项目' })

  const out = store.buildDesignOutline(lonelyProject.id, { scope: 'subtree' })
  assert.equal(out.totals.units, 0)
  assert.equal(out.totals.nodes, 0)
  assert.deepEqual(out.units, [])
})

test('design outline：非需求类型 scope=self 拒绝并提示 subtree', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())

  assert.throws(
    () => store.buildDesignOutline(p.id),
    (e) => e.code === 'VALIDATION_FAILED' && /subtree/.test(e.message)
  )
})

test('design outline：scope 非法值报 VALIDATION_FAILED，不静默降级 self', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  for (const bad of ['Subtree', 'subtre', '', 'xyz', 'all']) {
    assert.throws(
      () => store.buildDesignOutline(r.id, { scope: bad }),
      (e) => e.code === 'VALIDATION_FAILED' && Array.isArray(e.details.allowed),
      `scope=${JSON.stringify(bad)} 应被拒绝`
    )
  }
})

test('design outline：只读聚合，不写库、不动 revision', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const before = store.getRevision()
  store.buildDesignOutline(r.id)
  store.buildDesignOutline(r.id, { scope: 'subtree' })
  assert.equal(store.getRevision(), before)
})

// ---------- renderDesignOutlineMd ----------

test('renderDesignOutlineMd：输出 mermaid mindmap + 逐层小节', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const md = renderDesignOutlineMd(store.buildDesignOutline(r.id))
  assert.match(md, /^# 概要设计：R/m)
  assert.match(md, /```mermaid/)
  assert.match(md, /^mindmap$/m)
  assert.match(md, /root\(\("R"\)\)/)
  // 每一层结构都进了脑图
  for (const name of ['S1', 'G', 'T1', 'S2']) assert.ok(md.includes(`["${name}"]`), `脑图缺少 ${name}`)
  // 小节标题与节点名对齐
  assert.match(md, /^### R$/m)
  assert.match(md, /^#### S1$/m)
  assert.match(md, /^##### G$/m)
  assert.match(md, /^###### T1$/m)
})

test('renderDesignOutlineMd：节点名里的双引号 / 换行不会破坏 mermaid 语法', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())
  const r2 = store.createNode({ parentId: p.id, type: 'requirement', name: 'R"2' })
  store.createNode({ parentId: r2.id, type: 'subreq', name: '带\n换行' })

  const md = renderDesignOutlineMd(store.buildDesignOutline(r2.id))
  const mermaidBlock = md.split('```mermaid')[1].split('```')[0]
  // 引号被替换成单引号，换行被压平；脑图块里不应再有裸双引号包裹的原始值
  assert.ok(mermaidBlock.includes(`root(("R'2"))`), '根节点名双引号应被替换')
  assert.ok(mermaidBlock.includes('["带 换行"]'), '换行应被压平')
  assert.ok(!/带\n换行/.test(mermaidBlock), '脑图块不应含裸换行节点名')
})

test('renderDesignOutlineMd：光杆需求也能产出最小骨架（脑图 + 自身小节）', async (t) => {
  const { tmp, store, p } = await setup()
  t.after(() => tmp.cleanup())
  const lonely = store.createNode({ parentId: p.id, type: 'requirement', name: '光杆需求' })

  const md = renderDesignOutlineMd(store.buildDesignOutline(lonely.id))
  assert.match(md, /root\(\("光杆需求"\)\)/)
  assert.match(md, /^### 光杆需求$/m)
})

test('renderDesignOutlineMd：没有可推导需求时给出明确空态提示', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb())
  const lonelyProject = store.createNode({ type: 'project', name: '空项目' })

  const md = renderDesignOutlineMd(store.buildDesignOutline(lonelyProject.id, { scope: 'subtree' }))
  assert.match(md, /没有可推导的节点结构/)
})

// ---------- applyDesignOutline ----------

test('applyDesignOutline：写入「概要设计」文档，并让需求就绪门禁的 design_doc 通过', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const before = store.buildRequirementReadiness(r.id).items.find((i) => i.key === 'design_doc')
  assert.equal(before.passed, false, '写入前概要设计门禁未通过')

  const out = applyDesignOutline(store, r.id)
  assert.equal(out.written, 1)
  assert.equal(out.designDoc, '概要设计')
  assert.equal(out.results[0].created, true)

  const doc = store.listDocuments(r.id).find((d) => d.name === '概要设计')
  assert.ok(doc, '应存在「概要设计」文档')
  assert.match(doc.content, /mindmap/)

  const after = store.buildRequirementReadiness(r.id).items.find((i) => i.key === 'design_doc')
  assert.equal(after.passed, true, '写入后概要设计门禁应通过')
})

test('applyDesignOutline：默认不覆盖已填写内容（避免冲掉人工 / AI 写的设计）', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '概要设计', '人工写好的设计正文')

  const out = applyDesignOutline(store, r.id)
  assert.equal(out.written, 0)
  assert.equal(out.skipped, 1)
  assert.equal(out.results[0].reason, 'already_filled')
  assert.equal(store.listDocuments(r.id).find((d) => d.name === '概要设计').content, '人工写好的设计正文')
})

test('applyDesignOutline：overwrite=true 才覆盖已有正文', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())
  store.upsertDocument(r.id, '概要设计', '旧正文')

  const out = applyDesignOutline(store, r.id, { overwrite: true })
  assert.equal(out.written, 1)
  const content = store.listDocuments(r.id).find((d) => d.name === '概要设计').content
  assert.notEqual(content, '旧正文')
  assert.match(content, /mindmap/)
})

test('applyDesignOutline：dryRun 不写库、不动 revision，只回报将写哪些', async (t) => {
  const { tmp, store, r } = await setup()
  t.after(() => tmp.cleanup())

  const before = store.getRevision()
  const out = applyDesignOutline(store, r.id, { dryRun: true })
  assert.equal(out.dryRun, true)
  assert.equal(out.written, 0)
  assert.equal(out.results[0].reason, 'dry_run')
  assert.equal(store.getRevision(), before)
  assert.equal(store.listDocuments(r.id).find((d) => d.name === '概要设计'), undefined)
})

test('applyDesignOutline：scope=subtree 逐需求各写一份，各自独立判定覆盖', async (t) => {
  const { tmp, store, r, s2 } = await setup()
  t.after(() => tmp.cleanup())
  // 子需求 S2 已有内容：默认应跳过，R 正常写入
  store.upsertDocument(s2.id, '概要设计', 'S2 已有设计')

  const out = applyDesignOutline(store, r.id, { scope: 'subtree' })
  // subtree 逐需求：R / S1 / S2 三个单元，其中 S2 已有内容被跳过
  assert.equal(out.written, 2, 'R 与 S1 写入')
  assert.equal(out.skipped, 1, 'S2 跳过')
  assert.equal(store.listDocuments(s2.id).find((d) => d.name === '概要设计').content, 'S2 已有设计')
  assert.ok(store.listDocuments(r.id).find((d) => d.name === '概要设计'))
})

test('applyDesignOutline：文档名取自 config.readiness.designDoc，与门禁判定同一份', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb(), {
    readiness: { requirementDoc: '需求内容', designDoc: '详细设计', caseKinds: ['regression'] }
  })
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })

  const out = applyDesignOutline(store, r.id)
  assert.equal(out.designDoc, '详细设计')
  assert.ok(store.listDocuments(r.id).find((d) => d.name === '详细设计'))
  assert.equal(store.buildRequirementReadiness(r.id).items.find((i) => i.key === 'design_doc').passed, true)
})
