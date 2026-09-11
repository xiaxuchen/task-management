/**
 * dsh-charge → task-board 需求同步导入（按 task-board 规格撰写，非字段搬运）
 *
 * 用法：
 *   node server/import-dsh.mjs                 # 幂等导入（复用已存在节点）
 *   node server/import-dsh.mjs --reset         # 先删除已有「dsh-charge 历史需求」树再重建
 *   node server/import-dsh.mjs --dry-run       # 预演，不写库
 *   node server/import-dsh.mjs --dsh-db <path> # 指定 dsh-charge 库路径
 *
 * 规格映射（对齐设计文档 §3/§4.6/§4.8/§4.9）：
 *   project      「dsh-charge 历史需求」（固定容器）
 *   requirement  ← requirements     name=title（清洗）  文档「需求内容」=note
 *   subreq       ← subreqs          name=name（清洗）   文档「需求内容」=task_desc、可选「验证说明」
 *   task         ← subtasks（仅非冗余项，见下）           文档「需求内容」=task_desc、可选「验证说明」
 *   SQL          ← sql_items        挂 requirement 的文档「SQL: {feature}」
 *
 * 冗余剔除：dsh-charge 建子需求时会自动生成一个与其同名、同内容的子任务当「功能登记单元」。
 *   判定：subreq 下仅 1 个 subtask 且（清洗后同名 或 task_desc 逐字相同）→ 该 subtask 不建 task，
 *   内容由 subreq 承载。有真实拆分（≥2 个）时全部建 task。
 *
 * 状态映射：planned→todo、reviewing/developing→doing、merged/done→done
 * 名称清洗：剥离「- 概要设计」「- 小优化」等流程性后缀（支持叠加），原始全名保留在文档中
 * 扩展属性（设计文档 §4.2 允许按需扩展）：requirement.req_no / feishu_url / branch、task.test_report_url
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const DSH_DEFAULT = path.join(os.homedir(), '.dsh', 'charge', 'requirements.db')
const ROOT_NAME = 'dsh-charge 历史需求'

/** 预置文档名，须与 server/config.mjs 的 docPresets 默认值保持一致 */
const DOC_PRESETS = {
  project: ['描述'],
  requirement: ['需求内容'],
  subreq: ['需求内容'],
  group: [],
  task: [],
  defect: ['描述', '复现步骤']
}

/** dsh-charge 状态 → task-board 状态值域（§4.8） */
const STATUS_MAP = {
  planned: 'todo',
  reviewing: 'doing',
  developing: 'doing',
  merged: 'done',
  done: 'done'
}

/** 流程性后缀（可叠加，按序反复剥离） */
const SUFFIX_RES = [
  /\s*[-–—]\s*(概要设计|详细设计|详设|细设)\s*$/u,
  /\s*[-–—]\s*(小优化|小改造|小调整)\s*$/u
]

function cleanName(raw) {
  let n = String(raw ?? '').trim()
  let prev
  do {
    prev = n
    for (const re of SUFFIX_RES) n = n.replace(re, '').trim()
  } while (n !== prev && n !== '')
  return n || String(raw ?? '').trim()
}

const mapStatus = (s) => STATUS_MAP[s] || 'todo'

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = { dryRun: false, reset: false, dshDb: DSH_DEFAULT }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') flags.dryRun = true
    else if (args[i] === '--reset') flags.reset = true
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

// ---------- 写库原语（直接 SQL，绕过 store 的 revision 递增副作用） ----------

