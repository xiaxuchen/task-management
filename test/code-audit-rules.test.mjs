import test from 'node:test'
import assert from 'node:assert/strict'
import { auditAddedLines, summarizeCodeAudit, isCodeFile, isTestFile } from '../server/code-audit.mjs'

const rulesOf = (entries) => auditAddedLines(entries).map((f) => f.rule)
const one = (text, path = 'a.js') => rulesOf([{ path, line: 1, text }])

// ---------- 高危规则 ----------

test('code-audit：未解决的合并冲突标记 → danger', () => {
  assert.deepEqual(one('<<<<<<< HEAD'), ['merge_conflict_marker'])
  assert.deepEqual(one('>>>>>>> feature/x'), ['merge_conflict_marker'])
  assert.deepEqual(one('||||||| merged common ancestors'), ['merge_conflict_marker'])
  // markdown 分隔线 / 普通等号不是冲突标记
  assert.deepEqual(one('======='), [])
  assert.deepEqual(one('a ======= b'), [])
})

test('code-audit：私钥块 → danger', () => {
  assert.deepEqual(one('-----BEGIN RSA PRIVATE KEY-----'), ['private_key_block'])
  assert.deepEqual(one('-----BEGIN OPENSSH PRIVATE KEY-----'), ['private_key_block'])
})

test('code-audit：硬编码凭据 → danger，且证据脱敏不回显原值', () => {
  const findings = auditAddedLines([{ path: 'conf.js', line: 3, text: "password = 'supersecret123'" }])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'hardcoded_secret')
  assert.equal(findings[0].severity, 'danger')
  assert.ok(!findings[0].snippet.includes('supersecret123'), `snippet 不应含原值：${findings[0].snippet}`)
  assert.ok(findings[0].snippet.includes('su***'), `snippet 应含掩码：${findings[0].snippet}`)
})

test('code-audit：硬编码凭据的占位值与变量引用不算命中', () => {
  assert.deepEqual(one("password = 'YOUR_PASSWORD_HERE'"), [])
  assert.deepEqual(one('token = process.env.API_TOKEN'), [])
  assert.deepEqual(one('apiKey = "${API_KEY}"'), [])
  assert.deepEqual(one("secret = 'changeme'"), [])
})

test('code-audit：脱敏发生在截断之前，长值不会以明文经截断漏出', () => {
  const long = 'A'.repeat(400)
  const findings = auditAddedLines([{ path: 'c.js', line: 1, text: `token = '${long}'` }])
  assert.equal(findings.length, 1)
  assert.ok(!findings[0].snippet.includes(long), '整段原值不得出现在片段里')
  assert.ok(findings[0].snippet.includes('AA***'), `应保留掩码：${findings[0].snippet}`)
})

test('code-audit：.only / fit / fdescribe 仅在测试文件里判 danger', () => {
  assert.deepEqual(one('it.only("x", () => {})', 'test/a.test.mjs'), ['focused_test'])
  assert.deepEqual(one('fit("x", () => {})', 'src/spec/a.js'), ['focused_test'])
  // 非测试文件里的 .only 是普通方法，不该误伤
  assert.deepEqual(one('rows.only(1)'), [])
})

test('code-audit：eval / new Function → danger，注释行不命中', () => {
  assert.deepEqual(one('const r = eval(input)'), ['eval_usage'])
  assert.deepEqual(one('const f = new Function("a", "return a")'), ['eval_usage'])
  assert.deepEqual(one('// eval(userInput) 是危险写法'), [])
})

// ---------- 提示规则 ----------

test('code-audit：调试与待办类规则只提示，不阻塞', () => {
  const findings = auditAddedLines([
    { path: 'a.js', line: 1, text: 'debugger' },
    { path: 'a.js', line: 2, text: 'console.log("x")' },
    { path: 'a.js', line: 3, text: '// eslint-disable-next-line' },
    { path: 'a.js', line: 4, text: '// TODO: 补测试' }
  ])
  assert.deepEqual(findings.map((f) => f.rule).sort(), ['console_log', 'debugger_statement', 'lint_suppression', 'todo_marker'])
  assert.ok(findings.every((f) => f.severity === 'warn'))
})

test('code-audit：console.log 只在代码文件、且不在测试文件里提示', () => {
  assert.deepEqual(one('console.log(1)', 'src/a.ts'), ['console_log'])
  assert.deepEqual(one('console.log(1)', 'test/a.test.mjs'), [])
  assert.deepEqual(one('console.log(1)', 'README.md'), [])
})

