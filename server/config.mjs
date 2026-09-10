import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard')

export const HOME_DIR = HOME
export const CONFIG_PATH = path.join(HOME, 'config.json')
export const DB_PATH = path.join(HOME, 'data.db')
export const UPLOAD_DIR = path.join(HOME, 'uploads')

export const DEFAULT_CONFIG = {
  port: 3210,
  gitlab: { base_url: '', token: '' },
  docPresets: {
    project: ['描述'],
    requirement: ['需求内容'],
    subreq: ['需求内容'],
    group: [],
    task: [],
    defect: ['描述', '复现步骤']
  },
  worktreeRoot: '',
  branchTemplate: '{base_branch}-{slug}',
  status: {
    labels: { todo: '待开始', doing: '进行中', testing: '提测中', done: '已完成', cancelled: '已取消' },
    allowed: {
      project: ['todo', 'doing', 'done'],
      requirement: ['todo', 'doing', 'testing', 'done', 'cancelled'],
      subreq: ['todo', 'doing', 'done'],
      group: ['todo', 'doing', 'done'],
      task: ['todo', 'doing', 'done'],
      defect: ['todo', 'doing', 'done', 'cancelled']
    }
  }
}

function deepMerge(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(base[k] || {}, v)
    else out[k] = v
  }
  return out
}

export function loadConfig() {
  fs.mkdirSync(HOME, { recursive: true })
  if (!fs.existsSync(CONFIG_PATH)) {
    writeConfig(DEFAULT_CONFIG)
    return structuredClone(DEFAULT_CONFIG)
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return deepMerge(DEFAULT_CONFIG, raw)
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(CONFIG_PATH, 0o600)
}

export function saveConfig(patch) {
  const cfg = deepMerge(loadConfig(), patch || {})
  writeConfig(cfg)
  return cfg
}

export function maskToken(cfg) {
  const token = cfg.gitlab && cfg.gitlab.token ? '****' : ''
  return { ...cfg, gitlab: { ...(cfg.gitlab || {}), token } }
}
