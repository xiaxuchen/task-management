/**
 * 本机 git 操作（commit diff 预览用）
 *
 * 实现说明：features/diff-preview/design.md 原计划引入 simple-git；
 * 实际采用 node:child_process.execFile 直接调用本机 git（参数数组、不经 shell），
 * 零新增依赖，保持"纯本地"定位。GitLab API 兜底分支留待计划 5
 * （当前 local_path 缺失即报 REPO_PATH_MISSING，见 features/diff-preview/prd.md）。
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { AppError, CODES } from './errors.mjs'

const execFileP = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024 // git 输出上限（大 patch 需要）
const MAX_TEXT = 512 * 1024 // 单文件 patch / old / new 的截断阈值（字符）

async function git(dir, args) {
  try {
    const { stdout } = await execFileP('git', ['-C', dir, ...args], { maxBuffer: MAX_BUFFER, encoding: 'utf8' })
    return stdout
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new AppError(CODES.GIT_UNAVAILABLE, '本机 git 不可用（命令不存在）')
    }
    throw new AppError(CODES.GIT_FAILED, `git ${args[0]} 执行失败`, {
      stderr: String((e && (e.stderr || e.message)) || '').slice(0, 2000)
    })
  }
}

/** 不抛错的 git 执行（用于以退出码表达结果的命令，如 merge-base --is-ancestor） */
async function gitTry(dir, args) {
  try {
    const { stdout } = await execFileP('git', ['-C', dir, ...args], { maxBuffer: MAX_BUFFER, encoding: 'utf8' })
    return { ok: true, code: 0, stdout }
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new AppError(CODES.GIT_UNAVAILABLE, '本机 git 不可用（命令不存在）')
    }
    return { ok: false, code: typeof e.code === 'number' ? e.code : 1, stderr: String((e && (e.stderr || e.message)) || '') }
  }
}

/** 仓库解析：local_path 存在且是 git 仓库 → 返回目录；否则抛稳定错误码 */
export function resolveRepoDir(repo) {
  if (!repo) throw new AppError(CODES.REPO_NOT_REGISTERED, '仓库未登记（先 repo add）')
  const dir = repo.localPath
  if (!dir) {
    throw new AppError(CODES.REPO_PATH_MISSING, `仓库 ${repo.name} 未登记本地路径（local_path），无法读取本机 git`, { repo: repo.name })
  }
  if (!fs.existsSync(path.join(dir, '.git'))) {
    throw new AppError(CODES.REPO_PATH_MISSING, `本地路径不存在或不是 git 仓库：${dir}`, { repo: repo.name, path: dir })
  }
  return dir
}

function clip(value) {
  if (value == null) return { text: '', truncated: false }
  const s = String(value)
  return s.length > MAX_TEXT ? { text: s.slice(0, MAX_TEXT), truncated: true } : { text: s, truncated: false }
}

function parseNumstat(out) {
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const parts = l.split('\t')
      const binary = parts[0] === '-' && parts[1] === '-'
      return {
        path: parts.slice(2).join('\t'),
        additions: binary ? 0 : Number(parts[0]),
        deletions: binary ? 0 : Number(parts[1]),
        binary
      }
    })
}

export async function showFileAt(dir, rev, filePath) {
  try {
    return await git(dir, ['show', `${rev}:${filePath}`])
  } catch {
    return null // 新文件取 ^:path、删除文件取 sha:path 会失败，静默置空
  }
}

/** commit 元信息（轻量：不拉 patch）：sha/作者/邮箱/时间/主题 + 包含该提交的分支 */
export async function commitMeta(dir, sha) {
  const meta = await git(dir, ['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%ad%x1f%s', '--date=iso', sha])
  const [fullSha, author, authorEmail, date, subject] = meta.trimEnd().split('\x1f')
  return { sha: fullSha, author, authorEmail, date, subject, branches: await branchesContaining(dir, fullSha) }
}

/** 单个 commit 的完整 diff：meta + 文件列表 + 每文件 patch / old / new */
export async function commitDiff(dir, sha) {
  const meta = await commitMeta(dir, sha)

  const entries = parseNumstat(await git(dir, ['show', sha, '--numstat', '--no-renames', '--format=']))

  const files = []
  for (const f of entries) {
    let patch = { text: '', truncated: false }
    if (!f.binary) {
      const raw = await git(dir, ['show', sha, '--format=', '--no-renames', '--', f.path]).catch(() => '')
      patch = clip(raw)
    }
    let oldText = { text: '', truncated: false }
    let newText = { text: '', truncated: false }
    if (!f.binary) {
      const oldRaw = await showFileAt(dir, `${sha}^`, f.path)
      if (oldRaw != null) oldText = clip(oldRaw)
      const newRaw = await showFileAt(dir, sha, f.path)
      if (newRaw != null) newText = clip(newRaw)
    }
    files.push({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      binary: f.binary,
      patch: patch.text,
      patchTruncated: patch.truncated,
      old: oldText.text,
      oldTruncated: oldText.truncated,
      new: newText.text,
      newTruncated: newText.truncated
    })
  }

  return { ...meta, shortSha: meta.sha.slice(0, 9), files }
}

