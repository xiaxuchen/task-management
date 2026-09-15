import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'

/**
 * 前端构建产物托管 + SPA 回退。
 *
 * 从 index.mjs 抽出来是为了可测：SPA 回退长期没有自动化保护，
 * 而它有一个只在特定部署布局下才暴露的坑（见下），必须在 UT 里锁定。
 *
 * 已知坑：`res.sendFile(绝对路径)` 默认拒绝**路径中任一含点号的目录段**
 * （`send` 的 `dotfiles` 语义）。开发/CI 常把仓库放在 `.worktrees/xxx` 这类目录下，
 * 此时 SPA 回退会直接 404（`NotFoundError`），表现为「深链打不开」，
 * 且会让「不存在的 /uploads 是否被 SPA 吞掉」这类验收在失效环境里得出错误结论。
 * 因此这里用 `{ root: dist }` 的**根相对**形式，不把绝对路径整串交给 send 解析。
 */
export function mountSpa(app, { dist }) {
  if (!fs.existsSync(dist)) return false
  app.use(
    express.static(dist, {
      setHeaders: (res, filePath) => {
        // index.html 必须每次回源校验，否则前端重新构建后浏览器仍用缓存的旧版本；
        // 带 content-hash 的 assets 不受影响
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      }
    })
  )
  // SPA 回退：非 API 请求返回 index.html（Express 5 不支持 * 通配符，用中间件兜底）
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.setHeader('Cache-Control', 'no-cache')
    // 根相对写法：dist 的绝对路径可以含点号目录段，不受 send 的 dotfiles 限制
    res.sendFile('index.html', { root: dist }, (err) => {
      if (!err) return
      // 这里必须自行收尾，不能 next(err)：mountSpa 由 index.mjs 在 createApp **之后**挂载，
      // 而 createApp 的错误处理器注册在前，Express 只会向后找错误处理器 —— next(err) 会跳过它，
      // 落到 Express 默认处理器，返回没有稳定错误码的空 body。
      const status = typeof err.status === 'number' && err.status < 500 ? err.status : 500
      if (status >= 500) console.error('[task-board] SPA 回退失败：', err)
      res.status(status).json({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
          message: status === 404 ? 'index.html 不存在（前端尚未构建？先跑 npm run build）' : 'SPA 回退失败'
        }
      })
    })
  })
  return true
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_DIST = path.join(HERE, '..', 'web', 'dist')
