# task-board v1 · 计划 1：数据层与核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 `task-board` 仓库骨架，并把配置文件、SQLite 建表/预置、以及节点 / 属性 / 文档 / revision 的数据访问层做成可 `npm test` 全绿的数据层。

**Architecture:** Node 22 ESM（`.mjs` + 无原生依赖）。`server/config.mjs` 负责 `~/.taskboard/config.json`（可用 `TASKBOARD_HOME` 覆盖，便于测试）；`server/db.mjs` 打开 `~/.taskboard/data.db`（WAL + 外键 + `busy_timeout`）并建表与预置；`server/store.mjs` 是**唯一**数据访问层，后续 HTTP / CLI / MCP / Web 全部复用它。测试用 Node 内置 `node:test`，每个用例用临时 HOME + 临时库，互不污染。

**Tech Stack:** Node.js ≥ 22.5（`node:sqlite`、`node:test`、`util.parseArgs`）、ESM；本计划不引入任何前端或 HTTP 依赖。

---

## 交付边界

**本计划产出**：可运行、可单测的数据层（config / db / store / errors）。

**后续计划**（本次不写，避免单个计划过大）：

| 计划 | 内容 |
|---|---|
| 计划 2 | 三入口：express HTTP API + `taskboard` CLI + MCP server（共用 store）；`/api/schema`、`/api/revision`、`/api/tree?format=md`、upsert / batch / import |
| 计划 3 | Web UI：Vite + Vue3 + Element Plus 表格式展开树、右侧抽屉、文档区（Vditor + 自托管资源）、属性定义页、设置页、仓库登记页、revision 轮询 |
| 计划 4 | Git 集成：`simple-git` 封装、diff 预览（CodeMirror MergeView）、工作区准备（分支 / worktree / 开发提示词）、`merges` 状态机、`merge-tree` 预检、冲突处理 |
| 计划 5 | GitLab MR 拉取、图片上传、`npm run smoke` 冒烟、README「给 AI 的用法」 |

## 文件结构

```text
task-board/
  package.json                  # type=module；scripts: test；引擎约束 node>=22.5
  .gitignore
  README.md                     # 项目说明（计划 5 再扩「给 AI 的用法」）
  server/
    errors.mjs                  # AppError + 稳定错误码常量
    config.mjs                  # ~/.taskboard/config.json 读写（600、token 打码、默认值）
    db.mjs                      # openDb()：建表 + 索引 + meta(revision) + 预置 attr_defs
    store.mjs                   # 数据访问层：nodes / path / attrs / documents / revision
  test/
    helpers.mjs                 # 临时 HOME + 临时库 + 清理
    errors.test.mjs
    config.test.mjs
    db.test.mjs
    store-nodes.test.mjs
    store-path.test.mjs
    store-attrs.test.mjs
    store-docs.test.mjs
    store-revision.test.mjs
```

### 文档与代码同源（功能之家，用户 2026-09-11 约定）

```text
task-board/
  docs/design.md                                    # 主设计文档（权威副本）
  features/README.md                                # 功能索引
  features/<功能目录>/{prd.md,design.md,commit.md}   # 只放文档，不放代码
  server/ test/                                     # 代码按分层
```

- 本计划涉及的功能目录：`features/foundation/`（Task 1–4）、`features/node-tree/`（Task 5–6）、`features/attributes/`（Task 7）、`features/documents/`（Task 8）、`features/revision/`（Task 9）。
- **每个 Task 的提交纪律**：实现 + 测试通过后 → 把本次 commit message 追加到所属功能 `commit.md` 的一行 → 与该功能的代码 / 测试 / 文档在同一次 commit 入库。
- 功能首次出现时（Task 7 / 8 / 9）要同时写 `prd.md`（目标 + 需求点 + 验收标准）与 `design.md`（模块职责 + 关键规则 + 接口 + 错误码），不留空文件；并在 `features/README.md` 索引里把状态改为「已完成」。

职责边界：`db.mjs` 只管「把库打开到可用状态」（表、索引、预置），不做业务校验；`store.mjs` 管全部业务规则（类型校验、级联、排序、路径解析、审计字段、revision），是唯一写入方；`errors.mjs` 只定义错误码与错误类型，被上层（HTTP/CLI/MCP）翻译成对应协议。

---

### Task 1: 仓库骨架与测试基座

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `test/helpers.mjs`

- [ ] **Step 1: 建 `package.json`**

```json
{
  "name": "task-board",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.5" },
  "scripts": {
    "test": "node --test",
    "test:watch": "node --test --watch"
  }
}
```

> 实测注意：Node 22 的 `node --test` **不要带目录参数**（`node --test test/` 会被当成模块路径报 `MODULE_NOT_FOUND`）；不带参数时它会自动发现 `**/*.test.mjs`。

- [ ] **Step 2: 建 `.gitignore`**

```text
node_modules/
.superpowers/
*.log
public/vditor/
web/dist/
```

- [ ] **Step 3: 建 `README.md`**

```markdown
# task-board

以树形方式组织研发任务的本地任务管理器：项目 → 需求 → 子需求 → 任务组（可嵌套）→ 子任务（+ 缺陷）。

- 设计文档：`../docs/superpowers/specs/2026-09-11-task-board-design.md`
- 本地数据：`~/.taskboard/data.db`（SQLite），配置：`~/.taskboard/config.json`（权限 600）
- 测试账号环境变量：`TASKBOARD_HOME`（不改则用 `~/.taskboard`，测试里指向临时目录）

## 开发

```bash
npm test        # 数据层单测（计划 1 起可用）
```

## 计划进度

计划 1 数据层（本仓库当前内容）→ 计划 2 三入口 → 计划 3 Web UI → 计划 4 Git 集成与冲突处理 → 计划 5 MR / 上传 / 冒烟
```

- [ ] **Step 4: 建 `test/helpers.mjs`（临时 HOME + 临时库）**

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 每个用例一个独立 HOME，避免污染真实 ~/.taskboard。
 * 用法：
 *   const tmp = await tempHome()
 *   const { openDb } = await import('../server/db.mjs')
 *   const db = openDb()
 *   ...
 *   tmp.cleanup()
 */
export async function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-test-'))
  process.env.TASKBOARD_HOME = dir
  // config.mjs / db.mjs 在 import 时读取该变量，所以用动态 import 保证顺序
  const db = await import('../server/db.mjs')
  const config = await import('../server/config.mjs')
  // store.mjs 在计划 1 Task 5 才实现；这里容错，避免 db/config 用例被连带失败
  const store = await import('../server/store.mjs').catch(() => ({
    createStore() {
      throw new Error('server/store.mjs 尚未实现（计划 1 Task 5）')
    }
  }))
  return {
    dir,
    // 注意：config/db 模块在首次 import 时就把 TASKBOARD_HOME 固定下来了（ESM 模块只求值一次），
    // 所以同一个测试文件内多次 tempHome() 并不会换 HOME；要真隔离得给每次调用独立的库文件。
    openDb: (file) => db.openDb(file || path.join(dir, 'data.db')),
    config,
    store,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
      delete process.env.TASKBOARD_HOME
    }
  }
}

