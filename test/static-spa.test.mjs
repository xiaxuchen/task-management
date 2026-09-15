import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 静态托管 / SPA 回退的优先级保护（D1 + D4）。
 *
 * 这批用例必须跑在**含点号目录段**的部署布局下：`res.sendFile(绝对路径)` 默认拒绝点号段，
 * 而开发/CI 的 `.worktrees/…` 正是这种布局。原交付的「/uploads 不存在返回 404」结论
 * 就是在 SPA 回退整体失效的环境里得出的（D4），所以这里把目录做成 `<tmp>/.dotseg/web/dist`
 * 来复现生产形态，锁死三条契约。
 */

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-static-home-'))
process.env.TASKBOARD_HOME = HOME

/** 构造一个「路径含点号段」的 dist，内容带可识别标记 */
function makeDotDist() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-dotdist-'))
  const dist = path.join(base, '.dotseg', 'web', 'dist')
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><div id="app">SPA-INDEX</div></html>')
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("asset")')
  return { base, dist }
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body')
])
const b64 = (buf) => buf.toString('base64')

async function setup() {
  const { openDb } = await import('../server/db.mjs')
  const { createStore } = await import('../server/store.mjs')
  const { createApp } = await import('../server/http.mjs')
  const { mountSpa } = await import('../server/static.mjs')

  const { base, dist } = makeDotDist()
  const store = createStore(openDb())
  const app = createApp({ store })
  const mounted = mountSpa(app, { dist })
  assert.equal(mounted, true, 'dist 存在时 mountSpa 应返回 true')

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    dist,
    upload: async () => {
      const r = await fetch(`${origin}/api/uploads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'pic.png', data: b64(PNG) })
      })
      return r.json()
    },
    cleanup: async () => {
      await new Promise((r) => server.close(r))
      fs.rmSync(base, { recursive: true, force: true })
    }
  }
}

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }))

test('静态托管优先级：已存在图片命中 static，返回字节一致且不被 SPA 替换', async (t) => {
  const s = await setup()
  t.after(() => s.cleanup())
  const up = await s.upload()
  const res = await fetch(`${s.origin}${up.url}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /image\/png/)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
})

test('静态托管优先级：不存在的 /uploads/* 返回 404，不能落到 SPA 变成 200 HTML（D1 回归）', async (t) => {
  const s = await setup()
  t.after(() => s.cleanup())
  const res = await fetch(`${s.origin}/uploads/definitely-missing.png`)
  const body = await res.text()
  assert.equal(res.status, 404, '未命中的 /uploads 必须是 404，而不是被 SPA 回退吞成 200')
  assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/)
  assert.doesNotMatch(body, /SPA-INDEX/)
  const parsed = JSON.parse(body)
  assert.equal(parsed.error.code, 'NOT_FOUND')
  // 报错里的路径要是用户看到的完整地址，而不是挂载点下的相对路径
  assert.match(parsed.error.message, /\/uploads\/definitely-missing\.png/)
})

test('SPA 回退：含点号段的部署布局下，深链仍返回 index.html（D4 回归）', async (t) => {
  const s = await setup()
  t.after(() => s.cleanup())
  const res = await fetch(`${s.origin}/some/deep/route`)
  const body = await res.text()
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /text\/html/)
  assert.match(body, /SPA-INDEX/)
})

test('SPA 回退：静态资源命中真实文件，不是 index.html', async (t) => {
  const s = await setup()
  t.after(() => s.cleanup())
  const res = await fetch(`${s.origin}/assets/app.js`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /console\.log/)
})

test('三条契约互不串味：同一 app 上 存在图片 200 / 缺失图片 404 / 深链 200 同时成立', async (t) => {
  const s = await setup()
  t.after(() => s.cleanup())
  const up = await s.upload()
  const [hit, miss, deep] = await Promise.all([
    fetch(`${s.origin}${up.url}`),
    fetch(`${s.origin}/uploads/nope.png`),
    fetch(`${s.origin}/some/route`)
  ])
  assert.equal(hit.status, 200)
  assert.equal(miss.status, 404)
  assert.equal(deep.status, 200)
})

test('框架层错误归一：业务错误码不被改写，静态层 404 也不落到 500', async (t) => {
  const s = await setup()
  t.after(() => s.cleanup())

  // 业务错误（AppError）必须原样保留自己的 code，不能被 mapFrameworkError 改写
  const nodeMissing = await fetch(`${s.origin}/api/nodes/999999`)
  assert.equal(nodeMissing.status, 404)
  assert.equal((await nodeMissing.json()).error.code, 'NOT_FOUND')

  const unknownApi = await fetch(`${s.origin}/api/no-such-route`)
  assert.equal(unknownApi.status, 404)
  assert.equal((await unknownApi.json()).error.code, 'NOT_FOUND')

  // send/sendFile 的错误带的是文件系统 errno（code: 'ENOENT'），不是业务码；
  // 只判 `!err.code` 会漏掉它并落到 500 —— 这里锁死它保持 4xx + 稳定业务码。
  const miss = await fetch(`${s.origin}/uploads/also-missing.png`)
  assert.equal(miss.status, 404)
  assert.ok(miss.status < 500, 'send 层错误不能被报成 500 服务端故障')
  const missBody = await miss.json()
  assert.equal(missBody.error.code, 'NOT_FOUND')
  assert.doesNotMatch(JSON.stringify(missBody), /ENOENT/)
})

test('SPA 回退自收尾：dist 存在但缺 index.html 时返回稳定 404，而不是空 body / 裸 500', async (t) => {
  const { openDb } = await import('../server/db.mjs')
  const { createStore } = await import('../server/store.mjs')
  const { createApp } = await import('../server/http.mjs')
  const { mountSpa } = await import('../server/static.mjs')

  // dist 目录存在（能挂上）但没有 index.html：sendFile 会抛 ENOENT(404)
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-noidx-'))
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }))
  const store = createStore(openDb())
  const app = createApp({ store })
  mountSpa(app, { dist })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  t.after(() => new Promise((r) => server.close(r)))

  const res = await fetch(`http://127.0.0.1:${server.address().port}/deep/route`)
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.equal(body.error.code, 'NOT_FOUND')
  assert.match(body.error.message, /npm run build/)
})
