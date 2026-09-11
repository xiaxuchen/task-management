import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { openDb } from './db.mjs'
import { createStore } from './store.mjs'
import { createApp } from './http.mjs'
import { loadConfig, DB_PATH } from './config.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, '..', 'web', 'dist')

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1')
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

/** 启动本地服务：默认端口取 config.port（3210），被占用则依次 +1，最多试 10 个 */
export async function startServer({ port, open = true, host = '127.0.0.1' } = {}) {
  const cfg = loadConfig()
  const db = openDb()
  const store = createStore(db, { docPresets: cfg.docPresets })
  const app = createApp({ store })
  // 前端构建产物静态托管
  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST))
    // SPA 回退：非 API 请求返回 index.html（Express 5 不支持 * 通配符，用中间件兜底）
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(DIST, 'index.html'))
    })
  }

  const basePort = Number(port || cfg.port)
  let server = null
  let usedPort = null
  let lastErr = null
  for (let p = basePort; p <= basePort + 10; p += 1) {
    try {
      server = await listen(app, p)
      usedPort = p
      break
    } catch (e) {
      lastErr = e
      if (e.code !== 'EADDRINUSE') throw e
    }
  }
  if (!server) throw new Error(`端口 ${basePort}~${basePort + 10} 都被占用：${lastErr?.message}`)

  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${usedPort}`
  console.log(`task-board 已启动：${url}`)
  console.log(`数据文件：${DB_PATH}`)
  if (open) execFile('open', [url], () => {})
  return { url, port: usedPort, server, store, db, app }
}

const isDirect = process.argv[1] && process.argv[1].endsWith('server/index.mjs')
if (isDirect) {
  startServer({ open: process.env.TASKBOARD_NO_OPEN !== '1' }).catch((e) => {
    console.error(`${e.code || 'ERROR'}: ${e.message}`)
    process.exit(1)
  })
}
