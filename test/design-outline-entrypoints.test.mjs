import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tempHome } from './helpers.mjs'

const execFileP = promisify(execFile)
const CLI = path.resolve(import.meta.dirname, '../bin/taskboard.js')

async function cli(home, args) {
  const { stdout } = await execFileP('node', [CLI, ...args], {
    env: { ...process.env, TASKBOARD_HOME: home },
    encoding: 'utf8'
  })
  return JSON.parse(stdout)
}

async function cliFail(home, args) {
  try {
    await execFileP('node', [CLI, ...args], { env: { ...process.env, TASKBOARD_HOME: home }, encoding: 'utf8' })
    return null
  } catch (e) {
    return { stderr: String(e.stderr || '') + String(e.stdout || '') }
  }
}

async function httpSetup() {
  const tmp = await tempHome()
  const { createStore } = tmp.store
  const store = createStore(tmp.openDb())
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  let server
  const base = await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
    server.once('error', reject)
  })
  const raw = (method, p, body) =>
    fetch(`${base}${p}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const get = (p) => raw('GET', p).then((r) => r.json())
  const post = (p, body) => raw('POST', p, body).then((r) => r.json())
  const text = (p) => raw('GET', p).then((r) => r.text())
  const close = () => new Promise((r) => server.close(r))
  const cleanup = () => {
    close()
    tmp.cleanup()
  }
  return { tmp, store, base, get, post, text, close, cleanup }
}

async function mcpSetup() {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = createMcpServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'taskboard-design-outline-test', version: '1.0.0' })
  await client.connect(clientTransport)
  return {
    tmp,
    store,
    call: (name, args) => client.callTool({ name, arguments: args }),
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

// ---------- HTTP ----------

test('HTTP design-outline：JSON 返回结构树，format=md 返回可写入的骨架', async (t) => {
  const { tmp, store, get, text, cleanup } = await httpSetup()
  t.after(cleanup)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })

  const json = await get(`/api/nodes/${r.id}/design-outline`)
  assert.equal(json.node.name, 'R')
  assert.equal(json.totals.units, 1)
  assert.deepEqual(json.units[0].tree.children.map((c) => c.name), ['S'])

  const md = await text(`/api/nodes/${r.id}/design-outline?format=md`)
  assert.match(md, /mindmap/)
  assert.match(md, /## 结构思维导图/)
})

test('HTTP design-outline/apply：写入「概要设计」并让 readiness 通过', async (t) => {
  const { tmp, store, get, post, cleanup } = await httpSetup()
  t.after(cleanup)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '需求内容', '正文')
  store.upsertTestCase(r.id, { name: '回归', prompt: '跑单测' })

  assert.equal((await get(`/api/nodes/${r.id}/readiness`)).items.find((i) => i.key === 'design_doc').passed, false)

  const out = await post(`/api/nodes/${r.id}/design-outline/apply`, {})
  assert.equal(out.written, 1)
  assert.equal(out.designDoc, '概要设计')

  const readiness = await get(`/api/nodes/${r.id}/readiness`)
  assert.equal(readiness.items.find((i) => i.key === 'design_doc').passed, true)
  assert.equal(readiness.ready, true)
})

// D1 回归（数据安全）：HTTP apply 必须透传 body.dryRun —— 否则 {"overwrite":true,"dryRun":true}
// 会真覆盖并销毁已有设计正文，而调用方以为只是在预览。
test('D1 回归：HTTP apply 透传 dryRun，不落库不动 revision', async (t) => {
  const { tmp, store, post, cleanup } = await httpSetup()
  t.after(cleanup)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const before = store.getRevision()

  const out = await post(`/api/nodes/${r.id}/design-outline/apply`, { dryRun: true })
  assert.equal(out.dryRun, true, 'HTTP 必须把 body.dryRun 透传给 applyDesignOutline')
  assert.equal(out.written, 0)
  assert.equal(store.getRevision(), before, 'dryRun 不得 bump revision')
  // requirement 节点自 xpx-120 起预置空白「概要设计」；dryRun 的关键是不得写入正文
  const preset = store.listDocuments(r.id).find((d) => d.name === '概要设计')
  assert.ok(preset, '预置「概要设计」文档存在')
  assert.equal(String(preset.content || '').trim(), '', 'dryRun 不得写入正文')
})

test('D1 回归：HTTP apply 的 overwrite+dryRun 组合只预演，绝不覆盖已有正文', async (t) => {
  const { tmp, store, post, cleanup } = await httpSetup()
  t.after(cleanup)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '概要设计', '人工写好的设计正文')
  const before = store.getRevision()

  const out = await post(`/api/nodes/${r.id}/design-outline/apply`, { overwrite: true, dryRun: true })
  assert.equal(out.dryRun, true)
  assert.equal(out.overwrite, true)
  assert.equal(out.written, 0)
  assert.equal(
    store.listDocuments(r.id).find((d) => d.name === '概要设计').content,
    '人工写好的设计正文',
    '预演绝不能销毁人工正文'
  )
  assert.equal(store.getRevision(), before)
})

test('HTTP design-outline：非法 scope / format 一律 400 VALIDATION_FAILED，不静默降级', async (t) => {
  const { tmp, store, base, cleanup } = await httpSetup()
  t.after(cleanup)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })

  for (const q of ['scope=Subtree', 'scope=subtre', 'scope=', 'format=xml', 'format=']) {
    const res = await fetch(`${base}/api/nodes/${r.id}/design-outline?${q}`)
    assert.equal(res.status, 400, `?${q} 应 400`)
    const body = await res.json()
    assert.equal(body.error.code, 'VALIDATION_FAILED')
  }
})

test('HTTP design-outline/apply：scope 非法 400；项目 self 提示 subtree', async (t) => {
  const { tmp, store, base, cleanup } = await httpSetup()
  t.after(cleanup)
  const p = store.createNode({ type: 'project', name: 'P' })
  store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })

  const badScope = await fetch(`${base}/api/nodes/${p.id}/design-outline/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'Subtree' })
  })
  assert.equal(badScope.status, 400)

  const selfOnProject = await fetch(`${base}/api/nodes/${p.id}/design-outline`)
  assert.equal(selfOnProject.status, 400)
  const body = await selfOnProject.json()
  assert.equal(body.error.code, 'VALIDATION_FAILED')
  assert.match(body.error.message, /subtree/)
})

