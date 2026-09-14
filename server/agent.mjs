/**
 * agent 执行器
 *
 * 运行时模型对齐 multica：一个「运行时」= 本机上一个 agent CLI 实例，
 * 一个「会话」= 某个节点上可续跑的连续对话，一个「任务」= 一次执行。
 *
 * qodercli 走 `-p 非交互执行 + -m 模型 + -w 工作目录`；有会话号时用
 * `--resume <session_id>` 续跑同一会话。执行在服务进程内异步进行，
 * stdout/stderr 实时写进任务消息流（text 事件），默认超时 10 分钟。
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import fs from 'node:fs'
import { AppError, CODES } from './errors.mjs'

export const DEFAULT_AGENT = 'qodercli'
export const DEFAULT_MODEL = 'DeepSeek-Flash'
const TIMEOUT_MS = 10 * 60 * 1000

/** 服务进程自身就是一个 daemon：daemonId 用主机名，provider 是具体 CLI */
export function localDaemonId() {
  try {
    return os.hostname() || 'localhost'
  } catch {
    return 'localhost'
  }
}

/** 设备信息（对标 multica 的 device_info："host · os-arch"） */
export function localDeviceInfo() {
  const host = localDaemonId()
  const osName = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'
  return `${host} · ${osName}-${process.arch}`
}

/**
 * 确保本机某个 CLI 的运行时已注册并在线（服务启动 / 每次派单时调用）。
 * 幂等：按 daemonId + provider upsert。
 */
export function ensureLocalRuntime(store, provider = DEFAULT_AGENT, by = 'system') {
  return store.upsertRuntime(
    {
      name: `${localDaemonId()} · ${provider}`,
      daemonId: localDaemonId(),
      runtimeMode: 'local',
      provider,
      status: 'online',
      deviceInfo: localDeviceInfo(),
      visibility: 'private',
      metadata: { pid: process.pid, node: process.version }
    },
    by
  )
}