/** commit 时间戳（秒） */
export async function commitTime(dir, sha) {
  const r = await git(dir, ['show', '-s', '--format=%at', sha])
  return Number(r.trim())
}

/** 提交的父提交列表 */
export async function commitParents(dir, sha) {
  const r = await git(dir, ['show', '-s', '--format=%P', sha])
  const t = r.trim()
  return t ? t.split(/\s+/) : []
}

/**
 * patch-id（--stable）：同一内容不同 sha（rebase / cherry-pick）得到相同值；
 * merge 提交无意义（调用方先判断 parents 数量跳过）。实现为 git show | git patch-id 管道（不经 shell）。
 */
export function patchId(dir, sha) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    try {
      const show = spawn('git', ['-C', dir, 'show', sha, '--no-color', '--no-renames', '--format='], {
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const pid = spawn('git', ['-C', dir, 'patch-id', '--stable'], { stdio: ['pipe', 'pipe', 'ignore'] })
      show.stdout.pipe(pid.stdin)
      let out = ''
      pid.stdout.on('data', (d) => {
        out += d.toString()
      })
      pid.on('close', () => done(out.trim().split(/\s+/)[0] || null))
      pid.on('error', () => done(null))
      show.on('error', () => done(null))
      setTimeout(() => done(null), 30000)
    } catch {
      done(null)
    }
  })
}

/** merge 提交的第二父分支独有提交（被合入的提交集）：rev-list <sha>^2 --not <sha>^1 */
export async function mergedInCommits(dir, parents) {
  if (!parents || parents.length < 2) return []
  const r = await gitTry(dir, ['rev-list', parents[1], '--not', parents[0]])
  if (!r.ok) return []
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 包含该提交的分支（本地 + 远程，去重去 origin/ 前缀，限 8 个） */
export async function branchesContaining(dir, sha) {
  const r = await gitTry(dir, ['branch', '-a', '--contains', sha, '--format=%(refname:short)'])
  if (!r.ok) return []
  const out = []
  const seen = new Set()
  for (const raw of r.stdout.split('\n')) {
    let b = raw.trim()
    if (!b || b.includes('HEAD detached')) continue
    b = b.replace(/^remotes\/origin\//, '').replace(/^origin\//, '')
    if (seen.has(b)) continue
    seen.add(b)
    out.push(b)
    if (out.length >= 8) break
  }
  return out
}

/** 为提交挑选"开发分支"：排除 feature-merge，优先最具体的 feature-*（含子需求/子任务 slug），否则回退第一个 */
export async function pickBranchForCommit(dir, sha) {
  const all = await branchesContaining(dir, sha)
  if (!all.length) return null
  const feats = all.filter((b) => b.startsWith('feature-') && b !== 'feature-merge')
  if (feats.length) {
    // 最具体 = 最长（如 feature-send-receive-3.1.1-inner-buy-flag > feature-send-receive）
    return feats.sort((a, b) => b.length - a.length)[0]
  }
  return all[0]
}

/**
 * 合并预览（MR 式）：将合入的变更统计 + 冲突预判（git merge-tree --write-tree）。
 * 返回：{ willIntroduce: [{file,add,del}], conflictFiles: [..], conflicted: bool, stat: string }
 */
export async function previewMerge(dir, source, target) {
  const stat = await gitTry(dir, ['diff', '--stat', `${target}...${source}`])
  const files = []
  if (stat.ok) {
    for (const line of stat.stdout.split('\n')) {
      const m = line.match(/^ (.+?)\s+\|\s+(\d+)\s*([+-]*)$/)
      if (m) {
        const plus = (m[3].match(/\+/g) || []).length
        const minus = (m[3].match(/-/g) || []).length
        files.push({ file: m[1].trim(), add: plus, del: minus })
      }
    }
  }
  const mt = await gitTry(dir, ['merge-tree', '--write-tree', target, source])
  let conflicted = false
  const conflictFiles = []
  if (mt.ok && mt.code !== 0) {
    conflicted = true
    for (const line of String(mt.stdout || '').split('\n').slice(1)) {
      const t = line.trim()
      if (t) conflictFiles.push(t.replace(/\x00.*$/, ''))
    }
  }
  return {
    willIntroduce: files.slice(0, 80),
    conflicted,
    conflictFiles: conflictFiles.slice(0, 30),
    stat: String(stat.ok ? stat.stdout : '').slice(-3000)
  }
}

/** 一次 git log 拿分支上的全部 sha（Set）；ref 不存在返回 null */
export async function branchLogShas(dir, branch, maxCount = 5000) {
  const ref = await resolveBranchRef(dir, branch)
  if (!ref) return null
  const r = await gitTry(dir, ['log', ref, '--format=%H', `--max-count=${maxCount}`])
  if (!r.ok) return null
  return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean))
}

