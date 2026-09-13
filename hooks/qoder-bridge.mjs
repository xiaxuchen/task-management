#!/usr/bin/env node
/**
 * task-board ⇄ Qoder Hook 桥（Claude Code 规范，Qoder CLI/IDE 通用）
 *
 * 作用：
 *  - UserPromptSubmit：从提示词中识别任务编号/关键词 → 查 task-board 库 → 把当前任务的
 *    上下文（层级路径 / 文档摘要 / PRD 链接 / 已登记提交）以 additionalContext 注入 Qoder。
 *  - Stop：记录日志（后续可按需扩展为自动回写登记）。
 *
 * 配置（~/.qoder/settings.json 的 hooks 段）：
 *  {
 *    "hooks": {
 *      "UserPromptSubmit": [ { "hooks": [ { "type": "command",
 *        "command": "node /Users/xuchen.xia/charge2/task-board/hooks/qoder-bridge.mjs", "timeout": 15 } ] } ],
 *      "Stop": [ { "hooks": [ { "type": "command",
 *        "command": "node /Users/xuchen.xia/charge2/task-board/hooks/qoder-bridge.mjs", "timeout": 15 } ] } ]
 *    }
 *  }
 *
 * 日志：/tmp/taskboard-qoder-bridge.log（每次调用一行，便于排查）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG = '/tmp/taskboard-qoder-bridge.log'
const MAX_CTX_CHARS = 4000

const log = (m) => {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`)
  } catch {
    // 日志失败不影响主流程
  }
}

/** 读 stdin 全量并按 JSON 解析（带 3 秒兜底，防钩子环境无输入导致挂起） */
function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    const timer = setTimeout(() => resolve(null), 3000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(null)
      }
    })
    process.stdin.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

const input = await readStdin()
if (!input || typeof input !== 'object') {
  log('no/invalid stdin')
  process.exit(0)
}

const event = String(input.hook_event_name || '')
const cwd = String(input.cwd || '')
const prompt = String(input.prompt || '')
log(`event=${event} cwd=${cwd} prompt=${prompt.replace(/\s+/g, ' ').slice(0, 120)}`)

// ---------------- UserPromptSubmit：注入任务上下文 ----------------

if (event === 'UserPromptSubmit') {
  const ctx = await buildTaskContext(prompt)
  if (ctx) {
    log(`inject ${ctx.length} chars`)
    // Claude Code / Qoder 规范：hookSpecificOutput.additionalContext 会附加给模型
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
      })
    )
  } else {
    log('no task matched')
  }
}

process.exit(0)

// ---------------- 实现 ----------------

/** 从提示词提取候选关键词并查询任务 */
async function buildTaskContext(prompt) {
  try {
    const keywords = extractKeywords(prompt)
    if (keywords.length === 0) return null

    const { DatabaseSync } = await import('node:sqlite')
    const { DB_PATH } = await import(pathToFileURL(path.join(__dirname, '../server/config.mjs')).href)
    if (!fs.existsSync(DB_PATH)) {
      log(`db not found: ${DB_PATH}`)
      return null
    }
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    try {
      const found = []
      for (const kw of keywords.slice(0, 4)) {
        const rows = db
          .prepare(
            `SELECT id, type, name, parent_id, status FROM nodes
             WHERE name LIKE ? AND type IN ('requirement','subreq','group','task','defect')
             ORDER BY length(name) LIMIT 3`
          )
          .all(`%${kw}%`)
        for (const r of rows) {
          if (!found.some((f) => f.id === r.id)) found.push(r)
        }
        if (found.length >= 3) break
      }
      if (found.length === 0) return null

      const sections = ['## 来自 task-board 的任务上下文（自动注入，供参考；如与当前问题无关请忽略）']
      for (const node of found.slice(0, 2)) {
        sections.push(buildNodeSection(db, node))
      }
      const text = sections.join('\n\n')
      return text.length > MAX_CTX_CHARS ? text.slice(0, MAX_CTX_CHARS) + '\n…（已截断）' : text
    } finally {
      try {
        db.close()
      } catch {
        // 忽略关闭异常
      }
    }
  } catch (e) {
    log('buildTaskContext error: ' + (e && e.stack ? e.stack.split('\n')[0] : e))
    return null
  }
}

/** 关键词提取：编号（3.1.1 / 26Q3 / XPD-1141544）+ 显式提 task-board 时的引号内容 */
function extractKeywords(prompt) {
  const out = new Set()
  for (const m of prompt.matchAll(/\b(\d+(?:\.\d+){1,3})\b/g)) out.add(m[1])
  for (const m of prompt.matchAll(/\b((?:XPD|xp)[-_]?\d+)\b/gi)) out.add(m[1])
  if (/task-board|任务板|@tb\b|#tb\b/i.test(prompt)) {
    for (const m of prompt.matchAll(/[「『“"]([^」』”"]{2,30})[」』”"]/g)) out.add(m[1])
  }
  return [...out]
}

/** 组装单个节点的上下文段落 */
function buildNodeSection(db, node) {
  const lines = []
  // 层级路径（如：26Q3 雷阵雨 › 3.1 建站加盟 › 3.1.1 立项新增…）
  const pathNames = []
  let cur = node
  for (let i = 0; i < 8 && cur; i++) {
    pathNames.unshift(cur.name)
    cur = cur.parent_id
      ? db.prepare('SELECT id, name, parent_id FROM nodes WHERE id = ?').get(cur.parent_id)
      : null
  }
  lines.push(`### ${pathNames.join(' › ')}（${node.type} / ${node.status}）`)

  // 文档摘要（需求内容 / 设计方案）
  const docs = db
    .prepare('SELECT name, content FROM documents WHERE node_id = ? ORDER BY sort')
    .all(node.id)
  for (const d of docs.slice(0, 3)) {
    const full = String(d.content || '')
    const brief = full.replace(/\s+/g, ' ').slice(0, 500)
    if (brief) lines.push(`- **${d.name}**：${brief}${full.length > 500 ? '…' : ''}`)
  }

  // PRD（沿父链找 feishu_url）
  const prd = findFeishuUrl(db, node)
  if (prd) lines.push(`- PRD（飞书）：${prd}`)

  // 已登记提交
  const stats = db.prepare('SELECT COUNT(*) AS c FROM commits WHERE node_id = ?').get(node.id)
  if (stats && Number(stats.c) > 0) {
    const recent = db
      .prepare('SELECT repo, sha, note FROM commits WHERE node_id = ? ORDER BY id DESC LIMIT 3')
      .all(node.id)
    const brief = recent
      .map((r) => `${String(r.sha).slice(0, 8)}${r.note ? ' ' + r.note : ''}`)
      .join(' / ')
    lines.push(`- 已登记提交 ${stats.c} 个；最近：${brief}`)
  }
  return lines.join('\n')
}

/** 沿父链查找飞书 PRD 链接（节点属性 feishu_url） */
function findFeishuUrl(db, node) {
  let cur = node
  for (let i = 0; i < 8 && cur; i++) {
    const row = db
      .prepare(
        `SELECT av.value AS v FROM attr_values av
         JOIN attr_defs ad ON ad.id = av.attr_def_id
         WHERE av.node_id = ? AND ad.key = 'feishu_url' LIMIT 1`
      )
      .get(cur.id)
    if (row && row.v) return row.v
    cur = cur.parent_id
      ? db.prepare('SELECT id, parent_id FROM nodes WHERE id = ?').get(cur.parent_id)
      : null
  }
  return null
}
