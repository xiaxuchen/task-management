import test from 'node:test'
import assert from 'node:assert/strict'
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

async function cliRaw(home, args) {
  const { stdout } = await execFileP('node', [CLI, ...args], {
    env: { ...process.env, TASKBOARD_HOME: home },
    encoding: 'utf8'
  })
  return stdout
}

async function cliFail(home, args) {
  try {
    await execFileP('node', [CLI, ...args], { env: { ...process.env, TASKBOARD_HOME: home }, encoding: 'utf8' })
    return null
  } catch (e) {
    return { code: e.code, out: String(e.stderr || '') + String(e.stdout || '') }
  }
}

async function mcpClient(store) {
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = createMcpServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'taskboard-mindmap-test', version: '1.0.0' })
  await client.connect(clientTransport)
  return {
    call: (name, args) => client.callTool({ name, arguments: args }),
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

async function setup() {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R "q"' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  return { tmp, store, p, r, s }
}

test('HTTP mindmap：JSON / md 两态，与 store.buildMindmap 逐字段一致', async (t) => {
  const { tmp, store, r } = await setup()
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((res) => server.close(res))
    tmp.cleanup()
  })

  const json = await (await fetch(`${base}/api/nodes/${r.id}/mindmap?scope=subtree`)).json()
  assert.deepEqual(json, store.buildMindmap(r.id, { scope: 'subtree' }))
  assert.equal(json.totals.nodes, 2)

  const mdRes = await fetch(`${base}/api/nodes/${r.id}/mindmap?scope=subtree&format=md`)
  assert.match(mdRes.headers.get('content-type'), /text\/markdown/)
  const md = await mdRes.text()
  assert.match(md, /```mermaid\nmindmap\n/)
})

test('HTTP mindmap：非法 scope / maxDepth 返回 400 VALIDATION_FAILED', async (t) => {
  const { tmp, store, r } = await setup()
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((res) => server.close(res))
    tmp.cleanup()
  })

  const badScope = await fetch(`${base}/api/nodes/${r.id}/mindmap?scope=Subtree`)
  assert.equal(badScope.status, 400)
  assert.equal((await badScope.json()).error.code, 'VALIDATION_FAILED')

  const badDepth = await fetch(`${base}/api/nodes/${r.id}/mindmap?maxDepth=`)
  assert.equal(badDepth.status, 400)
  assert.equal((await badDepth.json()).error.code, 'VALIDATION_FAILED')

  const badFormat = await fetch(`${base}/api/nodes/${r.id}/mindmap?format=xml`)
  assert.equal(badFormat.status, 400)
  assert.equal((await badFormat.json()).error.code, 'VALIDATION_FAILED')
})

test('CLI mindmap：单层命令可用（原断点：帮助已列却“未知命令”）', async (t) => {
  const { tmp, store, r } = await setup()
  const home = tmp.dir
  t.after(() => tmp.cleanup())

  // 原断点回归：`mindmap <ref>` 曾因 ref 落进 action 位而永远匹配不到 case，报“未知命令”
  const out = await cli(home, ['mindmap', String(r.id), '--scope', 'subtree'])
  assert.deepEqual(out, store.buildMindmap(r.id, { scope: 'subtree' }))
  assert.equal(out.totals.nodes, 2)

  const md = await cliRaw(home, ['mindmap', String(r.id), '--scope', 'subtree', '--format', 'md'])
  assert.match(md, /# 思维导图：/)
  assert.match(md, /```mermaid\nmindmap\n/)
})

test('CLI mindmap：路径引用 + --max-depth 生效，非法 maxDepth 报 VALIDATION_FAILED', async (t) => {
  const { tmp, store, r } = await setup()
  const home = tmp.dir
  t.after(() => tmp.cleanup())

  // 用路径引用与 id 引用结果一致（路径取自 store，避免与节点名里的引号/转义耦合）
  const byPath = await cli(home, ['mindmap', store.getNode(r.id).path, '--scope', 'subtree'])
  assert.deepEqual(byPath, store.buildMindmap(r.id, { scope: 'subtree' }))

  const d0 = await cli(home, ['mindmap', String(r.id), '--scope', 'subtree', '--max-depth', '0'])
  assert.equal(d0.totals.nodes, 1)
  assert.equal(d0.totals.truncated, 1)

  const bad = await cliFail(home, ['mindmap', String(r.id), '--max-depth', '99'])
  assert.ok(bad, '越界 maxDepth 应当失败')
  assert.match(bad.out, /VALIDATION_FAILED/)
})

test('MCP mindmap：JSON / md 与 store / renderMindmapMd 一致', async (t) => {
  const { tmp, store, r } = await setup()
  const { call, close } = await mcpClient(store)
  t.after(async () => {
    await close()
    tmp.cleanup()
  })

  const jsonOut = await call('mindmap', { node: r.id, scope: 'subtree' })
  assert.equal(jsonOut.isError, undefined)
  assert.deepEqual(JSON.parse(jsonOut.content[0].text), store.buildMindmap(r.id, { scope: 'subtree' }))

  const { renderMindmapMd } = await import('../server/ops.mjs')
  const mdOut = await call('mindmap', { node: r.id, scope: 'subtree', format: 'md' })
  assert.equal(mdOut.content[0].text, renderMindmapMd(store.buildMindmap(r.id, { scope: 'subtree' })))
})

test('MCP mindmap：非法 scope / maxDepth 以 isError + VALIDATION_FAILED 返回（不泄漏 SDK -32602）', async (t) => {
  const { tmp, store, r } = await setup()
  const { call, close } = await mcpClient(store)
  t.after(async () => {
    await close()
    tmp.cleanup()
  })

  const badScope = await call('mindmap', { node: r.id, scope: 'Subtree' })
  assert.equal(badScope.isError, true)
  assert.match(badScope.content[0].text, /VALIDATION_FAILED/)

  const badDepth = await call('mindmap', { node: r.id, maxDepth: 99 })
  assert.equal(badDepth.isError, true)
  assert.match(badDepth.content[0].text, /VALIDATION_FAILED/)
})

test('三入口 1:1：同一节点同一 scope 的 mermaid 文本完全一致', async (t) => {
  const { tmp, store, r } = await setup()
  const home = tmp.dir
  const { call, close } = await mcpClient(store)
  const { createApp } = await import('../server/http.mjs')
  const app = createApp({ store })
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await close()
    await new Promise((res) => server.close(res))
    tmp.cleanup()
  })

  const viaCli = await cli(home, ['mindmap', String(r.id), '--scope', 'subtree'])
  const viaHttp = await (await fetch(`${base}/api/nodes/${r.id}/mindmap?scope=subtree`)).json()
  const viaMcp = JSON.parse((await call('mindmap', { node: r.id, scope: 'subtree' })).content[0].text)
  const direct = store.buildMindmap(r.id, { scope: 'subtree' })

  assert.equal(viaCli.mermaid, direct.mermaid)
  assert.equal(viaHttp.mermaid, direct.mermaid)
  assert.equal(viaMcp.mermaid, direct.mermaid)
})
