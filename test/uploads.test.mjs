import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const CLI = path.resolve(import.meta.dirname, '../bin/taskboard.js')

/**
 * 独立临时目录。
 * 注意：server/config.mjs 的 UPLOAD_DIR 在模块首次 import 时就固定了 TASKBOARD_HOME，
 * 所以共享核心的单测直接显式传 dir，不靠环境变量切换（与既有 helpers.mjs 同一约束）。
 */
function tmpDir(prefix = 'taskboard-uploads-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

/** 最小合法 PNG / GIF / WEBP / JPEG 字节（魔数正确，够校验用） */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body')
])
const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from('body')])
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('body')
])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('body')])

const b64 = (buf) => buf.toString('base64')
const dataUrl = (mime, buf) => `data:${mime};base64,${b64(buf)}`

// ---------- 单测：共享核心（显式 dir，避免 TASKBOARD_HOME 模块级冻结） ----------

test('uploads：合法 png 落盘并返回 /uploads 地址、真实扩展名与大小', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  const out = saveUpload({ name: 'shot.png', data: b64(PNG), dir: tmp.dir })
  assert.match(out.url, /^\/uploads\/\d+-[0-9a-f]{12}\.png$/)
  assert.equal(out.name, out.url.replace('/uploads/', ''))
  assert.equal(out.size, PNG.length)
  assert.equal(out.mime, 'image/png')
  assert.deepEqual(fs.readFileSync(path.join(tmp.dir, out.name)), PNG)
})

test('uploads：jpeg 别名收敛为 jpg；data URL 与裸 base64 都接受', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  const a = saveUpload({ name: 'a.jpeg', data: dataUrl('image/jpeg', JPG), dir: tmp.dir })
  const b = saveUpload({ name: 'b.jpg', data: b64(JPG), dir: tmp.dir })
  assert.match(a.url, /\.jpg$/)
  assert.match(b.url, /\.jpg$/)
})

test('uploads：gif / webp 按魔数识别', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  assert.match(saveUpload({ name: 'x.gif', data: b64(GIF), dir: tmp.dir }).url, /\.gif$/)
  assert.match(saveUpload({ name: 'x.webp', data: b64(WEBP), dir: tmp.dir }).url, /\.webp$/)
})

test('uploads：不支持的扩展名 → UPLOAD_INVALID_TYPE，details 带允许值域', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  assert.throws(
    () => saveUpload({ name: 'evil.svg', data: b64(PNG), dir: tmp.dir }),
    (e) => e.code === 'UPLOAD_INVALID_TYPE' && e.details.allowed.includes('png')
  )
})

test('uploads：改名绕过被拦下——扩展名与真实内容不符 → UPLOAD_INVALID_TYPE', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  // 名字是 png，内容其实是 gif
  assert.throws(() => saveUpload({ name: 'fake.png', data: b64(GIF), dir: tmp.dir }), /UPLOAD_INVALID_TYPE/)
  // 名字是 png，内容根本不是图片
  assert.throws(
    () => saveUpload({ name: 'fake.png', data: b64(Buffer.from('not an image')), dir: tmp.dir }),
    /UPLOAD_INVALID_TYPE/
  )
  // data URL 声明的 mime 与内容不符
  assert.throws(
    () => saveUpload({ name: 'x.png', data: dataUrl('image/png', GIF), dir: tmp.dir }),
    /UPLOAD_INVALID_TYPE/
  )
})

test('uploads：超过 10 MB → UPLOAD_TOO_LARGE，且不落盘', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload, MAX_UPLOAD_BYTES } = await import('../server/uploads.mjs')
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES + 1)])
  assert.throws(
    () => saveUpload({ name: 'big.png', data: b64(big), dir: tmp.dir }),
    (e) => e.code === 'UPLOAD_TOO_LARGE' && e.details.actualBytes > e.details.maxBytes
  )
  assert.equal(fs.readdirSync(tmp.dir).length, 0)
})

test('uploads：缺失 / 空字段 → VALIDATION_FAILED；非法 base64 → VALIDATION_FAILED', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  assert.throws(() => saveUpload({ name: '', data: b64(PNG), dir: tmp.dir }), /VALIDATION_FAILED/)
  assert.throws(() => saveUpload({ name: 'a.png', data: '', dir: tmp.dir }), /VALIDATION_FAILED/)
  assert.throws(() => saveUpload({ name: 'a.png', data: '!!!not-base64!!!', dir: tmp.dir }), /VALIDATION_FAILED/)
})

test('uploads：同名两次上传不覆盖——落盘名带时间戳 + 随机串', async (t) => {
  const tmp = tmpDir()
  t.after(() => tmp.cleanup())
  const { saveUpload } = await import('../server/uploads.mjs')
  const a = saveUpload({ name: 'same.png', data: b64(PNG), dir: tmp.dir })
  const b = saveUpload({ name: 'same.png', data: b64(PNG), dir: tmp.dir })
  assert.notEqual(a.name, b.name)
  assert.equal(fs.readdirSync(tmp.dir).length, 2)
})

// ---------- 入口测试：共用同一个 TASKBOARD_HOME（模块级冻结） ----------

/** 入口测试的共享 HOME（config/UPLOAD_DIR 在首次 import 时固定，必须全程同一个） */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-uploads-home-'))
process.env.TASKBOARD_HOME = HOME

