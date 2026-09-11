/**
 * 导出本地库为文本快照（便于入 git / 迁移 / 备份）
 *
 * 用法：
 *   node scripts/export-snapshot.mjs [输出路径]
 *   默认输出到 <repo>/data/snapshot.json
 *
 * 为什么导出文本而不是直接提交 data.db：
 *   - data.db 是二进制，git 无法 diff，每次改动都产生整份新副本
 *   - 旁边还有 data.db-wal / data.db-shm，直接拷 .db 会丢掉未 checkpoint 的数据
 *
 * 安全：**不导出 config.json**（内含 GitLab token，属本机凭据，永不入库）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard')
const dbPath = path.join(home, 'data.db')
const outPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data', 'snapshot.json')

if (!fs.existsSync(dbPath)) {
  console.error(`[export] 找不到数据库：${dbPath}（先跑一次 npm start 初始化）`)
  process.exit(1)
}

// 只读打开：读 WAL 中的数据，但不改动源库
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = OFF')

/** 导出顺序即导入顺序（外键依赖在前） */
const TABLE_ORDER = ['attr_defs', 'repos', 'nodes', 'attr_values', 'documents', 'commits', 'mrs', 'merges', 'unit_repos']

const tables = {}
for (const t of TABLE_ORDER) {
  tables[t] = db.prepare(`SELECT * FROM ${t}`).all()
}
const revision = Number(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get()?.value ?? 0)

const snapshot = {
  format: 'taskboard-snapshot',
  version: 1,
  exportedAt: new Date().toISOString(),
  source: { dbPath, size: fs.statSync(dbPath).size },
  revision,
  counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
  tables
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n')

const bytes = fs.statSync(outPath).size
console.log(`[export] 已导出 → ${path.relative(root, outPath)}（${(bytes / 1024).toFixed(1)} KB）`)
for (const [k, v] of Object.entries(snapshot.counts)) console.log(`  ${k.padEnd(12)} ${v}`)