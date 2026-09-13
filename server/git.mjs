/**
 * 本机 git 操作（commit diff 预览用）
 *
 * 实现说明：features/diff-preview/design.md 原计划引入 simple-git；
 * 实际采用 node:child_process.execFile 直接调用本机 git（参数数组、不经 shell），
 * 零新增依赖，保持"纯本地"定位。GitLab API 兜底分支留待计划 5
 * （当前 local_path 缺失即报 REPO_PATH_MISSING，见 features/diff-preview/prd.md）。
 */
import { execFile } from 'node:child_process'
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

async function showFileAt(dir, rev, filePath) {
  try {
    return await git(dir, ['show', `${rev}:${filePath}`])
  } catch {
    return null // 新文件取 ^:path、删除文件取 sha:path 会失败，静默置空
  }
}

/** 单个 commit 的完整 diff：meta + 文件列表 + 每文件 patch / old / new */
export async function commitDiff(dir, sha) {
  const meta = await git(dir, ['show', '-s', '--format=%H%x1f%an%x1f%ad%x1f%s', '--date=iso', sha])
  const [fullSha, author, date, subject] = meta.trimEnd().split('\x1f')

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

  return { sha: fullSha, shortSha: fullSha.slice(0, 9), author, date, subject, files }
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
