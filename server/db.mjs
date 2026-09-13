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
  test_branch TEXT,
  pre_branch TEXT,
  release_branch TEXT,
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
  migrate(db)
  seed(db)
  return db
}

/** 轻量迁移：对已存在的库幂等补列（SCHEMA 里只对新建库生效） */
function migrate(db) {
  const cols = db
    .prepare('PRAGMA table_info(repos)')
    .all()
    .map((c) => c.name)
  const additions = [
    ['test_branch', 'TEXT'],
    ['pre_branch', 'TEXT'],
    ['release_branch', 'TEXT']
  ]
  for (const [name, ddl] of additions) {
    if (!cols.includes(name)) db.exec(`ALTER TABLE repos ADD COLUMN ${name} ${ddl}`)
  }
}
