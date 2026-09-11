/**
 * 把 Vditor 的运行时资源拷到 web/public/vditor/dist，
 * 让 Vditor 以 cdn='/vditor' 从本机静态目录加载 lute / highlight.js / mermaid / KaTeX，
 * 不依赖外网 CDN（设计文档 §5：Vditor 资源自托管）。
 *
 * Vditor 的路径拼接规则是 `${cdn}/dist/js/...`，故必须落在 dist/ 子目录下。
 * 由 npm script 的 postinstall / prebuild / predev 自动调用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', 'vditor', 'dist')
const dest = path.join(root, 'web', 'public', 'vditor', 'dist')

if (!fs.existsSync(src)) {
  console.error('[copy-vditor] 未找到 node_modules/vditor/dist，请先 npm install')
  process.exit(1)
}

// 幂等：先清后拷，避免 Vditor 升级后残留旧版本资源
fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.cpSync(src, dest, { recursive: true })

const size = (dir) => {
  let total = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? size(p) : fs.statSync(p).size
  }
  return total
}
console.log(`[copy-vditor] 已同步 Vditor 资源 → ${path.relative(root, dest)}（${(size(dest) / 1024 / 1024).toFixed(1)} MB）`)