test('code-audit：普通代码不产生任何命中', () => {
  assert.deepEqual(one('const total = items.reduce((a, b) => a + b, 0)'), [])
})

test('code-audit：isCodeFile / isTestFile 值域', () => {
  assert.equal(isCodeFile('a/b.mjs'), true)
  assert.equal(isCodeFile('a/b.md'), false)
  assert.equal(isCodeFile('noext'), false)
  assert.equal(isTestFile('test/x.test.mjs'), true)
  assert.equal(isTestFile('src/__tests__/x.js'), true)
  assert.equal(isTestFile('src/x.js'), false)
})

// ---------- 顶层结论 ----------

const node = { id: 1, name: 'R', type: 'requirement' }
const itemWith = (entries) => ({
  commit: { repo: 'r', sha: 'a'.repeat(40) },
  addedLines: entries.length,
  files: [{ path: 'a.js', addedLines: entries.length }],
  findings: auditAddedLines(entries),
  error: null
})

test('code-audit：有高危命中 → ready=false，并展平到 blockers', () => {
  const audit = summarizeCodeAudit({ node, scope: 'self', items: [itemWith([{ path: 'a.js', line: 1, text: 'debugger' }])] })
  assert.equal(audit.ready, true)
  const bad = summarizeCodeAudit({ node, scope: 'self', items: [itemWith([{ path: 'a.js', line: 1, text: 'eval(x)' }])] })
  assert.equal(bad.ready, false)
  assert.equal(bad.totals.danger, 1)
  assert.equal(bad.blockers.length, 1)
  assert.equal(bad.blockers[0].rule, 'eval_usage')
})

test('code-audit：提示命中不影响 ready', () => {
  const audit = summarizeCodeAudit({ node, scope: 'self', items: [itemWith([{ path: 'a.js', line: 1, text: 'console.log(1)' }])] })
  assert.equal(audit.ready, true)
  assert.equal(audit.totals.warn, 1)
  assert.equal(audit.totals.danger, 0)
  assert.deepEqual(audit.blockers, [])
})

test('code-audit：没有提交 → ready=null（没有可审查的代码，不是通过）', () => {
  const audit = summarizeCodeAudit({ node, scope: 'self', items: [] })
  assert.equal(audit.ready, null)
  assert.equal(audit.totals.commits, 0)
})

test('code-audit：提交读不到 → ready=null（看不到 ≠ 没问题）', () => {
  const audit = summarizeCodeAudit({
    node,
    scope: 'self',
    items: [{ commit: { repo: 'r', sha: 'x' }, addedLines: 0, files: [], findings: [], error: { code: 'REPO_PATH_MISSING', message: 'no path' } }]
  })
  assert.equal(audit.ready, null)
  assert.equal(audit.totals.errors, 1)
})

test('code-audit：有提交但无新增行 → ready=null', () => {
  const audit = summarizeCodeAudit({
    node,
    scope: 'self',
    items: [{ commit: { repo: 'r', sha: 'y' }, addedLines: 0, files: [], findings: [], error: null }]
  })
  assert.equal(audit.ready, null)
})

test('code-audit：读不到提交与高危命中同时存在时，高危优先判 false', () => {
  const audit = summarizeCodeAudit({
    node,
    scope: 'self',
    items: [
      itemWith([{ path: 'a.js', line: 1, text: 'eval(x)' }]),
      { commit: { repo: 'r', sha: 'z' }, addedLines: 0, files: [], findings: [], error: { code: 'REPO_NOT_REGISTERED', message: 'no repo' } }
    ]
  })
  assert.equal(audit.ready, false)
  assert.equal(audit.totals.errors, 1)
})

test('code-audit：byRule 统计按规则聚合', () => {
  const audit = summarizeCodeAudit({
    node,
    scope: 'self',
    items: [itemWith([
      { path: 'a.js', line: 1, text: 'debugger' },
      { path: 'a.js', line: 2, text: 'debugger' },
      { path: 'a.js', line: 3, text: 'console.log(1)' }
    ])]
  })
  assert.deepEqual(audit.totals.byRule, { debugger_statement: 2, console_log: 1 })
})

test('code-audit：扫描被截断 → ready=null，不冒充通过', () => {
  const audit = summarizeCodeAudit({
    node,
    scope: 'self',
    items: [itemWith([{ path: 'a.js', line: 1, text: 'export const a = 1' }])],
    truncated: true
  })
  assert.equal(audit.ready, null)
  assert.equal(audit.totals.truncated, true)
})