function ensureNode(tb, parentId, name, type, status = 'todo') {
  const existing = parentId == null
    ? tb.prepare('SELECT id FROM nodes WHERE parent_id IS NULL AND name = ?').get(name)
    : tb.prepare('SELECT id FROM nodes WHERE parent_id = ? AND name = ?').get(parentId, name)
  if (existing) return { id: existing.id, created: false }

  const now = new Date().toISOString()
  const sort = parentId == null
    ? tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM nodes WHERE parent_id IS NULL').get().s
    : tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM nodes WHERE parent_id = ?').get(parentId).s
  const info = tb
    .prepare('INSERT INTO nodes (type,parent_id,name,status,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(type, parentId, name, status, sort, now, now, 'import', 'import')
  const id = Number(info.lastInsertRowid)
  // 按 docPresets 预置空文档（与 store.createNode 行为一致）
  for (const docName of DOC_PRESETS[type] || []) {
    tb.prepare('INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,-10,?,?,?,?)')
      .run(id, docName, '', now, now, 'import', 'import')
  }
  return { id, created: true }
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
  if (!content) return null
  const now = new Date().toISOString()
  const existing = tb.prepare('SELECT id, content FROM documents WHERE node_id = ? AND name = ?').get(nodeId, name)
  if (existing) {
    if (content !== existing.content) {
      tb.prepare('UPDATE documents SET content = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(content, now, 'import', existing.id)
    }
    return existing.id
  }
  const sort = tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM documents WHERE node_id = ?').get(nodeId).s
  const info = tb.prepare('INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(nodeId, name, content, sort, now, now, 'import', 'import')
  return Number(info.lastInsertRowid)
}

function getOrCreateAttrDef(tb, nodeType, key, label, dataType) {
  const existing = tb.prepare('SELECT id FROM attr_defs WHERE node_type = ? AND key = ?').get(nodeType, key)
  if (existing) return existing.id
  const now = new Date().toISOString()
  const sort = tb.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM attr_defs WHERE node_type = ?').get(nodeType).s
  const info = tb.prepare('INSERT INTO attr_defs (node_type,key,label,data_type,sort,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run(nodeType, key, label, dataType, sort, now, now)
  return Number(info.lastInsertRowid)
}

// ---------- 主流程 ----------

export async function importDshCharge({ dshDbPath = DSH_DEFAULT, dryRun = false, reset = false } = {}) {
  const dsh = openDshDb(dshDbPath)
  const tb = dryRun ? null : openTaskboardDb()

  const reqs = dsh.prepare('SELECT * FROM requirements ORDER BY req_no, created_at').all()
  const subreqsByReq = new Map()
  const tasksBySubreq = new Map()
  const sqlByReq = new Map()
  const reposBySubreq = new Map()

  for (const req of reqs) {
    subreqsByReq.set(req.id, dsh.prepare('SELECT * FROM subreqs WHERE requirement_id = ? ORDER BY slug, created_at').all(req.id))
    sqlByReq.set(req.id, dsh.prepare('SELECT * FROM sql_items WHERE requirement_id = ? ORDER BY feature, created_at').all(req.id))
  }
  for (const list of subreqsByReq.values()) {
    for (const sr of list) {
      tasksBySubreq.set(
        sr.id,
        dsh.prepare('SELECT * FROM subtasks WHERE subreq_id = ? ORDER BY name').all(sr.id)
      )
      const repoRows = dsh
        .prepare('SELECT r.name FROM subtask_repos sr JOIN repos r ON r.id = sr.repo_id WHERE sr.subtask_id = ? ORDER BY r.name')
        .all(sr.id)
      reposBySubreq.set(sr.id, repoRows.map((r) => r.name))
    }
  }

  /**
   * 冗余判定（逐项）：dsh-charge 建子需求时会自动生成一个「登记单元」子任务。
   * - 正文与 subreq 逐字相同（且非空）→ 冗余，内容由 subreq 承载
   * - 与 subreq 清洗后同名且双方均无正文 → 冗余空壳
   * - 同名但正文有增量 → 保留（内容不同，属真实拆分或后续编辑）
   */
  const isRedundantSubtask = (sr, t) => {
    const sameContent = !!(t.task_desc || '') && t.task_desc === sr.task_desc
    const sameName = cleanName(t.name) === cleanName(sr.name)
    const bothEmpty = !(t.task_desc || '') && !(sr.task_desc || '')
    return sameContent || (sameName && bothEmpty)
  }

  const stats = { requirements: 0, subreqs: 0, tasks: 0, skippedTasks: 0, docs: 0, attrs: 0 }

  if (dryRun) {
    for (const req of reqs) {
      const list = subreqsByReq.get(req.id)
      let kept = 0
      let skipped = 0
      for (const sr of list) {
        for (const t of tasksBySubreq.get(sr.id)) {
          if (isRedundantSubtask(sr, t)) skipped += 1
          else kept += 1
        }
      }
      stats.requirements += 1
      stats.subreqs += list.length
      stats.tasks += kept
      stats.skippedTasks += skipped
      console.log(`  [预演] ${req.req_no || '无编号'} — ${cleanName(req.title)}（${list.length} 子需求, ${kept} 子任务, 剔除 ${skipped} 冗余登记单元）`)
    }
  } else {
    const defReqNo = getOrCreateAttrDef(tb, 'requirement', 'req_no', '需求编号', 'text')
    const defFeishu = getOrCreateAttrDef(tb, 'requirement', 'feishu_url', '飞书文档', 'url')
    const defReqBranch = getOrCreateAttrDef(tb, 'requirement', 'branch', '分支', 'text')
    const defSrBranch = getOrCreateAttrDef(tb, 'subreq', 'branch', '分支', 'text')
    const defSrBaseline = getOrCreateAttrDef(tb, 'subreq', 'baseline', '基线', 'text')
    const defSrProject = getOrCreateAttrDef(tb, 'subreq', 'gitlab_project', 'GitLab 项目', 'text')
    const defTestReport = getOrCreateAttrDef(tb, 'task', 'test_report_url', '测试报告', 'url')

    if (reset) {
      const proj = tb.prepare('SELECT id FROM nodes WHERE parent_id IS NULL AND name = ?').get(ROOT_NAME)
      if (proj) {
        tb.prepare('DELETE FROM nodes WHERE id = ?').run(proj.id) // 外键级联删除子树/文档/属性值
        console.log('已清除旧的「' + ROOT_NAME + '」树')
      }
    }

    const root = ensureNode(tb, null, ROOT_NAME, 'project', 'doing')
    console.log('项目节点: ' + ROOT_NAME + ' (id=' + root.id + ')')

    for (const req of reqs) {
      const reqName = cleanName(req.title)
      const reqNode = ensureNode(tb, root.id, reqName, 'requirement', mapStatus(req.status))
      stats.requirements += 1

      if (req.req_no) { setAttr(tb, reqNode.id, defReqNo, req.req_no); stats.attrs += 1 }
      if (req.feishu_url) { setAttr(tb, reqNode.id, defFeishu, req.feishu_url); stats.attrs += 1 }
      if (req.branch) { setAttr(tb, reqNode.id, defReqBranch, req.branch); stats.attrs += 1 }
      // 需求正文（长文本）落在规格预置的「需求内容」文档；原始全名附在文档开头便于追溯
      if (req.note) {
        const body = req.title !== reqName ? `> 原始名称：${req.title}\n\n${req.note}` : req.note
        upsertDoc(tb, reqNode.id, '需求内容', body)
        stats.docs += 1
      }

      for (const sr of subreqsByReq.get(req.id)) {
        const srName = cleanName(sr.name)
        const srNode = ensureNode(tb, reqNode.id, srName, 'subreq', mapStatus(sr.status))
        stats.subreqs += 1

        if (sr.branch) { setAttr(tb, srNode.id, defSrBranch, sr.branch); stats.attrs += 1 }
        if (sr.base_branch) { setAttr(tb, srNode.id, defSrBaseline, sr.base_branch); stats.attrs += 1 }
        const repoList = reposBySubreq.get(sr.id) || []
        if (repoList.length) { setAttr(tb, srNode.id, defSrProject, repoList.join(', ')); stats.attrs += 1 }

        if (sr.task_desc) {
          upsertDoc(tb, srNode.id, '需求内容', sr.task_desc)
          stats.docs += 1
        }
        if (sr.verify_note) {
          upsertDoc(tb, srNode.id, '验证说明', sr.verify_note)
          stats.docs += 1
        }

        for (const t of tasksBySubreq.get(sr.id)) {
          if (isRedundantSubtask(sr, t)) {
            stats.skippedTasks += 1 // 内容已由 subreq 承载，不建空壳 task
            continue
          }
          const tNode = ensureNode(tb, srNode.id, cleanName(t.name), 'task', mapStatus(t.status))
          stats.tasks += 1
          if (t.task_desc) {
            upsertDoc(tb, tNode.id, '需求内容', t.task_desc)
            stats.docs += 1
          }
          if (t.verify_note) {
            upsertDoc(tb, tNode.id, '验证说明', t.verify_note)
            stats.docs += 1
          }
          if (t.test_report_url) { setAttr(tb, tNode.id, defTestReport, t.test_report_url); stats.attrs += 1 }
        }
      }

      // SQL 脚本挂到需求节点（文档名「SQL: {feature}」）
      for (const si of sqlByReq.get(req.id)) {
        const docName = 'SQL: ' + (si.feature || '未分类')
        let body = '**目标库**：' + (si.db_name || '未知') + '　**审批状态**：' + (si.approval_status || '未知') + '\n'
        if (si.sql_text) body += '\n```sql\n' + si.sql_text + '\n```\n'
        upsertDoc(tb, reqNode.id, docName, body)
        stats.docs += 1
      }
    }

    // 任何写入让 revision +1，前端轮询可感知
    tb.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'").run()
  }

  dsh.close()
  if (tb) tb.close()

  console.log('\n导入完成' + (dryRun ? '（预演）' : '') + '：')
  console.log('  需求: ' + stats.requirements)
  console.log('  子需求: ' + stats.subreqs)
  console.log('  子任务: ' + stats.tasks)
  console.log('  剔除冗余登记单元: ' + stats.skippedTasks)
  console.log('  文档: ' + stats.docs)
  console.log('  属性值: ' + stats.attrs)
  return stats
}

const isDirect = process.argv[1] && process.argv[1].endsWith('import-dsh.mjs')
if (isDirect) {
  const flags = parseArgs()
  if (flags.dryRun) console.log('[预演模式] 不写入 task-board 数据库\n')
  importDshCharge({ dshDbPath: flags.dshDb, dryRun: flags.dryRun, reset: flags.reset }).catch((e) => {
    console.error('导入失败: ' + e.message)
    process.exit(1)
  })
}