// ---------- MCP ----------

test('MCP design_outline / design_outline_apply 与 store 结果逐字段一致', async (t) => {
  const { tmp, store, call, close } = await mcpSetup()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })

  const outline = await call('design_outline', { node: r.id })
  assert.equal(outline.isError, undefined)
  assert.deepEqual(JSON.parse(outline.content[0].text), store.buildDesignOutline(r.id))

  const md = await call('design_outline', { node: r.id, format: 'md' })
  assert.match(md.content[0].text, /mindmap/)

  const applied = await call('design_outline_apply', { node: r.id })
  const parsed = JSON.parse(applied.content[0].text)
  assert.equal(parsed.written, 1)
  assert.ok(store.listDocuments(r.id).find((d) => d.name === '概要设计'))
})

// D2 回归：MCP 必须接受 dryRun 并透传 —— 此前 schema 缺该字段，传了会被静默吞掉且真落库。
test('D2 回归：MCP design_outline_apply 接受并透传 dryRun，不落库不动 revision', async (t) => {
  const { tmp, store, call, close } = await mcpSetup()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const before = store.getRevision()

  const out = await call('design_outline_apply', { node: r.id, dryRun: true })
  assert.equal(out.isError, undefined, 'dryRun 应被 schema 接受，不得报协议错')
  const parsed = JSON.parse(out.content[0].text)
  assert.equal(parsed.dryRun, true, 'MCP 必须把 dryRun 透传给 applyDesignOutline')
  assert.equal(parsed.written, 0)
  assert.equal(store.getRevision(), before, 'dryRun 不得 bump revision')
  // requirement 节点自 xpx-120 起预置空白「概要设计」；dryRun 的关键是不得写入正文
  const preset = store.listDocuments(r.id).find((d) => d.name === '概要设计')
  assert.ok(preset, '预置「概要设计」文档存在')
  assert.equal(String(preset.content || '').trim(), '', 'dryRun 不得写入正文')
})