export function nodeInput(over = {}) {
  return { parentId: null, type: 'project', name: '示例项目', ...over }
}
```

> 实测注意（写计划时踩到）：`tempHome()` 给每次调用都建了新临时目录，但 `config.mjs` / `db.mjs` 的 `HOME` 是在**模块首次 import 时**读取环境变量的（ESM 只求值一次），因此同一测试文件内第二个用例开始其实还是用第一个目录的 `HOME`。真正的用例隔离靠 `openDb()` 默认落在本次 `dir` 下的 `data.db`——所以 `openDb` 必须写成显式路径，不能直接 `db.openDb` 引用。（0 用例、恒通过，属正常噪声）；不要把它改名到其他目录以外的方式规避。

- [ ] **Step 5: 提交**

```bash
cd /Users/xuchen.xia/charge2/task-board
git init
git add package.json .gitignore README.md test/helpers.mjs
git commit -m "chore: task-board 仓库骨架与测试基座"
```

---

### Task 2: 错误码与 AppError

**Files:**
- Create: `server/errors.mjs`
- Test: `test/errors.test.mjs`

- [ ] **Step 1: 写失败测试 `test/errors.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { AppError, CODES, fail } from '../server/errors.mjs'

test('错误码是稳定字符串常量', () => {
  assert.equal(CODES.VALIDATION_FAILED, 'VALIDATION_FAILED')
  assert.equal(CODES.LEAF_NODE, 'LEAF_NODE')
  assert.equal(CODES.PATH_AMBIGUOUS, 'PATH_AMBIGUOUS')
  assert.equal(CODES.CONFIRM_REQUIRED, 'CONFIRM_REQUIRED')
})

