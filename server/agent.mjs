/**
 * agent 执行器（测试节点：写提示词触发 agent）
 *
 * 目前支持 qodercli：-p 非交互执行 + -m 指定模型 + -w 工作目录 + 跳过交互权限确认；
 * 默认模型 DeepSeek-Flash。执行在 task-board 服务进程内异步进行，
 * 输出实时落库（限 200KB），默认超时 10 分钟。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { AppError, CODES } from './errors.mjs'

export const DEFAULT_AGENT = 'qodercli'
export const DEFAULT_MODEL = 'DeepSeek-Flash'
const TIMEOUT_MS = 10 * 60 * 1000

function buildCommand(run) {
  if (run.agent === 'qodercli') {
    return {
      cmd: 'qodercli',
      args: ['-p', run.prompt, '-m', run.model, '-w', run.cwd, '--permission-mode', 'bypass_permissions']
    }
  }
  // 其他命令（如测试用的 echo）：透传 prompt
  return { cmd: run.agent, args: ['-p', run.prompt] }
}

/** 推导运行目录：节点子树内已登记 commits 的仓库中，第一个存在本地路径的 */
export function resolveRunCwd(store, nodeId) {
  const repos = new Map(store.listRepos().map((r) => [r.name, r]))
  const commits = store.listCommits(nodeId, { subtree: true })
  for (const c of commits) {
    if (!c.repo) continue
    const repo = repos.get(c.repo)
    if (repo && repo.localPath && fs.existsSync(repo.localPath)) return repo.localPath
  }
  return null
}

/**
 * 创建并启动一次 agent 运行（异步执行，立即返回 run；结果用 getAgentRun / listAgentRuns 查询）
 */
export function startAgentRun(store, nodeId, { prompt, agent = DEFAULT_AGENT, model = DEFAULT_MODEL, cwd = null } = {}, by = 'user') {
  const dir = cwd || resolveRunCwd(store, nodeId)
  if (!dir) {
    throw new AppError(
      CODES.VALIDATION_FAILED,
      '无法确定运行目录：该节点子树内没有登记过带本地路径的仓库（先 repo add 或显式指定 cwd）',
      {}
    )
  }
  if (!fs.existsSync(dir)) {
    throw new AppError(CODES.VALIDATION_FAILED, `运行目录不存在：${dir}`, { cwd: dir })
  }

  const run = store.createAgentRun(nodeId, { agent, model, prompt, cwd: dir }, by)
  const { cmd, args } = buildCommand(run)

  let child
  try {
    child = spawn(cmd, args, {
      cwd: dir,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ''}` },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    store.appendAgentRunOutput(run.id, `[task-board] 启动失败：${e.message}\n`)
    return store.finishAgentRun(run.id, { status: 'failed' })
  }

  const append = (chunk) => store.appendAgentRunOutput(run.id, chunk.toString('utf8'))
  child.stdout.on('data', append)
  child.stderr.on('data', append)

  const timer = setTimeout(() => {
    append(`\n[task-board] 执行超时（${TIMEOUT_MS / 60000} 分钟），已终止\n`)
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
    safeFinish(store, run.id, { status: 'timeout' })
  }, TIMEOUT_MS)

  child.on('error', (e) => {
    clearTimeout(timer)
    store.appendAgentRunOutput(run.id, `\n[task-board] 启动错误：${e.message}\n`)
    safeFinish(store, run.id, { status: 'failed' })
  })

  child.on('close', (code) => {
    clearTimeout(timer)
    safeFinish(store, run.id, { status: code === 0 ? 'success' : 'failed', exitCode: code })
  })

  return run
}

/** 仅当仍为 running 时收尾（避免超时与 close 重复写入） */
function safeFinish(store, runId, patch) {
  try {
    const cur = store.getAgentRun(runId)
    if (cur.status !== 'running') return
    store.finishAgentRun(runId, patch)
  } catch {
    /* 记录已被清理等场景忽略 */
  }
}
