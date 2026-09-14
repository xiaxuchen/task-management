import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tempHome } from './helpers.mjs'

const execFileP = promisify(execFile)
const CLI = path.resolve(import.meta.dirname, '../bin/taskboard.js')

/** 每个用例独立 HOME，子进程里跑真实的 CLI（复现 #5：CLI 参数解析非 1:1） */
async function cli(home, args) {
  const { stdout } = await execFileP('node', [CLI, ...args], {
    env: { ...process.env, TASKBOARD_HOME: home },
    encoding: 'utf8'
  })
  return JSON.parse(stdout)
}

async function cliFail(home, args) {
  try {
    await execFileP('node', [CLI, ...args], { env: { ...process.env, TASKBOARD_HOME: home }, encoding: 'utf8' })
    return null
  } catch (e) {
    return { code: e.code, stderr: String(e.stderr || '') + String(e.stdout || '') }
  }
}

async function setup() {
  const tmp = await tempHome()
  // tempHome 已经塞了 TASKBOARD_HOME，但 CLI 是子进程，另起的库与当前用例无关；
  // 这里直接复用 tmp.dir 作为子进程的 HOME，保证清理即可回收。
  const home = tmp.dir
  await cli(home, ['node', 'upsert', '--path', 'P/R'])
  return { tmp, home }
}

test('缺陷5回归：CLI test case upsert 支持 --enabled false（原问题：ERR_PARSE_ARGS_UNKNOWN_OPTION）', async () => {
  const { tmp, home } = await setup()
  try {
    const c = await cli(home, ['test', 'case', 'upsert', 'P/R', '--name', 'A', '--prompt', 'p', '--enabled', 'false'])
    assert.equal(c.enabled, false)
    // 停用后默认列表不返回，--include-disabled 能查到
    assert.equal((await cli(home, ['test', 'case', 'list', 'P/R'])).length, 0)
    assert.equal((await cli(home, ['test', 'case', 'list', 'P/R', '--include-disabled'])).length, 1)
    // update 也能改回启用
    const on = await cli(home, ['test', 'case', 'update', String(c.id), '--enabled', 'true'])
    assert.equal(on.enabled, true)
    assert.equal((await cli(home, ['test', 'case', 'list', 'P/R'])).length, 1)
  } finally {
    tmp.cleanup()
  }
})

test('缺陷5回归：CLI --enabled 非法值报 VALIDATION_FAILED（不是参数解析崩溃）', async () => {
  const { tmp, home } = await setup()
  try {
    const r = await cliFail(home, ['test', 'case', 'upsert', 'P/R', '--name', 'A', '--prompt', 'p', '--enabled', 'maybe'])
    assert.ok(r, '应当失败')
    assert.match(r.stderr, /VALIDATION_FAILED/)
    assert.ok(!/UNKNOWN_OPTION/.test(r.stderr))
  } finally {
    tmp.cleanup()
  }
})

test('缺陷5回归：CLI test report finish 支持 --run-id（原问题：无此参数）', async () => {
  const { tmp, home } = await setup()
  try {
    const c = await cli(home, ['test', 'case', 'upsert', 'P/R', '--name', 'A', '--prompt', 'p'])
    // 直接经 store 开报告（真派单需要仓库，这里只验 CLI 参数契约）
    const { openDb } = await import('../server/db.mjs')
    const { createStore } = await import('../server/store.mjs')
    process.env.TASKBOARD_HOME = home
    const store = createStore(openDb(path.join(home, 'data.db')))
    const node = store.resolveRef('P/R')
    const run = store.createAgentRun(node.id, { prompt: 'x', agent: 'qodercli' }, 'user')
    const rep = store.createTestReport(node.id, { caseId: c.id })
    store.db.close()
    const done = await cli(home, ['test', 'report', 'finish', String(rep.id), '--status', 'pass', '--run-id', String(run.id)])
    assert.equal(done.status, 'pass')
    assert.equal(done.runId, run.id)
  } finally {
    tmp.cleanup()
  }
})

test('缺陷5回归：CLI test report finish 支持 --overwrite（终态互转显式覆盖）', async () => {
  const { tmp, home } = await setup()
  try {
    const c = await cli(home, ['test', 'case', 'upsert', 'P/R', '--name', 'A', '--prompt', 'p'])
    const { openDb } = await import('../server/db.mjs')
    const { createStore } = await import('../server/store.mjs')
    process.env.TASKBOARD_HOME = home
    const store = createStore(openDb(path.join(home, 'data.db')))
    const node = store.resolveRef('P/R')
    const rep = store.createTestReport(node.id, { caseId: c.id })
    store.db.close()
    await cli(home, ['test', 'report', 'finish', String(rep.id), '--status', 'pass'])
    // 终态互转默认拒绝
    const rejected = await cliFail(home, ['test', 'report', 'finish', String(rep.id), '--status', 'fail'])
    assert.match(rejected.stderr, /REPORT_STATUS_IMMUTABLE/)
    // 显式 overwrite 才覆盖
    const forced = await cli(home, ['test', 'report', 'finish', String(rep.id), '--status', 'fail', '--overwrite'])
    assert.equal(forced.status, 'fail')
  } finally {
    tmp.cleanup()
  }
})
