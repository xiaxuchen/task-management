#!/usr/bin/env node
/**
 * task-board ⇄ Qoder Hook 桥（Claude Code 规范，Qoder CLI/IDE 通用）v2
 *
 * 作用：
 *  - UserPromptSubmit：
 *    1) 从提示词识别任务编号/关键词 → 注入该任务上下文（层级路径 / 文档摘要 / PRD / 已登记提交）；
 *       显式提及（@ 或「引号名」）时文档摘要加长（1200 字 vs 500 字）。
 *    2) 提示词含 review 触发词（当前review/这次变更/@review/变更文件…）→ 附带"当前 review 上下文"
 *       （由 IDEA TaskBoard 插件写到 ~/.taskboard/current-review.json：节点/勾选提交/变更文件）；
 *       或关键词命中的任务正好是插件当前 review 的节点时也附带。
 *  - Stop：记录日志（后续可按需扩展为自动回写登记）。
 *
 * 配置（~/.qoder/settings.json 的 hooks 段）：
 *  {
 *    "hooks": {
 *      "UserPromptSubmit": [ { "hooks": [ { "type": "command",
 *        "command": "bash /Users/xuchen.xia/charge2/task-board/hooks/qoder-bridge.sh", "timeout": 15 } ] } ],
 *      "Stop": [ { "hooks": [ { "type": "command",
 *        "command": "bash /Users/xuchen.xia/charge2/task-board/hooks/qoder-bridge.sh", "timeout": 15 } ] } ]
 *    }
 *  }
 *
 * 日志：/tmp/taskboard-qoder-bridge.log（每次调用一行，便于排查）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG = '/tmp/taskboard-qoder-bridge.log'
const MAX_CTX_CHARS = 6000
/** IDEA TaskBoard 插件写出的"当前 review 上下文"文件 */
const REVIEW_FILE = path.join(os.homedir(), '.taskboard', 'current-review.json')
/** IDEA TaskBoard 插件写出的"选中代码片段"文件（「记入上下文」按钮追加） */
const SNIPPETS_FILE = path.join(os.homedir(), '.taskboard', 'selected-snippets.md')
/** IDEA TaskBoard 插件自动捕获的"最近选中"（选区变化防抖写入） */
const LAST_SELECTION_FILE = path.join(os.homedir(), '.taskboard', 'last-selection.md')
/** snippets 触发词：命中则附带选中代码片段 */
const SNIPPET_TRIGGER = /这段|这些|选中|该代码|这个代码|snippet|@选/i
/** review 触发词：命中则附带当前 review 上下文 */
const REVIEW_TRIGGER =
  /当前\s*review|当前审查|这次变更|本次变更|这次改动|本次改动|当前\s*diff|这个\s*diff|变更文件|@review|current\s*review/i

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

// ---------------- UserPromptSubmit：注入任务 / review 上下文 ----------------

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