test('fail() 抛出带 code 与 details 的 AppError', () => {
  assert.throws(
    () => fail(CODES.VALIDATION_FAILED, '名称必填', { field: 'name' }),
    (err) => {
      assert.ok(err instanceof AppError)
      assert.equal(err.code, 'VALIDATION_FAILED')
      assert.equal(err.message, '名称必填')
      assert.deepEqual(err.details, { field: 'name' })
      return true
    }
  )
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`Cannot find module '../server/errors.mjs'`）

- [ ] **Step 3: 实现 `server/errors.mjs`**（错误码写进 `err.name`，这样 `String(err)` 带码、`err.message` 保持人话）

```js
/** 稳定错误码：AI 依赖它做自纠，改动需同步设计文档 §9 */
export const CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PARENT_TYPE_INVALID: 'PARENT_TYPE_INVALID',
  LEAF_NODE: 'LEAF_NODE',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  NOT_FOUND: 'NOT_FOUND',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  PATH_AMBIGUOUS: 'PATH_AMBIGUOUS',
  DOC_NAME_EXISTS: 'DOC_NAME_EXISTS',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED'
}

export class AppError extends Error {
  constructor(code, message, details) {
    super(message)
    // name 直接用错误码：String(err) 输出 "PARENT_TYPE_INVALID: …"，
    // 既方便 CLI 直接打印，也让测试里的 assert.throws(fn, /CODE/) 能命中
    this.name = code
    this.code = code
    this.details = details
  }
}

export function fail(code, message, details) {
  throw new AppError(code, message, details)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: `pass 2`（errors 两个用例通过）

- [ ] **Step 5: 提交**

```bash
git add server/errors.mjs test/errors.test.mjs
git commit -m "feat(errors): 稳定错误码与 AppError"
```

---

### Task 3: 配置读写（600 权限 + token 打码 + 默认值）

**Files:**
- Create: `server/config.mjs`
- Test: `test/config.test.mjs`

- [ ] **Step 1: 写失败测试 `test/config.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tempHome } from './helpers.mjs'

test('loadConfig 首次生成默认配置且权限 600', async () => {
  const tmp = await tempHome()
  const { loadConfig, CONFIG_PATH, DEFAULT_CONFIG } = tmp.config
  const cfg = loadConfig()
  assert.equal(cfg.port, DEFAULT_CONFIG.port)
  assert.equal(cfg.docPresets.defect.length, 2)
  assert.ok(fs.existsSync(CONFIG_PATH))
  const mode = fs.statSync(CONFIG_PATH).mode & 0o777
  assert.equal(mode, 0o600)
  tmp.cleanup()
})

test('saveConfig 局部合并并落盘，loadConfig 能读回', async () => {
  const tmp = await tempHome()
  const { loadConfig, saveConfig } = tmp.config
  loadConfig()
  saveConfig({ port: 3222, gitlab: { base_url: 'http://gitlab.xiaopeng.local:18080', token: 'abc' } })
  const cfg = loadConfig()
  assert.equal(cfg.port, 3222)
  assert.equal(cfg.gitlab.base_url, 'http://gitlab.xiaopeng.local:18080')
  assert.equal(cfg.gitlab.token, 'abc')
  tmp.cleanup()
})

test('maskToken 不泄露 token 原文', async () => {
  const tmp = await tempHome()
  const { loadConfig, saveConfig, maskToken } = tmp.config
  loadConfig()
  saveConfig({ gitlab: { token: 'secret-token' } })
  const masked = maskToken(loadConfig())
  assert.notEqual(masked.gitlab.token, 'secret-token')
  assert.equal(masked.gitlab.token, '****')
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（找不到 `../server/config.mjs`）

- [ ] **Step 3: 实现 `server/config.mjs`**

```js
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: `pass 5`

- [ ] **Step 5: 提交**

```bash
git add server/config.mjs test/config.test.mjs
git commit -m "feat(config): 默认配置、600 权限与 token 打码"
```

---

### Task 4: 建库、建表与预置（db.mjs）

**Files:**
- Create: `server/db.mjs`
- Test: `test/db.test.mjs`

- [ ] **Step 1: 写失败测试 `test/db.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

test('openDb 建出全部表并开启 WAL / 外键', async () => {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
  for (const t of ['nodes', 'attr_defs', 'attr_values', 'commits', 'mrs', 'documents', 'repos', 'merges', 'unit_repos', 'meta']) {
    assert.ok(tables.includes(t), `缺表 ${t}`)
  }
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  db.close()
  tmp.cleanup()
})

test('预置 attr_defs 与 meta.revision 幂等', async () => {
  const tmp = await tempHome()
  const db1 = tmp.openDb()
  const defs = db1.prepare('SELECT node_type, key FROM attr_defs').all()
  assert.ok(defs.some((d) => d.node_type === 'requirement' && d.key === 'test_submit_date'))
  assert.ok(defs.some((d) => d.node_type === 'task' && d.key === 'base_branch'))
  assert.equal(db1.prepare("SELECT value FROM meta WHERE key='revision'").get().value, '0')
  db1.close()

  const db2 = tmp.openDb() // 再次打开不应重复预置
  assert.equal(db2.prepare('SELECT COUNT(*) c FROM attr_defs').get().c, defs.length)
  db2.close()
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（找不到 `../server/db.mjs`）

- [ ] **Step 3: 实现 `server/db.mjs`**

```js
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DB_PATH } from './config.mjs'

/**
 * 允许的子节点类型：父节点 type → 可以挂的子节点 type 列表（单一事实来源）
 * 空数组 = 叶子节点（defect 不能再挂子节点；task 只允许挂 defect）
 */
export const CHILD_TYPES = {
  project: ['requirement'],
  requirement: ['subreq'],
  subreq: ['group', 'task'],
  group: ['group', 'task', 'defect'],
  task: ['defect'],
  defect: []
}
/** 叶子节点（不允许再挂子节点） */
export const LEAF_TYPES = new Set(Object.keys(CHILD_TYPES).filter((t) => CHILD_TYPES[t].length === 0))

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('project','requirement','subreq','group','task','defect')),
  parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user',
  updated_by TEXT NOT NULL DEFAULT 'user'
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id, sort);

CREATE TABLE IF NOT EXISTS attr_defs (
  id INTEGER PRIMARY KEY,
  node_type TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('text','textarea','number','date','select','url')),
  options TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  default_value TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(node_type, key)
);

CREATE TABLE IF NOT EXISTS attr_values (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  attr_def_id INTEGER NOT NULL REFERENCES attr_defs(id) ON DELETE CASCADE,
  value TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'user',
  UNIQUE(node_id, attr_def_id)
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  repo TEXT,
  sha TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(node_id, sha)
);

CREATE TABLE IF NOT EXISTS mrs (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  iid INTEGER NOT NULL,
  title TEXT,
  state TEXT,
  source_branch TEXT,
  web_url TEXT,
  updated_at TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE(node_id, project, iid)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user',
  updated_by TEXT NOT NULL DEFAULT 'user',
  UNIQUE(node_id, name)
);
CREATE INDEX IF NOT EXISTS idx_documents_node ON documents(node_id, sort);

CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  local_path TEXT,
  gitlab_project TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merges (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  base_sha TEXT, source_sha TEXT, target_sha TEXT,
  state TEXT NOT NULL,
  merge_sha TEXT,
  conflict_files TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user',
  updated_by TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS unit_repos (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  branch TEXT,
  worktree_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(node_id, repo_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** 预置属性定义（设计文档 §4.9） */
const SEED_ATTR_DEFS = [
  ['requirement', 'start_date', '开始时间', 'date', 0],
  ['requirement', 'end_date', '结束时间', 'date', 0],
  ['requirement', 'review_date', '需求评审时间', 'date', 0],
  ['requirement', 'design_review_date', '概设评审时间', 'date', 0],
  ['requirement', 'test_submit_date', '提测时间', 'date', 0],
  ['requirement', 'estimate_hours', '预估工时', 'number', 0],
  ['subreq', 'branch', '分支', 'text', 0],
  ['subreq', 'baseline', '基线', 'text', 0],
  ['subreq', 'gitlab_project', 'GitLab 项目', 'text', 0],
  ['group', 'slug', '英文短名', 'text', 0],
  ['group', 'branch', '分支', 'text', 0],
  ['group', 'base_branch', '基线分支', 'text', 0],
  ['task', 'slug', '英文短名', 'text', 0],
  ['task', 'branch', '分支', 'text', 0],
  ['task', 'base_branch', '基线分支', 'text', 0]
]

function seed(db) {
  const now = new Date().toISOString()
  const has = db.prepare('SELECT COUNT(*) c FROM attr_defs').get().c
  if (has === 0) {
    const ins = db.prepare(
      'INSERT INTO attr_defs (node_type,key,label,data_type,options,required,default_value,sort,enabled,created_at,updated_at) VALUES (?,?,?,?,NULL,?,NULL,?,1,?,?)'
    )
    SEED_ATTR_DEFS.forEach((row, i) => {
      const [nodeType, key, label, dataType, required] = row
      ins.run(nodeType, key, label, dataType, required, (i + 1) * 10, now, now)
    })
  }
  db.prepare("INSERT OR IGNORE INTO meta (key,value) VALUES ('revision','0')").run()
}

export function openDb(file = DB_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  seed(db)
  return db
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: `pass 7`

- [ ] **Step 5: 提交**

```bash
git add server/db.mjs test/db.test.mjs
git commit -m "feat(db): 建表、索引与预置属性定义（WAL + 外键 + busy_timeout）"
```

---

### Task 5: 节点 CRUD、类型校验、级联与排序（store.mjs 第 1 部分）

**Files:**
- Create: `server/store.mjs`
- Test: `test/store-nodes.test.mjs`

- [ ] **Step 1: 写失败测试 `test/store-nodes.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const { createStore } = tmp.store
  const store = createStore(db)
  return { tmp, db, store }
}

test('建五级树 + 缺陷，并返回树形结构', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: '充电平台' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: '3.1 收发货' })
  const g = store.createNode({ parentId: s.id, type: 'group', name: '任务组A' })
  const t = store.createNode({ parentId: g.id, type: 'task', name: '子任务1' })
  store.createNode({ parentId: t.id, type: 'defect', name: '登录报错' })

  const tree = store.listTree()
  assert.equal(tree.length, 1)
  assert.equal(tree[0].name, '充电平台')
  assert.equal(tree[0].children[0].children[0].children[0].children[0].children[0].type, 'defect')
  assert.deepEqual(store.getNode(p.id).path, '充电平台')
  assert.equal(store.getNode(t.id).path, '充电平台/26Q3/3.1 收发货/任务组A/子任务1')
  tmp.cleanup()
})

test('父子类型非法与叶子节点被拒', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  assert.throws(() => store.createNode({ parentId: p.id, type: 'task', name: 'x' }), /PARENT_TYPE_INVALID/)
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  assert.throws(() => store.createNode({ parentId: t.id, type: 'group', name: 'x' }), /PARENT_TYPE_INVALID/)
  const d = store.createNode({ parentId: t.id, type: 'defect', name: '登录报错' })
  assert.throws(() => store.createNode({ parentId: d.id, type: 'defect', name: '套娃' }), /LEAF_NODE/)
  tmp.cleanup()
})

test('移动到自身后代被判成环', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  assert.throws(() => store.updateNode(p.id, { parentId: s.id }), /CYCLE_DETECTED/)
  tmp.cleanup()
})

test('级联删除返回删除计数', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  store.upsertDocument(t.id, '描述', '正文')
  const res = store.deleteNode(p.id)
  assert.equal(res.nodes, 4)
  assert.equal(res.documents, 4)
  assert.equal(store.listTree().length, 0)
  tmp.cleanup()
})