/**
 * 主仓库合并：把 source 合入 target（--no-ff）。
 * 前置安全判定：① 当前工作区无未解决冲突（UU/AA/DD 等）② 能切到 target。
 * 返回：{ ok, alreadyMerged?, conflict?, reason?, unmerged?, mergeSha?, message? }
 */
export async function mergeBranch(dir, source, target, message) {
  // ① 未解决冲突检查
  const st = await gitTry(dir, ['status', '--porcelain'])
  if (st.ok) {
    const unmerged = st.stdout
      .split('\n')
      .filter((l) => /^(UU|AA|DD|AU|UA|DU|UD) /.test(l))
      .slice(0, 10)
    if (unmerged.length) {
      return { ok: false, conflict: true, reason: 'unresolved_conflicts', unmerged }
    }
  }
  // ② 已合入判定（source 的 tip 是否为 target 祖先）
  const anc = await gitTry(dir, ['merge-base', '--is-ancestor', source, target])
  if (anc.ok && anc.code === 0) {
    return { ok: true, alreadyMerged: true, reason: 'already_merged' }
  }
  // ③ 切到 target
  const co = await gitTry(dir, ['checkout', target])
  if (!co.ok) {
    return { ok: false, conflict: false, reason: 'checkout_failed', message: String(co.stderr || '').slice(0, 1000) }
  }
  // ④ merge --no-ff
  const m = await gitTry(dir, ['merge', '--no-ff', source, '-m', message || `merge: ${source} -> ${target}`])
  if (m.ok) {
    const head = await gitTry(dir, ['rev-parse', 'HEAD'])
    return { ok: true, mergeSha: head.ok ? head.stdout.trim() : null, message: String(m.stdout || '').slice(0, 500) }
  }
  const out = String(m.stderr || '') + String(m.stdout || '')
  const conflicted = /CONFLICT|Automatic merge failed/i.test(out)
  return {
    ok: false,
    conflict: conflicted,
    reason: conflicted ? 'merge_conflict' : 'merge_failed',
    message: out.slice(0, 2000)
  }
}

/** 仅变更文件统计（子树聚合用，避免拉取全量 patch / old / new） */
export async function commitStat(dir, sha) {
  return parseNumstat(await git(dir, ['show', sha, '--numstat', '--no-renames', '--format=']))
}

/** 解析追踪目标 ref：优先 origin/<name>，其次本地分支，再次 tag，最后按原样交给 git（name 可为分支名或 tag 名） */
async function resolveBranchRef(dir, branch) {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`, `refs/tags/${branch}`, branch]) {
    const r = await gitTry(dir, ['rev-parse', '--verify', '--quiet', ref])
    if (r.ok && r.stdout.trim()) return ref
  }
  return null
}

/**
 * 检测 commit 是否已合并/包含在指定目标（分支或 tag）中：
 * - 未配置 → { contained: null, reason: 'not-configured' }
 * - 本地无该 ref（未 fetch）→ { contained: null, reason: 'ref-not-found' }
 * - 是/否包含 → { contained: true|false, ref }
 */
export async function branchContains(dir, sha, branch) {
  if (!branch) return { branch: null, ref: null, contained: null, reason: 'not-configured' }
  const ref = await resolveBranchRef(dir, branch)
  if (!ref) return { branch, ref: null, contained: null, reason: 'ref-not-found' }
  const r = await gitTry(dir, ['merge-base', '--is-ancestor', sha, ref])
  if (r.code === 0) return { branch, ref, contained: true, reason: null }
  if (r.code === 1) return { branch, ref, contained: false, reason: null }
  return { branch, ref, contained: null, reason: 'git-error' }
}

/** 检测 commit 对三个目标（测试/预发/上线，可为分支或 tag）的包含状态 */
export async function commitTrack(dir, sha, branches) {
  const out = {}
  for (const [key, branch] of Object.entries(branches || {})) {
    out[key] = await branchContains(dir, sha, branch)
  }
  return out
}