/**
 * 每个用例一套「应用实例」，但共用同一个 HOME。
 * HOME 必须共用：config/UPLOAD_DIR 在模块首次 import 时固定，换 HOME 不会生效。
 * 应用实例各自新建：避免用例之间互相关掉对方的 server / MCP 连接。
 */
async function makeCtx() {
  const { openDb } = await import('../server/db.mjs')
  const { createStore } = await import('../server/store.mjs')
  const { createApp } = await import('../server/http.mjs')
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

  const store = createStore(openDb())

  const app = createApp({ store })
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`

  const mcpServer = createMcpServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport)
  const client = new Client({ name: 'taskboard-upload-test', version: '1.0.0' })
  await client.connect(clientTransport)

  return {
    store,
    base,
    uploadsDir: path.join(HOME, 'uploads'),
    execCli: (args) =>
      execFileP('node', [CLI, ...args], { env: { ...process.env, TASKBOARD_HOME: HOME } }),
    mcpCall: (name, args) => client.callTool({ name, arguments: args }),
    mcpTools: () => client.listTools(),
    cleanup: async () => {
      await client.close()
      await mcpServer.close()
      await new Promise((r) => server.close(r))
    }
  }
}

/** 注册用例的收尾：关掉本用例的应用实例；HOME 由进程级 t.after 统一清理 */
function withCtx(t) {
  return makeCtx().then((ctx) => {
    t.after(() => ctx.cleanup())
    return ctx
  })
}

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }))

test('HTTP uploads：上传成功返回 201 + url，且 GET 该 url 能取回原始字节', async (t) => {
  const s = await withCtx(t)
  const up = await fetch(`${s.base}/api/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'pic.png', data: b64(PNG) })
  })
  assert.equal(up.status, 201)
  const body = await up.json()
  assert.match(body.url, /^\/uploads\//)
  const got = await fetch(`${s.base}${body.url}`)
  assert.equal(got.status, 200)
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG)
})

test('HTTP uploads：类型 / 大小不合规 → 400 且 error.code 稳定', async (t) => {
  const s = await withCtx(t)
  const post = (body) =>
    fetch(`${s.base}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(async (r) => ({ status: r.status, body: await r.json() }))

  const bad = await post({ name: 'x.svg', data: b64(PNG) })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'UPLOAD_INVALID_TYPE')

  const tooBig = await post({
    name: 'big.png',
    data: b64(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1)]))
  })
  assert.equal(tooBig.status, 400)
  assert.equal(tooBig.body.error.code, 'UPLOAD_TOO_LARGE')
})

test('CLI upload：按路径上传 → 返回 url，文件真的落盘', async (t) => {
  const s = await withCtx(t)
  const img = path.join(HOME, 'shot.png')
  fs.writeFileSync(img, PNG)
  const { stdout } = await s.execCli(['upload', img])
  const out = JSON.parse(stdout)
  assert.match(out.url, /^\/uploads\/\d+-[0-9a-f]{12}\.png$/)
  assert.ok(fs.existsSync(path.join(s.uploadsDir, out.name)))
})

test('CLI upload：--name + --data 用法，非法类型以非零码退出', async (t) => {
  const s = await withCtx(t)
  const { stdout } = await s.execCli(['upload', '--name', 'inline.png', '--data', b64(PNG)])
  assert.match(JSON.parse(stdout).url, /\.png$/)
  await assert.rejects(s.execCli(['upload', '--name', 'bad.svg', '--data', b64(PNG)]), /UPLOAD_INVALID_TYPE/)
})

test('MCP upload_image：注册在能力清单里，成功返回 url，非法类型是 isError 而非 SDK 报错', async (t) => {
  const s = await withCtx(t)
  const tools = (await s.mcpTools()).tools.map((x) => x.name)
  assert.ok(tools.includes('upload_image'))

  const ok = await s.mcpCall('upload_image', { name: 'p.png', data: b64(PNG) })
  assert.ok(!ok.isError)
  assert.match(JSON.parse(ok.content[0].text).url, /\.png$/)

  const bad = await s.mcpCall('upload_image', { name: 'p.svg', data: b64(PNG) })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /UPLOAD_INVALID_TYPE/)
})

test('四入口一致：同一图片经共享核心 / HTTP / CLI / MCP 都得到同一落盘语义', async (t) => {
  const s = await withCtx(t)
  const { saveUpload } = await import('../server/uploads.mjs')

  const viaCore = saveUpload({ name: 'a.png', data: b64(PNG) })

  const viaHttp = await fetch(`${s.base}/api/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'a.png', data: b64(PNG) })
  }).then((r) => r.json())

  const img = path.join(HOME, 'a.png')
  fs.writeFileSync(img, PNG)
  const viaCli = JSON.parse((await s.execCli(['upload', img])).stdout)

  const viaMcp = JSON.parse(
    (await s.mcpCall('upload_image', { name: 'a.png', data: b64(PNG) })).content[0].text
  )

  for (const out of [viaCore, viaHttp, viaCli, viaMcp]) {
    assert.match(out.url, /^\/uploads\/\d+-[0-9a-f]{12}\.png$/)
    assert.equal(out.mime, 'image/png')
    assert.equal(out.size, PNG.length)
  }
})