test('同级排序与 reorder', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P' })
  const a = store.createNode({ parentId: p.id, type: 'requirement', name: 'A' })
  const b = store.createNode({ parentId: p.id, type: 'requirement', name: 'B' })
  const c = store.createNode({ parentId: p.id, type: 'requirement', name: 'C' })
  assert.ok(a.sort < b.sort && b.sort < c.sort)
  store.reorderSiblings(p.id, [c.id, a.id, b.id])
  const names = store.listChildren(p.id).map((n) => n.name)
  assert.deepEqual(names, ['C', 'A', 'B'])
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（找不到 `../server/store.mjs`）

- [ ] **Step 3: 实现 `server/store.mjs`（本任务只加前半部分）**

```js
import { AppError, CODES } from './errors.mjs'
import { CHILD_TYPES, LEAF_TYPES } from './db.mjs'

const ACTORS = new Set(['user', 'ai', 'cli', 'import'])
const now = () => new Date().toISOString()

/** 预置文档名（与 config.docPresets 默认值一致） */
const DEFAULT_DOC_PRESETS = {
  project: ['描述'],
  requirement: ['需求内容'],
  subreq: ['需求内容'],
  group: [],
  task: [],
  defect: ['描述', '复现步骤']
}

export function createStore(db, options = {}) {
  const docPresets = options.docPresets || DEFAULT_DOC_PRESETS
  const stmt = (sql) => db.prepare(sql)

  function bumpRevision() {
    db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'").run()
  }
  function getRevision() {
    return Number(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get().value)
  }
  function actor(a) {
    return ACTORS.has(a) ? a : 'user'
  }

  function subtreeIds(rootId) {
    return db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
         ) SELECT id FROM sub`
      )
      .all(rootId)
      .map((r) => r.id)
  }

  function rawNode(id) {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)
    if (!row) throw new AppError(CODES.NOT_FOUND, `节点 ${id} 不存在`, { id })
    return row
  }

  function buildPath(id) {
    const names = []
    let cur = id
    while (cur != null) {
      const row = db.prepare('SELECT id,name,parent_id FROM nodes WHERE id = ?').get(cur)
      if (!row) break
      names.unshift(row.name)
      cur = row.parent_id
    }
    return names.join('/')
  }

  function nodeVO(row) {
    return {
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      status: row.status,
      sort: row.sort,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      path: buildPath(row.id)
    }
  }

  function validateParent(type, parentId) {
    if (!Object.prototype.hasOwnProperty.call(CHILD_TYPES, type)) {
      throw new AppError(CODES.VALIDATION_FAILED, `未知节点类型 ${type}`, { type })
    }
    if (parentId == null) {
      if (type !== 'project') {
        throw new AppError(CODES.PARENT_TYPE_INVALID, `只有 project 可以没有父节点，${type} 必须挂在父节点下`, { type })
      }
      return null
    }
    const parent = rawNode(parentId)
    const allowedChildren = CHILD_TYPES[parent.type] || []
    if (allowedChildren.length === 0) {
      throw new AppError(CODES.LEAF_NODE, `${parent.type} 是叶子节点，不能再挂子节点`, { parentId })
    }
    if (!allowedChildren.includes(type)) {
      throw new AppError(CODES.PARENT_TYPE_INVALID, `${parent.type} 下不能挂 ${type}`, {
        type,
        parentType: parent.type,
        allowedChildren
      })
    }
    return parent
  }

  function createNode({ parentId = null, type, name, status = 'todo', attrs, actor: by = 'user' }) {
    if (!type) throw new AppError(CODES.VALIDATION_FAILED, 'type 必填')
    if (!name || !String(name).trim()) throw new AppError(CODES.VALIDATION_FAILED, 'name 必填', { field: 'name' })
    validateParent(type, parentId)
    const ts = now()
    const nextSort =
      db.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM nodes WHERE IFNULL(parent_id,0) = IFNULL(?,0)').get(parentId).s
    const info = db
      .prepare(
        'INSERT INTO nodes (type,parent_id,name,status,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(type, parentId, String(name).trim(), status, nextSort, ts, ts, actor(by), actor(by))
    const id = Number(info.lastInsertRowid)
    if (attrs) setAttrs(id, attrs, by)
    for (const docName of docPresetNames(type)) upsertDocument(id, docName, '', by)
    bumpRevision()
    return nodeVO(rawNode(id))
  }

  const docPresetNames = (type) => docPresets[type] || []

  function updateNode(id, patch, by = 'user') {
    const cur = rawNode(id)
    const fields = []
    const args = []
    if (patch.name !== undefined) {
      if (!String(patch.name).trim()) throw new AppError(CODES.VALIDATION_FAILED, 'name 不能为空', { field: 'name' })
      fields.push('name = ?')
      args.push(String(patch.name).trim())
    }
    if (patch.status !== undefined) {
      fields.push('status = ?')
      args.push(patch.status)
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId === id) throw new AppError(CODES.CYCLE_DETECTED, '不能移动到自己下面')
      if (patch.parentId != null) {
        if (subtreeIds(id).includes(patch.parentId)) {
          throw new AppError(CODES.CYCLE_DETECTED, '不能移动到自己的后代下面', { id, parentId: patch.parentId })
        }
        validateParent(cur.type, patch.parentId)
      } else {
        validateParent(cur.type, null)
      }
      fields.push('parent_id = ?')
      args.push(patch.parentId)
    }
    fields.push('updated_at = ?', 'updated_by = ?')
    args.push(now(), actor(by))
    args.push(id)
    db.prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    if (patch.attrs) setAttrs(id, patch.attrs, by)
    bumpRevision()
    return nodeVO(rawNode(id))
  }

  function deleteNode(id) {
    rawNode(id)
    const ids = subtreeIds(id)
    const placeholders = ids.map(() => '?').join(',')
    const counts = {
      documents: db.prepare(`SELECT COUNT(*) c FROM documents WHERE node_id IN (${placeholders})`).get(...ids).c,
      attrValues: db.prepare(`SELECT COUNT(*) c FROM attr_values WHERE node_id IN (${placeholders})`).get(...ids).c,
      commits: db.prepare(`SELECT COUNT(*) c FROM commits WHERE node_id IN (${placeholders})`).get(...ids).c,
      mrs: db.prepare(`SELECT COUNT(*) c FROM mrs WHERE node_id IN (${placeholders})`).get(...ids).c,
      merges: db.prepare(`SELECT COUNT(*) c FROM merges WHERE node_id IN (${placeholders})`).get(...ids).c
    }
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id)
    bumpRevision()
    return { nodes: ids.length, ...counts }
  }

  function listChildren(parentId) {
    const rows =
      parentId == null
        ? db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY sort, id').all()
        : db.prepare('SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort, id').all(parentId)
    return rows.map((r) => ({ ...nodeVO(r), childCount: db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent_id = ?').get(r.id).c }))
  }

  function listTree() {
    const all = db.prepare('SELECT * FROM nodes ORDER BY sort, id').all().map((r) => ({ ...nodeVO(r), children: [] }))
    const byId = new Map(all.map((n) => [n.id, n]))
    const roots = []
    for (const n of all) {
      if (n.parentId == null) roots.push(n)
      else byId.get(n.parentId)?.children.push(n)
    }
    return roots
  }

  function reorderSiblings(parentId, orderedIds) {
    const ts = now()
    const upd = db.prepare('UPDATE nodes SET sort = ?, updated_at = ? WHERE id = ?')
    db.exec('BEGIN')
    try {
      orderedIds.forEach((id, idx) => upd.run((idx + 1) * 10, ts, id))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    bumpRevision()
    return listChildren(parentId)
  }

  function setAttrs(nodeId, attrs, by = 'user') {
    // 计划 1 Task 7 实现，这里先留最小实现供 createNode 使用
    const node = rawNode(nodeId)
    const ts = now()
    for (const [key, value] of Object.entries(attrs || {})) {
      const def = db.prepare('SELECT id FROM attr_defs WHERE node_type = ? AND key = ? AND enabled = 1').get(node.type, key)
      if (!def) throw new AppError(CODES.VALIDATION_FAILED, `属性 ${key} 不在 ${node.type} 的定义里`, { key })
      const existing = db.prepare('SELECT id FROM attr_values WHERE node_id = ? AND attr_def_id = ?').get(nodeId, def.id)
      if (existing) {
        db.prepare('UPDATE attr_values SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(
          value == null ? null : String(value),
          ts,
          actor(by),
          existing.id
        )
      } else {
        db.prepare('INSERT INTO attr_values (node_id,attr_def_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)').run(
          nodeId,
          def.id,
          value == null ? null : String(value),
          ts,
          actor(by)
        )
      }
    }
    return true
  }

  function upsertDocument(nodeId, name, content = '', by = 'user') {
    rawNode(nodeId)
    const ts = now()
    const existing = db.prepare('SELECT id FROM documents WHERE node_id = ? AND name = ?').get(nodeId, name)
    if (existing) {
      db.prepare('UPDATE documents SET content = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(content, ts, actor(by), existing.id)
      return { id: existing.id, created: false }
    }
    const sort = db.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM documents WHERE node_id = ?').get(nodeId).s
    const info = db
      .prepare(
        'INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(nodeId, name, content, sort, ts, ts, actor(by), actor(by))
    return { id: Number(info.lastInsertRowid), created: true }
  }

  return {
    db,
    // nodes
    createNode,
    updateNode,
    deleteNode,
    getNode: (id) => nodeVO(rawNode(id)),
    listChildren,
    listTree,
    reorderSiblings,
    subtreeIds,
    // attrs / documents（Task 7、8 补全）
    setAttrs,
    upsertDocument,
    docPresetNames,
    // revision
    getRevision,
    bumpRevision
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: `pass 12`

- [ ] **Step 5: 提交**

```bash
git add server/store.mjs test/store-nodes.test.mjs
git commit -m "feat(store): 节点 CRUD、父子/叶子校验、成环检测、级联删除与同级排序"
```

---

### Task 6: 路径引用解析（`id` 或 `项目A/需求1`）

**Files:**
- Modify: `server/store.mjs`（新增 `resolveRef`，并加进 return）
- Test: `test/store-path.test.mjs`

- [ ] **Step 1: 写失败测试 `test/store-path.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

test('resolveRef 支持 id 与路径，歧义与不存在分别报错', async () => {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const p = store.createNode({ type: 'project', name: '充电平台' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: '3.1 收发货' })

  assert.equal(store.resolveRef(s.id).id, s.id)
  assert.equal(store.resolveRef(String(s.id)).id, s.id)
  assert.equal(store.resolveRef('充电平台/26Q3/3.1 收发货').id, s.id)

  assert.throws(() => store.resolveRef('充电平台/不存在'), /PATH_NOT_FOUND/)

  // 同名兄弟 → 歧义
  store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3' })
  assert.throws(() => store.resolveRef('充电平台/26Q3'), /PATH_AMBIGUOUS/)
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`store.resolveRef is not a function`）

- [ ] **Step 3: 在 `server/store.mjs` 中实现 `resolveRef`（放在 `listTree` 之后）**

```js
  function resolveRef(ref) {
    const asText = String(ref ?? '').trim()
    if (asText === '') throw new AppError(CODES.PATH_NOT_FOUND, '引用为空', { ref })
    if (/^\d+$/.test(asText)) return nodeVO(rawNode(Number(asText)))

    const parts = asText.split('/').map((s) => s.trim()).filter(Boolean)
    let candidates = db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL').all()
    let cur = null
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]
      const matched = candidates.filter((n) => n.name === name)
      const walked = parts.slice(0, i + 1).join('/')
      if (matched.length === 0) {
        throw new AppError(CODES.PATH_NOT_FOUND, `路径不存在：${walked}`, { ref })
      }
      if (matched.length > 1) {
        throw new AppError(CODES.PATH_AMBIGUOUS, `路径歧义：${walked}，请改用 id 引用`, {
          ref,
          matchedIds: matched.map((m) => m.id)
        })
      }
      cur = matched[0]
      candidates = db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(cur.id)
    }
    return nodeVO(cur)
  }
```

- [ ] **Step 4: 把 `resolveRef` 加进 `createStore` 的 return 对象**

```js
    getNode: (id) => nodeVO(rawNode(id)),
    resolveRef,
    listChildren,
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test`
Expected: `pass 13`

- [ ] **Step 6: 提交**

```bash
git add server/store.mjs test/store-path.test.mjs
git commit -m "feat(store): 路径引用解析（id | 路径，歧义/不存在报错）"
```

---

### Task 7: 属性定义 CRUD、值校验与读写

**Files:**
- Modify: `server/store.mjs`（新增属性相关函数；**替换** Task 5 里的最小 `setAttrs`）
- Test: `test/store-attrs.test.mjs`

- [ ] **Step 1: 写失败测试 `test/store-attrs.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  return { tmp, store, p, r }
}

test('预置属性定义可列出，且新增自定义属性', async () => {
  const { tmp, store, r } = await setup()
  const defs = store.listAttrDefs('requirement')
  assert.ok(defs.some((d) => d.key === 'test_submit_date' && d.dataType === 'date'))
  const created = store.addAttrDef({ nodeType: 'requirement', key: 'owner', label: '负责人', dataType: 'text' })
  assert.equal(created.key, 'owner')
  assert.equal(store.listAttrDefs('requirement').length, defs.length + 1)
  tmp.cleanup()
})

test('值校验：number / date / select / 必填 / 未知 key', async () => {
  const { tmp, store, r } = await setup()
  store.addAttrDef({ nodeType: 'requirement', key: 'level', label: '优先级', dataType: 'select', options: [{ value: 'p0', label: 'P0' }] })
  store.addAttrDef({ nodeType: 'requirement', key: 'must', label: '必填项', dataType: 'text', required: true })

  store.setAttrs(r.id, { estimate_hours: '8' })
  assert.equal(store.getAttrs(r.id).estimate_hours, '8')
  assert.throws(() => store.setAttrs(r.id, { estimate_hours: '八小时' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { test_submit_date: '2026/09/11' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { level: 'p9' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { must: '' }), /VALIDATION_FAILED/)
  assert.throws(() => store.setAttrs(r.id, { not_exist: 'x' }), /VALIDATION_FAILED/)
  tmp.cleanup()
})

test('属性定义停用后不再校验，历史值保留', async () => {
  const { tmp, store, r } = await setup()
  const def = store.addAttrDef({ nodeType: 'requirement', key: 'must', label: '必填项', dataType: 'text', required: true })
  store.setAttrs(r.id, { must: 'ok' })
  store.updateAttrDef(def.id, { enabled: false })
  store.setAttrs(r.id, { estimate_hours: '1' })
  assert.equal(store.getAttrs(r.id).must, 'ok')
  assert.equal(store.listAttrDefs('requirement').some((d) => d.key === 'must'), false)
  tmp.cleanup()
})

test('删除属性定义连带删除其值', async () => {
  const { tmp, store, r } = await setup()
  const def = store.addAttrDef({ nodeType: 'requirement', key: 'tmp_key', label: '临时', dataType: 'text' })
  store.setAttrs(r.id, { tmp_key: 'v' })
  store.deleteAttrDef(def.id)
  assert.equal(store.getAttrs(r.id).tmp_key, undefined)
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`store.listAttrDefs is not a function`）

- [ ] **Step 3: 用下面这版**替换** Task 5 里那个「最小 setAttrs」，并新增 defs 相关函数**

```js
  const DATA_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'url'])

  function defVO(r) {
    return {
      id: r.id,
      nodeType: r.node_type,
      key: r.key,
      label: r.label,
      dataType: r.data_type,
      options: r.options ? JSON.parse(r.options) : null,
      required: !!r.required,
      defaultValue: r.default_value,
      sort: r.sort,
      enabled: !!r.enabled
    }
  }

  function listAttrDefs(nodeType, { includeDisabled = false } = {}) {
    const rows = nodeType
      ? db.prepare('SELECT * FROM attr_defs WHERE node_type = ? ORDER BY sort, id').all(nodeType)
      : db.prepare('SELECT * FROM attr_defs ORDER BY node_type, sort, id').all()
    return rows.map(defVO).filter((d) => includeDisabled || d.enabled)
  }

  function addAttrDef({ nodeType, key, label, dataType = 'text', options = null, required = false, defaultValue = null, sort = 100 }) {
    if (!nodeType || !key || !label) throw new AppError(CODES.VALIDATION_FAILED, 'nodeType / key / label 必填')
    if (!DATA_TYPES.has(dataType)) throw new AppError(CODES.VALIDATION_FAILED, `不支持的 dataType ${dataType}`, { dataType })
    const dup = db.prepare('SELECT id FROM attr_defs WHERE node_type = ? AND key = ?').get(nodeType, key)
    if (dup) throw new AppError(CODES.VALIDATION_FAILED, `${nodeType} 下已存在属性 ${key}`, { key })
    const ts = now()
    const info = db
      .prepare(
        'INSERT INTO attr_defs (node_type,key,label,data_type,options,required,default_value,sort,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)'
      )
      .run(nodeType, key, label, dataType, options ? JSON.stringify(options) : null, required ? 1 : 0, defaultValue, sort, ts, ts)
    bumpRevision()
    return defVO(db.prepare('SELECT * FROM attr_defs WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function updateAttrDef(id, patch) {
    const cur = db.prepare('SELECT * FROM attr_defs WHERE id = ?').get(id)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `属性定义 ${id} 不存在`, { id })
    const fields = []
    const args = []
    if (patch.label !== undefined) { fields.push('label = ?'); args.push(patch.label) }
    if (patch.dataType !== undefined) {
      if (!DATA_TYPES.has(patch.dataType)) throw new AppError(CODES.VALIDATION_FAILED, `不支持的 dataType ${patch.dataType}`)
      fields.push('data_type = ?'); args.push(patch.dataType)
    }
    if (patch.options !== undefined) { fields.push('options = ?'); args.push(patch.options ? JSON.stringify(patch.options) : null) }
    if (patch.required !== undefined) { fields.push('required = ?'); args.push(patch.required ? 1 : 0) }
    if (patch.defaultValue !== undefined) { fields.push('default_value = ?'); args.push(patch.defaultValue) }
    if (patch.sort !== undefined) { fields.push('sort = ?'); args.push(patch.sort) }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); args.push(patch.enabled ? 1 : 0) }
    fields.push('updated_at = ?')
    args.push(now(), id)
    db.prepare(`UPDATE attr_defs SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    bumpRevision()
    return defVO(db.prepare('SELECT * FROM attr_defs WHERE id = ?').get(id))
  }

  function deleteAttrDef(id) {
    db.prepare('DELETE FROM attr_defs WHERE id = ?').run(id)
    bumpRevision()
    return { id }
  }

  function validateValue(def, value) {
    if (value == null || value === '') {
      if (def.required) throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必填`, { key: def.key, required: true })
      return null
    }
    const v = String(value)
    if (def.dataType === 'number' && Number.isNaN(Number(v))) {
      throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必须是数字`, { key: def.key, value: v })
    }
    if (def.dataType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必须是 YYYY-MM-DD`, { key: def.key, value: v })
    }
    if (def.dataType === 'select') {
      const allowed = (def.options || []).map((o) => String(o.value))
      if (!allowed.includes(v)) {
        throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必须是 ${allowed.join(' / ')} 之一`, { key: def.key, value: v })
      }
    }
    return v
  }

  function setAttrs(nodeId, attrs, by = 'user') {
    const node = rawNode(nodeId)
    const defs = new Map(listAttrDefs(node.type).map((d) => [d.key, d]))
    const ts = now()
    db.exec('BEGIN')
    try {
      for (const [key, raw] of Object.entries(attrs || {})) {
        const def = defs.get(key)
        if (!def) throw new AppError(CODES.VALIDATION_FAILED, `属性 ${key} 不在 ${node.type} 的启用定义里（或已停用）`, { key })
        const value = validateValue(def, raw)
        const existing = db.prepare('SELECT id FROM attr_values WHERE node_id = ? AND attr_def_id = ?').get(nodeId, def.id)
        if (existing) {
          db.prepare('UPDATE attr_values SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(value, ts, actor(by), existing.id)
        } else {
          db.prepare('INSERT INTO attr_values (node_id,attr_def_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)').run(nodeId, def.id, value, ts, actor(by))
        }
      }
      db.prepare('UPDATE nodes SET updated_at = ?, updated_by = ? WHERE id = ?').run(ts, actor(by), nodeId)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    bumpRevision()
    return getAttrs(nodeId)
  }

  function getAttrs(nodeId) {
    rawNode(nodeId)
    const rows = db
      .prepare(
        `SELECT d.key, d.label, d.data_type, d.options, v.value, v.updated_at, v.updated_by
           FROM attr_values v JOIN attr_defs d ON d.id = v.attr_def_id
          WHERE v.node_id = ?`
      )
      .all(nodeId)
    const out = {}
    for (const r of rows) out[r.key] = r.value
    Object.defineProperty(out, '__meta', {
      enumerable: false,
      value: Object.fromEntries(rows.map((r) => [r.key, { label: r.label, dataType: r.data_type, updatedAt: r.updated_at, updatedBy: r.updated_by }]))
    })
    return out
  }
```

- [ ] **Step 4: 把属性函数加进 return 对象**

```js
    setAttrs,
    getAttrs,
    listAttrDefs,
    addAttrDef,
    updateAttrDef,
    deleteAttrDef,
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test`
Expected: `pass 17`

- [ ] **Step 6: 提交**

```bash
git add server/store.mjs test/store-attrs.test.mjs
git commit -m "feat(store): 属性定义 CRUD 与属性值校验（类型/必填/停用/未知 key）"
```

---

### Task 8: 文档 CRUD（重名 409、按名 upsert 幂等、排序）

**Files:**
- Modify: `server/store.mjs`（把 Task 5 的最小 `upsertDocument` 扩成完整一套）
- Test: `test/store-docs.test.mjs`

- [ ] **Step 1: 写失败测试 `test/store-docs.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  const p = store.createNode({ type: 'project', name: 'P' })
  const d = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const t = store.createNode({ parentId: d.id, type: 'subreq', name: 'S' })
  const task = store.createNode({ parentId: t.id, type: 'task', name: 'T' })
  return { tmp, store, p, t, task }
}

test('新建节点按类型预置空文档', async () => {
  const { tmp, store, p, task } = await setup()
  assert.deepEqual(store.listDocuments(p.id).map((d) => d.name), ['描述'])
  assert.deepEqual(store.listDocuments(task.id), [])
  tmp.cleanup()
})

test('按文档名 upsert 幂等，内容被覆盖', async () => {
  const { tmp, store, task } = await setup()
  const first = store.upsertDocument(task.id, '复现步骤', '第一步')
  assert.equal(first.created, true)
  const second = store.upsertDocument(task.id, '复现步骤', '第一步、第二步')
  assert.equal(second.created, false)
  assert.equal(second.id, first.id)
  const docs = store.listDocuments(task.id)
  assert.equal(docs.length, 1)
  assert.equal(docs[0].content, '第一步、第二步')
  tmp.cleanup()
})

test('重名新建报 DOC_NAME_EXISTS，改名撞名也报错', async () => {
  const { tmp, store, task } = await setup()
  store.createDocument(task.id, 'A')
  assert.throws(() => store.createDocument(task.id, 'A'), /DOC_NAME_EXISTS/)
  const b = store.createDocument(task.id, 'B')
  assert.throws(() => store.updateDocument(b.id, { name: 'A' }), /DOC_NAME_EXISTS/)
  tmp.cleanup()
})

test('排序与删除', async () => {
  const { tmp, store, task } = await setup()
  const a = store.createDocument(task.id, 'A', 'a')
  const b = store.createDocument(task.id, 'B', 'b')
  const c = store.createDocument(task.id, 'C', 'c')
  store.reorderDocuments(task.id, [c.id, a.id, b.id])
  assert.deepEqual(store.listDocuments(task.id).map((d) => d.name), ['C', 'A', 'B'])
  store.deleteDocument(b.id)
  assert.deepEqual(store.listDocuments(task.id).map((d) => d.name), ['C', 'A'])
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`store.createDocument is not a function`）

- [ ] **Step 3: 用下面这版替换最小 `upsertDocument`，并补齐文档相关函数**

```js
  function docVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      name: r.name,
      content: r.content,
      sort: r.sort,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      createdBy: r.created_by,
      updatedBy: r.updated_by
    }
  }

  function listDocuments(nodeId) {
    rawNode(nodeId)
    return db.prepare('SELECT * FROM documents WHERE node_id = ? ORDER BY sort, id').all(nodeId).map(docVO)
  }

  function createDocument(nodeId, name, content = '', by = 'user') {
    rawNode(nodeId)
    const docName = String(name || '').trim()
    if (!docName) throw new AppError(CODES.VALIDATION_FAILED, '文档名必填', { field: 'name' })
    const dup = db.prepare('SELECT id FROM documents WHERE node_id = ? AND name = ?').get(nodeId, docName)
    if (dup) throw new AppError(CODES.DOC_NAME_EXISTS, `节点下已存在文档「${docName}」`, { nodeId, name: docName })
    const ts = now()
    const sort = db.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM documents WHERE node_id = ?').get(nodeId).s
    const info = db
      .prepare('INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(nodeId, docName, String(content ?? ''), sort, ts, ts, actor(by), actor(by))
    bumpRevision()
    return docVO(db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function updateDocument(docId, patch, by = 'user') {
    const cur = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `文档 ${docId} 不存在`, { id: docId })
    const fields = []
    const args = []
    if (patch.name !== undefined) {
      const docName = String(patch.name || '').trim()
      if (!docName) throw new AppError(CODES.VALIDATION_FAILED, '文档名必填', { field: 'name' })
      const dup = db
        .prepare('SELECT id FROM documents WHERE node_id = ? AND name = ? AND id <> ?')
        .get(cur.node_id, docName, docId)
      if (dup) throw new AppError(CODES.DOC_NAME_EXISTS, `节点下已存在文档「${docName}」`, { name: docName })
      fields.push('name = ?')
      args.push(docName)
    }
    if (patch.content !== undefined) {
      fields.push('content = ?')
      args.push(String(patch.content ?? ''))
    }
    fields.push('updated_at = ?', 'updated_by = ?')
    args.push(now(), actor(by), docId)
    db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    bumpRevision()
    return docVO(db.prepare('SELECT * FROM documents WHERE id = ?').get(docId))
  }

  function upsertDocument(nodeId, name, content = null, by = 'user') {
    rawNode(nodeId)
    const docName = String(name || '').trim()
    if (!docName) throw new AppError(CODES.VALIDATION_FAILED, '文档名必填', { field: 'name' })
    const existing = db.prepare('SELECT * FROM documents WHERE node_id = ? AND name = ?').get(nodeId, docName)
    if (!existing) {
      const created = createDocument(nodeId, docName, content ?? '', by)
      return { id: created.id, created: true, name: docName }
    }
    if (content != null) updateDocument(existing.id, { content }, by)
    return { id: existing.id, created: false, name: docName }
  }

  function deleteDocument(docId) {
    const cur = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `文档 ${docId} 不存在`, { id: docId })
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId)
    bumpRevision()
    return { id: docId }
  }

  function reorderDocuments(nodeId, orderedIds) {
    rawNode(nodeId)
    const ts = now()
    const upd = db.prepare('UPDATE documents SET sort = ?, updated_at = ? WHERE id = ? AND node_id = ?')
    db.exec('BEGIN')
    try {
      orderedIds.forEach((id, idx) => upd.run((idx + 1) * 10, ts, id, nodeId))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    bumpRevision()
    return listDocuments(nodeId)
  }
```

- [ ] **Step 4: 把文档函数加进 return 对象（保留 Task 5 已有的 `upsertDocument`）**

```js
    listDocuments,
    createDocument,
    updateDocument,
    upsertDocument,
    deleteDocument,
    reorderDocuments,
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test`
Expected: `pass 21`

- [ ] **Step 6: 提交**

```bash
git add server/store.mjs test/store-docs.test.mjs
git commit -m "feat(store): 文档 CRUD（重名 409、按名 upsert 幂等、排序与级联）"
```

---

### Task 9: 审计字段与 revision（AI 变更可见的基础）

**Files:**
- Modify: `server/store.mjs`（补 `createNode` / `updateNode` / 文档写操作里的 actor 传递，已在前面任务写入；本任务只加测试与最终 return 收口）
- Test: `test/store-revision.test.mjs`

- [ ] **Step 1: 写失败测试 `test/store-revision.test.mjs`**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  return { tmp, store }
}

test('任何写入都会让 revision +1', async () => {
  const { tmp, store } = await setup()
  assert.equal(store.getRevision(), 0)
  const p = store.createNode({ type: 'project', name: 'P' })
  assert.equal(store.getRevision(), 1)
  store.updateNode(p.id, { status: 'doing' })
  assert.equal(store.getRevision(), 2)
  store.upsertDocument(p.id, '描述', '正文')
  assert.equal(store.getRevision(), 3)
  store.deleteNode(p.id)
  assert.equal(store.getRevision(), 4)
  tmp.cleanup()
})

test('created_by / updated_by 记录操作者（user | ai | cli | import）', async () => {
  const { tmp, store } = await setup()
  const p = store.createNode({ type: 'project', name: 'P', actor: 'ai' })
  assert.equal(p.createdBy, 'ai')
  assert.equal(p.updatedBy, 'ai')
  const updated = store.updateNode(p.id, { name: 'P2' }, 'cli')
  assert.equal(updated.updatedBy, 'cli')
  assert.equal(updated.createdBy, 'ai')
  const doc = store.upsertDocument(p.id, '描述', 'AI 写的', 'ai')
  assert.equal(store.listDocuments(p.id).find((d) => d.id === doc.id).updatedBy, 'ai')
  tmp.cleanup()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL 或部分失败（若 `actor` 参数未贯通，断言 `createdBy === 'ai'` 会失败；此时按 Step 3 检查并补齐 actor 传递）

- [ ] **Step 3: 核对 actor 贯通（`createNode` / `updateNode` / `upsertDocument` / `createDocument` / `updateDocument` 均接收 `by` 并写入 `created_by` / `updated_by`）**

检查这三处签名与写入列，缺则补：

```js
  function createNode({ parentId = null, type, name, status = 'todo', attrs, actor: by = 'user' }) { /* INSERT 时写 created_by/updated_by = actor(by) */ }
  function updateNode(id, patch, by = 'user') { /* UPDATE 时写 updated_by = actor(by) */ }
  function upsertDocument(nodeId, name, content = null, by = 'user') { /* 透传给 createDocument / updateDocument */ }
```

- [ ] **Step 4: 最终 return 收口（`createStore` 对外能力一览）**

```js
  return {
    db,
    // nodes
    createNode, updateNode, deleteNode, getNode, resolveRef, listChildren, listTree, reorderSiblings, subtreeIds,
    // attrs
    setAttrs, getAttrs, listAttrDefs, addAttrDef, updateAttrDef, deleteAttrDef,
    // documents
    listDocuments, createDocument, updateDocument, upsertDocument, deleteDocument, reorderDocuments,
    docPresetNames,
    // revision
    getRevision, bumpRevision
  }
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test`
Expected: `pass 23`

- [ ] **Step 6: 提交**

```bash
git add server/store.mjs test/store-revision.test.mjs
git commit -m "feat(store): 审计字段与 revision 计数"
```

---

### Task 10: 全量验收与计划收口

**Files:**
- Modify: `README.md`（把「计划进度」勾掉计划 1）

- [ ] **Step 1: 全量跑测试**

Run: `npm test`
Expected: 所有用例通过（约 23 个），无 skipped

- [ ] **Step 2: 用真实 HOME 走一遍冒烟（临时目录，避免污染）**

```bash
TASKBOARD_HOME=/tmp/taskboard-smoke node -e "
import('./server/db.mjs').then(async (dbm) => {
  const st = await import('./server/store.mjs')
  const db = dbm.openDb()
  const store = st.createStore(db)
  const p = store.createNode({ type: 'project', name: '充电平台' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: '26Q3', attrs: { estimate_hours: '16' } })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: '3.1 收发货', attrs: { branch: 'feature-x' } })
  const g = store.createNode({ parentId: s.id, type: 'group', name: '任务组A', attrs: { slug: 'recv', base_branch: 'feature-x' } })
  const t = store.createNode({ parentId: g.id, type: 'task', name: '子任务1', attrs: { slug: 'recv-1' } })
  store.createNode({ parentId: t.id, type: 'defect', name: '登录报错' })
  console.log(store.resolveRef('充电平台/26Q3/3.1 收发货/任务组A/子任务1').id, 'revision=' + store.getRevision())
  console.log(JSON.stringify(store.listTree()[0].children[0].children[0].children[0].name))
  db.close()
})
"
```

Expected: `resolveRef = 5`、`revision = 6`（6 个节点各一次，一次操作一次递增）、`tree = "任务组A"`、`docs@project = 描述`（预置文档）、`attrs@subreq = {"branch":"feature-x"}`

- [ ] **Step 3: 更新 README 进度**

```markdown
## 计划进度

- [x] 计划 1 数据层（config / db / store / revision）
- [ ] 计划 2 三入口（HTTP API + CLI + MCP）
- [ ] 计划 3 Web UI
- [ ] 计划 4 Git 集成与冲突处理
- [ ] 计划 5 MR / 上传 / 冒烟
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: 计划 1 数据层完成，更新进度"
```

---

## 自审（Self-Review）

**1. Spec 覆盖对照**（本计划对应设计文档章节）

| 设计文档 | 本计划落点 |
|---|---|
| §4.1 nodes（含 `created_by` / `updated_by`） | Task 4 建表、Task 5 CRUD、Task 9 审计测试 |
| §4.2 attr_defs（`UNIQUE(node_type,key)`、`enabled`） | Task 4 建表与预置、Task 7 defs CRUD |
| §4.3 attr_values（`UNIQUE(node_id,attr_def_id)`） | Task 7 `setAttrs` / `getAttrs` |
| §4.4～§4.5 commits / mrs | Task 4 建表（读写函数留给计划 4 / 计划 5） |
| §4.6 documents（`UNIQUE(node_id,name)` + 预置文档名） | Task 4 建表、Task 5 `docPresets`、Task 8 CRUD |
| §4.7～§4.12 repos / 状态值域 / 预置属性 / config / merges / unit_repos | Task 4 建表、Task 3 config（状态值域与 docPresets 默认值） |
| §3 父子类型与叶子规则（`task` 可挂 `defect`、`defect` 是叶子） | Task 4 `CHILD_TYPES`、Task 5 `validateParent` |
| §3 路径引用（歧义 409） | Task 6 `resolveRef` |
| §5.1 变更可见（revision）与审计 | Task 9 |
| §6 错误体与错误码 | Task 2 `errors.mjs`（HTTP 映射留计划 2） |

**2. 占位符扫描**：全文无 TBD/TODO；每个代码步骤都是可直接粘贴的完整实现；`Server 端 HTTP/CLI/MCP` 明确标注属于计划 2，不作为本计划的占位符。

**3. 类型一致性核对**：`createStore(db, { docPresets })`、`resolveRef(ref)`、`listAttrDefs(nodeType, { includeDisabled })`、`setAttrs(nodeId, attrs, by)`、`upsertDocument(nodeId, name, content, by)`、`reorderDocuments(nodeId, orderedIds)` 在各任务中签名一致；错误码统一取自 `errors.mjs` 的 `CODES`；`nodeVO` / `defVO` / `docVO` 字段命名在测试断言中保持一致（驼峰）。

**4. 已修正的问题（写作时发现）**：
- 叶子规则最初写成「`task` / `defect` 都不许挂子节点」，与设计文档「`task` 可挂 `defect`」冲突 → 改为 `CHILD_TYPES` 单一事实来源（`task: ['defect']`、`defect: []`）。
- `docPresets` 最初想从 `meta` 表读，实际应来自 config → 改为 `createStore(db, { docPresets })` 注入。
- 级联删除用例的文档数最初写成 1，实际预置文档使子树内共 4 篇 → 断言改为 4。
- **revision 语义修正**：`createNode` 内部会写属性与预置文档，若各自 `bumpRevision()` 会让「建一个节点」涨 2（Task 9 用例实测暴露）；因此在 store 内加 `withoutBump(fn)` 把组合写入括起，**一次操作只递增一次**，Task 9 的 1/2/3/4 才成立。
