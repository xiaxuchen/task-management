import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import {
  EXCLUDED_TABLES,
  assertExclusionsDocumented,
  importPlan,
  importOrder,
  listBusinessTables,
  listExistingTables
} from '../scripts/snapshot-tables.mjs'

const execFileP = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')

/** 造一个隔离的 TASKBOARD_HOME（脚本进程读环境变量，必须走子进程）。 */
function makeHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-snapshot-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const run = (script, args, home) =>
  execFileP(process.execPath, [path.join(root, script), ...args], {
    env: { ...process.env, TASKBOARD_HOME: home },
    encoding: 'utf8'
  })

/** 用真实 schema 初始化一个空库 */
async function initHome(home) {
  await execFileP(
    process.execPath,
    ['--input-type=module', '-e', "import {openDb} from './server/db.mjs'; openDb()"],
    { env: { ...process.env, TASKBOARD_HOME: home }, cwd: root, encoding: 'utf8' }
  )
}

/** 在隔离 HOME 里执行一段建库脚本（cwd 必须在仓库根，才能 import ./server/*） */
const seed = (home, code) =>
  execFileP(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TASKBOARD_HOME: home },
    cwd: root,
    encoding: 'utf8'
  })

const q = (home, sql) => {
  const db = new DatabaseSync(path.join(home, 'data.db'))
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

// ---------- 表清单登记（回归：新增表不再静默丢） ----------

test('snapshot-tables：被排除的表都必须写明理由', () => {
  assert.doesNotThrow(() => assertExclusionsDocumented())
  assert.ok(Object.values(EXCLUDED_TABLES).every((r) => String(r || '').trim().length > 0))
})

test('snapshot-tables：业务表 = 真实表 − 显式排除（新增表自动进快照）', async (t) => {
  const home = makeHome(t)
  await initHome(home)
  const db = new DatabaseSync(path.join(home, 'data.db'))
  try {
    const existing = listExistingTables(db)
    const business = listBusinessTables(db)
    assert.deepEqual(
      business,
      existing.filter((n) => !(n in EXCLUDED_TABLES)).sort(),
      '业务表集合应与真实表减去排除项一致'
    )
    // 关键：新增一张表后应自动纳入，无需改代码
    db.exec('CREATE TABLE brand_new_feature (id INTEGER PRIMARY KEY)')
    assert.ok(listBusinessTables(db).includes('brand_new_feature'), '新增表应自动进快照清单')
  } finally {
    db.close()
  }
})

test('snapshot-tables：导入顺序满足外键依赖（被引用表在前）', async (t) => {
  const home = makeHome(t)
  await initHome(home)
  const db = new DatabaseSync(path.join(home, 'data.db'))
  try {
    const plan = importPlan(db)
    const pos = new Map(plan.map((t, i) => [t.name, i]))
    for (const entry of plan) {
      for (const fk of entry.fks) {
        if (fk.table === entry.name) {
          assert.equal(entry.selfReferencing, true, `${entry.name} 自引用应被标记`)
          continue
        }
        if (!pos.has(fk.table)) continue
        assert.ok(pos.get(fk.table) < pos.get(entry.name), `${entry.name} 依赖的 ${fk.table} 应排在它前面`)
      }
    }
    // 顺序稳定（同名库两次推导一致）
    assert.deepEqual(importOrder(db), plan.map((t) => t.name))
  } finally {
    db.close()
  }
})

// ---------- 端到端往返（回归：旧实现丢 10+ 张表） ----------

test('快照往返：test_cases / release_items / comments 等此前丢失的表都保留', async (t) => {
  const src = makeHome(t)
  const dst = makeHome(t)
  await initHome(src)
  await initHome(dst)

  // 造覆盖「旧实现会丢」的表的数据：测试用例 / 上线项 / 行级评论 / agent 链路 / 分支配置
  await seed(
    src,
    `
    import { openDb } from './server/db.mjs'
    import { createStore } from './server/store.mjs'
    const db = openDb(); const s = createStore(db)
    const p = s.createNode({ type: 'project', name: 'P' })
    const r = s.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
    const task = s.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
    const c = s.createTestCase(task.id, { name: '登录回归', prompt: '跑单测' })
    s.upsertReleaseItem(task.id, { name: '执行上线SQL', kind: 'sql', content: 'ALTER TABLE t ADD c int', rollback: 'DROP' })
    s.createComment(task.id, { filePath: 'a/b.java', content: '这里有问题', lineStart: 10, lineEnd: 12 })
    s.createTestReport(task.id, { caseId: c.id, status: 'running' })
    const run = s.createAgentRun(task.id, { prompt: '跑', agent: 'echo' })
    s.appendAgentRunMessage(run.id, { type: 'text', content: 'hello' })
    s.upsertBranchConfig('TAG1', { testBranch: 't1', preBranch: 'p1' })
    `
  )

  const snapPath = path.join(src, 'snap.json')
  await run('scripts/export-snapshot.mjs', [snapPath], src)
  await run('scripts/import-snapshot.mjs', [snapPath], dst)

  for (const table of [
    'test_cases',
    'release_items',
    'comments',
    'test_reports',
    'agent_runs',
    'agent_run_messages',
    'branch_configs'
  ]) {
    const n = q(dst, `SELECT COUNT(*) c FROM ${table}`)[0].c
    assert.ok(n >= 1, `${table} 在导入后为空——快照把它丢了`)
  }
})

test('快照往返：父子关系与外键在重映射后仍然完整', async (t) => {
  const src = makeHome(t)
  const dst = makeHome(t)
  await initHome(src)
  await initHome(dst)

  await seed(
    src,
    `
    import { openDb } from './server/db.mjs'
    import { createStore } from './server/store.mjs'
    const db = openDb(); const s = createStore(db)
    const p = s.createNode({ type: 'project', name: 'P' })
    const r = s.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
    const t = s.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
    const c = s.createTestCase(t.id, { name: 'C', prompt: 'p' })
    const run = s.createAgentRun(t.id, { prompt: 'x', agent: 'echo' })
    s.createTestReport(t.id, { caseId: c.id, runId: run.id, status: 'running' })
    s.appendAgentRunMessage(run.id, { type: 'text', content: 'm' })
    `
  )

  const snapPath = path.join(src, 'snap.json')
  await run('scripts/export-snapshot.mjs', [snapPath], src)
  await run('scripts/import-snapshot.mjs', [snapPath], dst)

  assert.equal(
    q(dst, 'SELECT COUNT(*) c FROM nodes WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM nodes)')[0].c,
    0,
    '导入后出现孤儿节点'
  )
  assert.equal(q(dst, 'SELECT COUNT(*) c FROM nodes')[0].c, 3)
  // test_reports 同时引用 case 与 run：两者都不能丢，否则外键被置空
  const rep = q(dst, 'SELECT case_id, run_id FROM test_reports')[0]
  assert.ok(rep.case_id != null, 'test_reports.case_id 在重映射后丢失')
  assert.ok(rep.run_id != null, 'test_reports.run_id 在重映射后丢失')
  assert.equal(q(dst, 'SELECT COUNT(*) c FROM agent_run_messages m JOIN agent_runs r ON r.id = m.run_id')[0].c, 1)
})

test('快照往返：revision 与文档正文按原值恢复', async (t) => {
  const src = makeHome(t)
  const dst = makeHome(t)
  await initHome(src)
  await initHome(dst)

  const body = '正文内容 ' + 'x'.repeat(500)
  await seed(
    src,
    `
    import { openDb } from './server/db.mjs'
    import { createStore } from './server/store.mjs'
    const db = openDb(); const s = createStore(db)
    const p = s.createNode({ type: 'project', name: 'P' })
    const r = s.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
    s.upsertDocument(r.id, '需求内容', ${JSON.stringify(body)})
    `
  )
  const srcRevision = q(src, "SELECT value v FROM meta WHERE key='revision'")[0].v

  const snapPath = path.join(src, 'snap.json')
  await run('scripts/export-snapshot.mjs', [snapPath], src)
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'))
  assert.equal(snap.version, 2, '快照版本应升到 v2（覆盖全部业务表）')

  await run('scripts/import-snapshot.mjs', [snapPath], dst)
  assert.equal(q(dst, "SELECT value v FROM meta WHERE key='revision'")[0].v, srcRevision)
  assert.equal(q(dst, "SELECT content c FROM documents WHERE name='需求内容'")[0].c, body)
})

// ---------- 防护：新增表自动纳入 / v1 快照必须告警 ----------

test('导出：库里新增的表自动进快照（无需改代码，也不再静默丢表）', async (t) => {
  const home = makeHome(t)
  await initHome(home)
  const db = new DatabaseSync(path.join(home, 'data.db'))
  db.exec('CREATE TABLE brand_new_feature (id INTEGER PRIMARY KEY, note TEXT)')
  db.prepare('INSERT INTO brand_new_feature (note) VALUES (?)').run('hello')
  db.close()

  const snapPath = path.join(home, 's.json')
  await run('scripts/export-snapshot.mjs', [snapPath], home)
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'))
  // 这是本缺陷的根治点：新表不需要人工登记，导出侧也不会漏。
  assert.ok(snap.tables.brand_new_feature, '新增表未进快照')
  assert.equal(snap.tables.brand_new_feature.length, 1)
  assert.ok(snap.plan.some((p) => p.name === 'brand_new_feature'))
})

test('导入：v1 快照缺表时给出显式告警（不静默清库）', async (t) => {
  const home = makeHome(t)
  await initHome(home)
  const v1 = path.join(home, 'v1.json')
  fs.writeFileSync(
    v1,
    JSON.stringify({
      format: 'taskboard-snapshot',
      version: 1,
      exportedAt: 'x',
      revision: 1,
      tables: {
        attr_defs: [],
        repos: [],
        nodes: [],
        attr_values: [],
        documents: [],
        commits: [],
        mrs: [],
        merges: [],
        unit_repos: []
      }
    })
  )
  const out = await run('scripts/import-snapshot.mjs', [v1], home)
  assert.match(out.stderr, /未包含以下表/)
  assert.match(out.stderr, /test_cases/)
  assert.match(out.stderr, /release_items/)
})

test('导入：非 taskboard-snapshot 格式被拒绝', async (t) => {
  const home = makeHome(t)
  await initHome(home)
  const bad = path.join(home, 'bad.json')
  fs.writeFileSync(bad, JSON.stringify({ format: 'something-else', tables: {} }))
  await assert.rejects(() => run('scripts/import-snapshot.mjs', [bad], home), (err) => /格式不匹配/.test(err.stderr))
})
