/**
 * dsh-charge → task-board 需求同步导入
 *
 * 用法：
 *   node server/import-dsh.mjs                     # 导入全部
 *   node server/import-dsh.mjs --dry-run           # 预演（不写库）
 *   node server/import-dsh.mjs --dsh-db <path>     # 指定 dsh-charge 库路径
 *
 * 映射：
 *   dsh-charge requirement  → task-board requirement
 *   dsh-charge subreq       → task-board subreq
 *   dsh-charge subtask      → task-board task
 *   dsh-charge sql_items    → task-board document（挂 requirement 上）
 *   全部挂在 "dsh-charge 历史需求" project 下
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const DSH_DEFAULT = path.join(os.homedir(), '.dsh', 'charge', 'requirements.db')

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = { dryRun: false, dshDb: DSH_DEFAULT }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') flags.dryRun = true
    else if (args[i] === '--dsh-db' && args[i + 1]) flags.dshDb = args[++i]
  }
  return flags
}

function openDshDb(p) {
  if (!fs.existsSync(p)) throw new Error('dsh-charge 数据库不存在: ' + p)
  const db = new DatabaseSync(p)
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

function openTaskboardDb() {
  const home = process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard')
  const dbPath = path.join(home, 'data.db')
  if (!fs.existsSync(dbPath)) throw new Error('task-board 数据库不存在: ' + dbPath + '，请先启动一次 task-board')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function ensurePath(tb, pathParts, types) {
  let parentId = null
  let lastNode = null
  for (let i = 0; i < pathParts.length; i++) {
    const name = pathParts[i]
    const type = types[i] || 'group'
    const existing = parentId == null
      ? tb.prepare('SELECT id FROM nodes WHERE parent_id IS NULL AND name = ?').get(name)
      : tb.prepare('SELECT id FROM nodes WHERE parent_id = ? AND name = ?').get(parentId, name)
    if (existing) {
      lastNode = existing
      parentId = existing.id
    } else {
      const now = new Date().toISOString()
      const sort = parentId == null
        ? tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM nodes WHERE parent_id IS NULL').get().s
        : tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM nodes WHERE parent_id = ?').get(parentId).s
      const r = tb.prepare(
        'INSERT INTO nodes (type,parent_id,name,status,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(type, parentId, name, 'done', sort, now, now, 'import', 'import')
      const id = Number(r.lastInsertRowid)
      const presets = { project: ['描述'], requirement: ['需求内容'], subreq: ['需求内容'], group: [], task: [], defect: ['描述', '复现步骤'] }
      for (const docName of presets[type] || []) {
        tb.prepare('INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,-10,?,?,?,?)')
          .run(id, docName, '', now, now, 'import', 'import')
      }
      lastNode = { id }
      parentId = id
    }
  }
  return { id: parentId, node: lastNode }
}

function setAttr(tb, nodeId, attrDefId, value) {
  if (value == null || value === '') return
  const now = new Date().toISOString()
  const existing = tb.prepare('SELECT id FROM attr_values WHERE node_id = ? AND attr_def_id = ?').get(nodeId, attrDefId)
  if (existing) {
    tb.prepare('UPDATE attr_values SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(String(value), now, 'import', existing.id)
  } else {
    tb.prepare('INSERT INTO attr_values (node_id,attr_def_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)').run(nodeId, attrDefId, String(value), now, 'import')
  }
}

function upsertDoc(tb, nodeId, name, content) {
  const now = new Date().toISOString()
  const existing = tb.prepare('SELECT id, content FROM documents WHERE node_id = ? AND name = ?').get(nodeId, name)
  if (existing) {
    if (content && content !== existing.content) {
      tb.prepare('UPDATE documents SET content = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(content, now, 'import', existing.id)
    }
    return existing.id
  }
  const sort = tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM documents WHERE node_id = ?').get(nodeId).s
  const r = tb.prepare(
    'INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)'
  ).run(nodeId, name, content || '', sort, now, now, 'import', 'import')
  return Number(r.lastInsertRowid)
}

function getOrCreateAttrDef(tb, nodeType, key, label, dataType) {
  const existing = tb.prepare('SELECT id FROM attr_defs WHERE node_type = ? AND key = ?').get(nodeType, key)
  if (existing) return existing.id
  const now = new Date().toISOString()
  const r = tb.prepare(
    'INSERT INTO attr_defs (node_type,key,label,data_type,sort,enabled,created_at,updated_at) VALUES (?,?,?,?,0,1,?,?)'
  ).run(nodeType, key, label, dataType, now, now)
  return Number(r.lastInsertRowid)
}

export async function importDshCharge({ dshDbPath = DSH_DEFAULT, dryRun = false } = {}) {
  const dsh = openDshDb(dshDbPath)
  const tb = dryRun ? null : openTaskboardDb()

  console.log('dsh-charge 数据库: ' + dshDbPath)
  if (dryRun) console.log('[预演模式] 不写入 task-board 数据库\n')

  const stats = { requirements: 0, subreqs: 0, subtasks: 0, docs: 0 }

  if (dryRun) {
    const reqs = dsh.prepare('SELECT id, req_no, title FROM requirements ORDER BY req_no, created_at').all()
    stats.requirements = reqs.length
    for (const req of reqs) {
      const sr = dsh.prepare('SELECT COUNT(*) c FROM subreqs WHERE requirement_id = ?').get(req.id)
      const t = dsh.prepare('SELECT COUNT(*) c FROM subtasks s JOIN subreqs sr ON sr.id = s.subreq_id WHERE sr.requirement_id = ?').get(req.id)
      const sql = dsh.prepare('SELECT COUNT(*) c FROM sql_items WHERE requirement_id = ?').get(req.id)
      stats.subreqs += sr.c; stats.subtasks += t.c; stats.docs += sql.c
      console.log('  [预演] ' + (req.req_no || '无编号') + ' — ' + req.title + '（' + sr.c + ' 子需求, ' + t.c + ' 子任务, ' + sql.c + ' SQL）')
    }
  } else {
    const defReqNo = getOrCreateAttrDef(tb, 'requirement', 'req_no', '需求编号', 'text')
    const defBranch = getOrCreateAttrDef(tb, 'requirement', 'branch', '分支', 'text')
    const defSrBranch = getOrCreateAttrDef(tb, 'subreq', 'branch', '分支', 'text')
    const defSlug = getOrCreateAttrDef(tb, 'subreq', 'slug', '英文短名', 'text')

    const projPath = ensurePath(tb, ['dsh-charge 历史需求'], ['project'])
    console.log('项目节点: dsh-charge 历史需求 (id=' + projPath.id + ')')

    const reqs = dsh.prepare('SELECT * FROM requirements ORDER BY req_no, created_at').all()
    for (const req of reqs) {
      const reqPath = ensurePath(tb, ['dsh-charge 历史需求', req.title], ['project', 'requirement'])
      const reqId = reqPath.id
      stats.requirements++

      if (req.req_no) setAttr(tb, reqId, defReqNo, req.req_no)
      if (req.branch) setAttr(tb, reqId, defBranch, req.branch)
      if (req.note) { upsertDoc(tb, reqId, '需求说明', req.note); stats.docs++ }

      const subreqs = dsh.prepare('SELECT * FROM subreqs WHERE requirement_id = ? ORDER BY slug').all(req.id)
      for (const sr of subreqs) {
        const srName = sr.name || sr.title || sr.slug
        if (!srName) continue
        const srPath = ensurePath(tb, ['dsh-charge 历史需求', req.title, srName], ['project', 'requirement', 'subreq'])
        const srId = srPath.id
        stats.subreqs++
        if (sr.slug) setAttr(tb, srId, defSlug, sr.slug)
        if (sr.branch) setAttr(tb, srId, defSrBranch, sr.branch)
        if (sr.task_desc) { upsertDoc(tb, srId, '需求描述', sr.task_desc); stats.docs++ }
        if (sr.verify_note) { upsertDoc(tb, srId, '验证说明', sr.verify_note); stats.docs++ }

        const tasks = dsh.prepare('SELECT * FROM subtasks WHERE subreq_id = ? ORDER BY name').all(sr.id)
        for (const t of tasks) {
          if (!t.name) continue
          ensurePath(tb, ['dsh-charge 历史需求', req.title, srName, t.name], ['project', 'requirement', 'subreq', 'task'])
          stats.subtasks++
          if (t.task_desc) { upsertDoc(tb, srId, '任务描述', t.task_desc); stats.docs++ }
          if (t.verify_note) { upsertDoc(tb, srId, '验证说明', t.verify_note); stats.docs++ }
        }
      }

      const sqlItems = dsh.prepare('SELECT * FROM sql_items WHERE requirement_id = ? ORDER BY feature, created_at').all(req.id)
      for (const si of sqlItems) {
        const docName = 'SQL: ' + (si.feature || '未分类')
        let c = '## SQL 脚本\n\n**数据库**: ' + (si.db_name || '未知') + '\n**审批状态**: ' + si.approval_status + '\n'
        if (si.sql_text) c += '\n```sql\n' + si.sql_text + '\n```'
        upsertDoc(tb, reqId, docName, c)
        stats.docs++
      }
    }
  }

  dsh.close()
  if (tb) tb.close()

  console.log('\n导入完成' + (dryRun ? '（预演）' : '') + ':')
  console.log('  需求: ' + stats.requirements)
  console.log('  子需求: ' + stats.subreqs)
  console.log('  子任务: ' + stats.subtasks)
  console.log('  文档: ' + stats.docs)
  return stats
}

const isDirect = process.argv[1] && process.argv[1].endsWith('import-dsh.mjs')
if (isDirect) {
  const flags = parseArgs()
  importDshCharge({ dshDbPath: flags.dshDb, dryRun: flags.dryRun }).catch((e) => {
    console.error('导入失败: ' + e.message)
    process.exit(1)
  })
}