function buildCommand(run) {
  if (run.agent === 'qodercli') {
    const args = ['-p', run.prompt, '-m', run.model, '-w', run.cwd, '--permission-mode', 'bypass_permissions']
    // 续跑同一个 CLI 会话（对标 multica 的 --resume <session_id>）
    if (run.cliSessionId) args.push('--resume', run.cliSessionId)
    return { cmd: 'qodercli', args }
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
 * 创建并启动一次 agent 任务（异步执行，立即返回 run；结果用 getAgentRun / listAgentRuns 查询）。
 *
 * sessionId   —— 指定会话（缺省自动挂到该 node+agent 的活动会话）
 * resume      —— 续跑会话里上一个 CLI 会话（带上 --resume，需 session 已有 cliSessionId）
 * runtimeId   —— 指定运行时（缺省用本机同 provider 的运行时）
 */
export function startAgentRun(
  store,
  nodeId,
  { prompt, agent = DEFAULT_AGENT, model = DEFAULT_MODEL, cwd = null, ideMode = false, sessionId = null, resume = false, runtimeId = null } = {},
  by = 'user'
) {
  const dir = cwd || resolveRunCwd(store, nodeId)
  const runtime = runtimeId
    ? store.getRuntime(runtimeId)
    : ensureLocalRuntime(store, agent === DEFAULT_AGENT ? DEFAULT_AGENT : agent, 'system')

  // 续跑：先把会话里沉淀的 CLI 会话号 / 工作目录取出来
  let session = null
  if (sessionId) {
    session = store.getAgentSession(sessionId)
  } else {
    session = store.ensureAgentSession(nodeId, { agent, runtimeId: runtime.id, workDir: dir || null }, by)
  }
  const effectiveCwd = dir || session.workDir || null
  const cliSessionId = resume ? session.cliSessionId : null

  if (ideMode) {
    // 前台（Qoder IDE）模式：只创建任务记录，不 spawn；由 IDE 会话执行，完成后经 MCP/HTTP 回写
    const run = store.createAgentRun(
      nodeId,
      {
        agent: agent === DEFAULT_AGENT ? 'qoder-ide' : agent,
        model,
        prompt,
        cwd: effectiveCwd,
        sessionId: session.id,
        runtimeId: runtime.id,
        resumed: !!cliSessionId
      },
      by
    )
    store.appendAgentRunMessage(run.id, {
      type: 'text',
      content: `[task-board] 已派单到 Qoder IDE（前台执行）——完成后由 agent_run_update 回写结果`
    })
    return store.getAgentRun(run.id)
  }
  if (!effectiveCwd) {
    throw new AppError(
      CODES.VALIDATION_FAILED,
      '无法确定运行目录：该节点子树内没有登记过带本地路径的仓库（先 repo add 或显式指定 cwd）',
      {}
    )
  }
  if (!fs.existsSync(effectiveCwd)) {
    throw new AppError(CODES.VALIDATION_FAILED, `运行目录不存在：${effectiveCwd}`, { cwd: effectiveCwd })
  }

  const run = store.createAgentRun(
    nodeId,
    {
      agent,
      model,
      prompt,
      cwd: effectiveCwd,
      sessionId: session.id,
      runtimeId: runtime.id,
      resumed: !!cliSessionId
    },
    by
  )
  store.appendAgentRunMessage(run.id, {
    type: 'text',
    content: `[task-board] 启动 ${agent}（model=${model}，cwd=${effectiveCwd}${cliSessionId ? `，resume=${cliSessionId}` : ''}）`
  })
  spawnRun(store, { ...run, cliSessionId }, effectiveCwd)
  return run
}

/**
 * 为一条已存在的任务记录拉起子进程（派单与重试共用）。
 * 调用方负责确保 run.status 仍是 running、cwd 已就绪。
 */
export function spawnRun(store, run, cwd) {
  const { cmd, args } = buildCommand(run)

  let child
  try {
    child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ''}` },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    appendMessage(store, run.id, 'error', `[task-board] 启动失败：${e.message}\n`)
    store.finishAgentRun(run.id, { status: 'failed', failureReason: 'agent_error.spawn_failed' })
    return null
  }

  child.stdout.on('data', (chunk) => appendChunk(store, run.id, chunk))
  child.stderr.on('data', (chunk) => appendChunk(store, run.id, chunk, 'error'))

  const timer = setTimeout(() => {
    appendMessage(store, run.id, 'error', `\n[task-board] 执行超时（${TIMEOUT_MS / 60000} 分钟），已终止\n`)
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
    safeFinish(store, run.id, { status: 'timeout', failureReason: 'timeout' })
  }, TIMEOUT_MS)

  child.on('error', (e) => {
    clearTimeout(timer)
    appendMessage(store, run.id, 'error', `\n[task-board] 启动错误：${e.message}\n`)
    safeFinish(store, run.id, { status: 'failed', failureReason: 'agent_error.spawn_failed' })
  })

  // 取消：外部调 cancelAgentRun 把 status 置 cancelled 后，这里负责真正杀掉子进程
  const cancelWatch = setInterval(() => {
    try {
      const cur = store.getAgentRun(run.id)
      if (cur.status === 'cancelled') {
        clearInterval(cancelWatch)
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    } catch {
      clearInterval(cancelWatch)
    }
  }, 2000)

  child.on('close', (code) => {
    clearTimeout(timer)
    clearInterval(cancelWatch)
    safeFinish(store, run.id, {
      status: code === 0 ? 'success' : 'failed',
      exitCode: code,
      failureReason: code === 0 ? null : 'agent_error.nonzero_exit'
    })
  })

  return child
}

/**
 * 重试一条已结束的任务：存储层建 attempt+1 的子任务后，后台任务立刻拉起子进程；
 * 前台（qoder-ide）任务只建记录，等 IDE 回写。
 */
export function retryAndDispatch(store, runId, by = 'user') {
  const child = store.retryAgentRun(runId, { by })
  if (child.agent === 'qoder-ide') {
    store.appendAgentRunMessage(child.id, {
      type: 'text',
      content: '[task-board] 已重建前台任务——请重新派给 Qoder IDE'
    })
    return child
  }
  const dir = child.cwd || child.workDir
  if (!dir || !fs.existsSync(dir)) {
    appendMessage(store, child.id, 'error', `[task-board] 重试失败：运行目录不可用（${dir || '未指定'}）\n`)
    return store.finishAgentRun(child.id, { status: 'failed', failureReason: 'environment_prepare_failed' })
  }
  store.appendAgentRunMessage(child.id, {
    type: 'text',
    content: `[task-board] 重试任务 #${runId}（第 ${child.attempt} 次，cwd=${dir}）`
  })
  // 续跑同一段对话：会话里沉淀过 CLI 会话号时带上 --resume
  const cliSessionId = child.sessionId ? store.getAgentSession(child.sessionId).cliSessionId : null
  if (cliSessionId) {
    store.appendAgentRunMessage(child.id, { type: 'text', content: `[task-board] 续跑会话 ${cliSessionId}` })
  }
  spawnRun(store, { ...child, cliSessionId }, dir)
  return store.getAgentRun(child.id)
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

/**
 * 把一段子进程输出落进任务消息流。
 * 按换行切段，每段一条 text 消息——UI 因此能按 seq 增量拉取、逐条渲染，
 * 而不是每次把整个 output 字段重读一遍（对标 multica 的 task_message 流）。
 */
function appendChunk(store, runId, chunk, type = 'text') {
  const text = chunk.toString('utf8')
  try {
    store.appendAgentRunOutput(runId, text)
    const lines = text.split('\n')
    for (const line of lines) {
      if (line === '') continue
      store.appendAgentRunMessage(runId, { type, content: line })
    }
  } catch {
    /* 消息流写入失败不影响主流程 */
  }
}

function appendMessage(store, runId, type, content) {
  try {
    store.appendAgentRunOutput(runId, content)
    store.appendAgentRunMessage(runId, { type, content })
  } catch {
    /* ignore */
  }
}