/** 组装注入文本：任务上下文（编号/关键词）+ 当前 review 上下文（触发词/同源） */
async function buildTaskContext(prompt) {
  try {
    const keywords = extractKeywords(prompt)
    const explicit = /(^|[^\w])@[^\s@]/.test(prompt) || /[「『“"][^」』”"]{2,30}[」』”"]/.test(prompt)
    const parts = []

    // 1) 任务上下文（编号 / 关键词命中）
    if (keywords.length > 0) {
      const taskPart = await buildTaskPart(keywords, explicit)
      if (taskPart) parts.push(taskPart)
    }

    // 2) 当前 review 上下文（完整 md）
    const review = loadReviewContext()
    let reviewPushed = false
    if (review) {
      const trigger = REVIEW_TRIGGER.test(prompt)
      const sameNode =
        keywords.length > 0 && !!review.nodeName && keywords.some((k) => review.nodeName.includes(k))
      if (trigger || sameNode) {
        parts.push(review.md)
        reviewPushed = true
        log(`review ctx attached (trigger=${trigger} sameNode=${sameNode})`)
      }
    }

    // 3) 选中代码片段（含任务简报：任务 id/项目/commit/文件；review 完整段未推时用简报）
    if (SNIPPET_TRIGGER.test(prompt) || REVIEW_TRIGGER.test(prompt)) {
      if (!reviewPushed && review && review.brief) {
        parts.push(review.brief)
        log('review brief attached')
      }
      const snippets = loadSelectedSnippets()
      if (snippets) {
        parts.push(snippets)
        log('snippets attached')
      }
    }

    if (parts.length === 0) return null
    const text = parts.join('\n\n')
    return text.length > MAX_CTX_CHARS ? text.slice(0, MAX_CTX_CHARS) + '\n…（已截断）' : text
  } catch (e) {
    log('buildTaskContext error: ' + (e && e.stack ? e.stack.split('\n')[0] : e))
    return null
  }
}

/** 任务上下文：查库 + 组装（explicit=true 时文档摘要加长） */
async function buildTaskPart(keywords, explicit) {
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
      sections.push(buildNodeSection(db, node, explicit ? 1200 : 500))
    }
    return sections.join('\n\n')
  } finally {
    try {
      db.close()
    } catch {
      // 忽略关闭异常
    }
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

/** 组装单个节点的上下文段落（briefLen：文档摘要字符数上限） */
function buildNodeSection(db, node, briefLen) {
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

  // 文档（需求内容 / 设计方案）
  const docs = db
    .prepare('SELECT name, content FROM documents WHERE node_id = ? ORDER BY sort')
    .all(node.id)
  for (const d of docs.slice(0, 3)) {
    const full = String(d.content || '')
    const brief = full.replace(/\s+/g, ' ').slice(0, briefLen)
    if (brief) lines.push(`- **${d.name}**：${brief}${full.length > briefLen ? '…' : ''}`)
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

/** 读取 IDEA TaskBoard 插件写出的"当前 review 上下文"（~/.taskboard/current-review.json） */
function loadReviewContext() {
  try {
    if (!fs.existsSync(REVIEW_FILE)) return null
    const o = JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8'))
    if (!o || !o.nodeName) return null
    const ageMin = Math.max(0, Math.round((Date.now() - Number(o.updatedAt || 0)) / 60000))
    const lines = [`## 当前 review 上下文（来自 IDEA TaskBoard 插件，更新于 ${ageMin} 分钟前）`]
    lines.push(`- **当前节点**：${o.nodeName}（id=${o.nodeId}）`)
    const commits = Array.isArray(o.checkedCommits) ? o.checkedCommits : []
    if (commits.length > 0) {
      lines.push(`- **勾选提交（${commits.length}）**：`)
      for (const c of commits.slice(0, 10)) {
        lines.push(`  - ${String(c.sha || '').slice(0, 10)} ${c.note || ''}（${c.repo || ''}）`)
      }
      if (commits.length > 10) lines.push(`  - …共 ${commits.length} 个`)
    }
    const files = Array.isArray(o.files) ? o.files : []
    if (files.length > 0) {
      lines.push(`- **变更文件（${files.length}）**：`)
      for (const f of files.slice(0, 30)) lines.push(`  - ${f}`)
      if (files.length > 30) lines.push(`  - …共 ${files.length} 个`)
    }
    return { md: lines.join('\n'), brief: renderReviewBrief(o, commits, files), nodeName: String(o.nodeName) }
  } catch (e) {
    log('loadReviewContext error: ' + (e && e.message ? e.message : e))
    return null
  }
}

/** 生成"当前任务简报"（任务 id/名称 + 代码项目 + commit + 文件；用于随选中片段一起注入） */
function renderReviewBrief(o, commits, files) {
  const repos = [...new Set(commits.map((c) => c.repo).filter(Boolean))]
  const lines = ['## 当前任务（IDEA TaskBoard review，自动带入供定位上下文）']
  lines.push(`- 任务：${o.nodeName}（id=${o.nodeId}）`)
  if (repos.length) lines.push(`- 代码项目：${repos.join('、')}`)
  if (commits.length) {
    lines.push(`- 相关 commit（${commits.length}）：`)
    for (const c of commits.slice(0, 5)) {
      lines.push(`  - ${String(c.sha || '').slice(0, 10)} ${c.note || ''}（${c.repo || ''}）`)
    }
    if (commits.length > 5) lines.push(`  - …共 ${commits.length} 个`)
  }
  if (files.length) {
    lines.push(`- 涉及文件（${files.length}）：`)
    for (const f of files.slice(0, 15)) lines.push(`  - ${f}`)
    if (files.length > 15) lines.push(`  - …共 ${files.length} 个`)
  }
  return lines.join('\n')
}

/** 读取选中代码：自动捕获的"最近选中" + 手动记入的片段池（各自 2 小时内有效） */
function loadSelectedSnippets() {
  try {
    const parts = []
    const fresh = (p) => {
      try {
        if (!fs.existsSync(p)) return null
        const st = fs.statSync(p)
        if (Date.now() - st.mtimeMs > 2 * 60 * 60 * 1000) return null
        const c = fs.readFileSync(p, 'utf8')
        return c.trim() ? c : null
      } catch {
        return null
      }
    }
    const last = fresh(LAST_SELECTION_FILE)
    if (last) parts.push('## 你最近在 IDEA 中选中的代码（自动捕获）\n' + last)
    let pool = fresh(SNIPPETS_FILE)
    if (pool) {
      if (pool.length > 3000) pool = '…（较早片段省略）\n' + pool.slice(-3000)
      parts.push('## 你在 IDEA 里记入的选中代码片段（最近）\n' + pool)
    }
    return parts.length ? parts.join('\n\n') : null
  } catch (e) {
    log('loadSelectedSnippets error: ' + (e && e.message ? e.message : e))
    return null
  }
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