test('D2 回归：MCP design_outline_apply 的 overwrite+dryRun 组合只预演，不覆盖人工正文', async (t) => {
  const { tmp, store, call, close } = await mcpSetup()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  store.upsertDocument(r.id, '概要设计', '人工写好的设计正文')
  const before = store.getRevision()

  const out = await call('design_outline_apply', { node: r.id, overwrite: true, dryRun: true })
  const parsed = JSON.parse(out.content[0].text)
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.written, 0)
  assert.equal(store.listDocuments(r.id).find((d) => d.name === '概要设计').content, '人工写好的设计正文')
  assert.equal(store.getRevision(), before)
})

// D3 回归：MCP 经 'mcp' actor 写入的文档，审计字段必须是 'mcp'（此前 ACTORS 不含 'mcp'，被降级成 'user'）。
// 集成口径（xpx-120）：requirement 节点会预置空白「概要设计」，文档行由建节点时创建（createdBy=user），
// 因此 AI 的审计归属落在**内容写入**上——文档行 updatedBy 与版本历史的 update 快照都必须是 'mcp'。
test("D3 回归：MCP design_outline_apply 的内容写入审计 actor 记为 'mcp'，不降级成 'user'", async (t) => {
  const { tmp, store, call, close } = await mcpSetup()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })

  const out = await call('design_outline_apply', { node: r.id })
  assert.equal(JSON.parse(out.content[0].text).written, 1)
  const doc = store.listDocuments(r.id).find((d) => d.name === '概要设计')
  assert.equal(doc.updatedBy, 'mcp')
  // 内容变更本身必须留一条 actor=mcp 的版本快照，这是审计的强不变量
  const versions = store.listDocumentVersions(doc.id)
  assert.equal(versions[0].reason, 'update')
  assert.equal(versions[0].createdBy, 'mcp')
})

test('MCP design_outline：非法 scope 返回 isError + VALIDATION_FAILED（不泄漏 SDK -32602）', async (t) => {
  const { tmp, store, call, close } = await mcpSetup()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })

  const out = await call('design_outline', { node: r.id, scope: 'Subtree' })
  assert.equal(out.isError, true)
  assert.match(out.content[0].text, /VALIDATION_FAILED/)
})

// ---------- CLI ----------

test('CLI design outline / design apply：三入口 1:1，落库与门禁一致', async (t) => {
  const tmp = await tempHome()
  const home = tmp.dir
  try {
    await cli(home, ['node', 'upsert', '--path', 'P/R/S'])

    const outline = await cli(home, ['design', 'outline', 'P/R'])
    assert.equal(outline.node.name, 'R')
    assert.equal(outline.totals.units, 1)

    const applied = await cli(home, ['design', 'apply', 'P/R'])
    assert.equal(applied.written, 1)

    const readiness = await cli(home, ['readiness', 'check', 'P/R'])
    assert.equal(readiness.items.find((i) => i.key === 'design_doc').passed, true)
  } finally {
    tmp.cleanup()
  }
})

test('CLI design apply --dry-run 不落库', async (t) => {
  const tmp = await tempHome()
  const home = tmp.dir
  try {
    await cli(home, ['node', 'upsert', '--path', 'P/R'])
    const out = await cli(home, ['design', 'apply', 'P/R', '--dry-run'])
    assert.equal(out.dryRun, true)
    assert.equal(out.written, 0)
    const docs = await cli(home, ['node', 'get', 'P/R'])
    assert.ok(!(docs.documents || []).some((d) => d.name === '概要设计' && String(d.content || '').trim() !== ''))
  } finally {
    tmp.cleanup()
  }
})

test('CLI design outline --format md 输出骨架；非法 scope 失败', async (t) => {
  const tmp = await tempHome()
  const home = tmp.dir
  try {
    await cli(home, ['node', 'upsert', '--path', 'P/R'])
    const { stdout } = await execFileP('node', [CLI, 'design', 'outline', 'P/R', '--format', 'md'], {
      env: { ...process.env, TASKBOARD_HOME: home },
      encoding: 'utf8'
    })
    assert.match(stdout, /mindmap/)

    const failed = await cliFail(home, ['design', 'outline', 'P/R', '--scope', 'Subtree'])
    assert.ok(failed, '非法 scope 应非零退出')
    assert.match(failed.stderr, /VALIDATION_FAILED/)
  } finally {
    tmp.cleanup()
  }
})
