/**
 * 从文本快照恢复到本地库（幂等）
 *
 * 用法：
 *   node scripts/import-snapshot.mjs [快照路径] [--replace]
 *   默认读 <repo>/data/snapshot.json，写入 $TASKBOARD_HOME 或 ~/.taskboard/data.db
 *
 * --replace：先清空目标库的业务表再导入（默认行为；不加该参数则先清空以避免主键冲突）
 *
 * 安全：**不恢复 config.json**（token 属本机凭据，需各自在设置页填写）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const snapArg = args.find((a) => !a.startsWith('--'))
const snapPath = snapArg ? path.resolve(snapArg) : path.join(root, 'data', 'snapshot.json')
const home = process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard')
const dbPath = path.join(home, 'data.db')

if (!fs.existsSync(snapPath)) {
  console.error(`[import] 找不到快照：${snapPath}`)
  process.exit(1)
}
if (!fs.existsSync(dbPath)) {
  console.error(`[import] 找不到目标库：${dbPath}（先跑一次 npm start 初始化）`)
  process.exit(1)
}

const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'))
if (snap.format !== 'taskboard-snapshot') {
  console.error(`[import] 快照格式不匹配：${snap.format}`)
  process.exit(1)
}

/** 清空顺序：外键依赖在后的先删（与导入顺序相反） */
const IMPORT_ORDER = [
  'attr_defs',
  'repos',
  'nodes',
  'attr_values',
  'documents',
  'document_versions',
  'test_cases',
  'test_reports',
  'acceptance_signoffs',
  'commits',
  'mrs',
  'merges',
  'unit_repos'
]
const DELETE_ORDER = [...IMPORT_ORDER].reverse()

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = OFF') // 导入期间自行保证顺序，避免逐条外键校验

const insert = (table, row) => {
  const cols = Object.keys(row)
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  return db.prepare(sql).run(...cols.map((c) => row[c]))
}

db.exec('BEGIN')
try {
  for (const t of DELETE_ORDER) db.prepare(`DELETE FROM ${t}`).run()

  // 主键重映射：旧 id → 新 id（父子/外键关系靠它重建，不依赖旧 id）
  const idMaps = { attr_defs: new Map(), repos: new Map(), nodes: new Map(), documents: new Map(), test_cases: new Map() }

  // 1) attr_defs（无外键依赖）
  for (const r of snap.tables.attr_defs || []) {
    const info = insert('attr_defs', r)
    idMaps.attr_defs.set(r.id, Number(info.lastInsertRowid))
  }

  // 2) repos
  for (const r of snap.tables.repos || []) {
    const info = insert('repos', r)
    idMaps.repos.set(r.id, Number(info.lastInsertRowid))
  }

  // 3) nodes：按 id 升序插入，保证父节点先于子节点；映射 parent_id
  const nodes = [...(snap.tables.nodes || [])].sort((a, b) => a.id - b.id)
  for (const r of nodes) {
    const row = { ...r, parent_id: r.parent_id == null ? null : idMaps.nodes.get(r.parent_id) ?? null }
    const info = insert('nodes', row)
    idMaps.nodes.set(r.id, Number(info.lastInsertRowid))
  }

  const mapNode = (v) => (v == null ? null : idMaps.nodes.get(v) ?? null)

  // 4) attr_values（依赖 nodes + attr_defs）
  for (const r of snap.tables.attr_values || []) {
    insert('attr_values', { ...r, node_id: mapNode(r.node_id), attr_def_id: idMaps.attr_defs.get(r.attr_def_id) ?? null })
  }

  // 5) documents（依赖 nodes；记录旧 id → 新 id 供历史快照重映射）
  for (const r of snap.tables.documents || []) {
    const info = insert('documents', { ...r, node_id: mapNode(r.node_id) })
    idMaps.documents.set(r.id, Number(info.lastInsertRowid))
  }

  // 6) document_versions（依赖 documents；孤儿行直接丢弃，绝不沿用旧 document_id）
  for (const r of snap.tables.document_versions || []) {
    const documentId = idMaps.documents.get(r.document_id)
    if (documentId == null) continue
    insert('document_versions', { ...r, document_id: documentId })
  }

  // 7) 回归测试闭环（依赖 nodes；test_reports.case_id 重映射，run_id 不重建）
  for (const r of snap.tables.test_cases || []) {
    const info = insert('test_cases', { ...r, node_id: mapNode(r.node_id) })
    idMaps.test_cases.set(r.id, Number(info.lastInsertRowid))
  }
  for (const r of snap.tables.test_reports || []) {
    insert('test_reports', {
      ...r,
      node_id: mapNode(r.node_id),
      case_id: r.case_id == null ? null : idMaps.test_cases.get(r.case_id) ?? null,
      run_id: null
    })
  }

  // 8) acceptance_signoffs（依赖 nodes；签收随节点重映射）
  for (const r of snap.tables.acceptance_signoffs || []) {
    insert('acceptance_signoffs', { ...r, node_id: mapNode(r.node_id) })
  }

  // 9) commits / mrs（依赖 nodes）
  for (const t of ['commits', 'mrs']) {
    for (const r of snap.tables[t] || []) insert(t, { ...r, node_id: mapNode(r.node_id) })
  }

  // 10) merges（依赖 nodes；repo 存的是仓库名，无需映射）
  for (const r of snap.tables.merges || []) insert('merges', { ...r, node_id: mapNode(r.node_id) })

  // 11) unit_repos（依赖 nodes + repos）
  for (const r of snap.tables.unit_repos || []) {
    insert('unit_repos', { ...r, node_id: mapNode(r.node_id), repo_id: idMaps.repos.get(r.repo_id) ?? null })
  }

  // 12) revision 对齐快照（前端轮询据此刷新）
  db.prepare("UPDATE meta SET value = ? WHERE key = 'revision'").run(String(snap.revision ?? 0))

  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c
console.log(`[import] 已从 ${path.relative(root, snapPath)} 恢复 → ${dbPath}`)
for (const t of IMPORT_ORDER) console.log(`  ${t.padEnd(12)} ${count(t)}`)
console.log(`  revision     ${db.prepare("SELECT value FROM meta WHERE key='revision'").get().value}`)
console.log(`  （快照导出于 ${snap.exportedAt}）`)
