import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tempHome } from './helpers.mjs'

const execFileP = promisify(execFile)
const CLI = path.resolve(import.meta.dirname, '../bin/taskboard.js')
const EXPORT_SNAPSHOT = path.resolve(import.meta.dirname, '../scripts/export-snapshot.mjs')
const IMPORT_SNAPSHOT = path.resolve(import.meta.dirname, '../scripts/import-snapshot.mjs')

async function httpServer() {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const { createApp } = await import('../server/http.mjs')
  const server = await new Promise((resolve, reject) => {
    const s = createApp({ store }).listen(0, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (method, pathname, body) => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    return { status: res.status, body: await res.json() }
  }
  return {
    tmp,
    store,
    request,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

async function mcpClient() {
  const tmp = await tempHome()
  const store = tmp.store.createStore(tmp.openDb())
  const { createMcpServer } = await import('../server/mcp.mjs')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const server = createMcpServer({ store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'taskboard-document-history-test', version: '1.0.0' })
  await client.connect(clientTransport)
  return {
    tmp,
    store,
    call: (name, args) => client.callTool({ name, arguments: args }),
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

async function cli(home, args) {
  const { stdout } = await execFileP('node', [CLI, ...args], {
    env: { ...process.env, TASKBOARD_HOME: home },
    encoding: 'utf8'
  })
  return JSON.parse(stdout)
}

async function snapshotCmd(script, home, args) {
  const { stdout, stderr } = await execFileP('node', [script, ...args], {
    env: { ...process.env, TASKBOARD_HOME: home },
    encoding: 'utf8'
  })
  return { stdout, stderr }
}

function seedProject(store) {
  return store.createNode({ type: 'project', name: 'P' })
}

test('文档历史：创建/更新均留快照，恢复追加新版本且不改写历史', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb())
  const p = seedProject(store)

  const doc = store.createDocument(p.id, '设计', 'v1', 'ai')
  store.updateDocument(doc.id, { name: '详细设计', content: 'v2' }, 'cli')
  store.updateDocument(doc.id, { content: 'v3' }, 'user')

  let history = store.listDocumentVersions(doc.id)
  assert.deepEqual(history.map((v) => [v.name, v.content, v.reason, v.createdBy]), [
    ['详细设计', 'v3', 'update', 'user'],
    ['详细设计', 'v2', 'update', 'cli'],
    ['设计', 'v1', 'create', 'ai']
  ])

  const restored = store.restoreDocumentVersion(doc.id, history.at(-1).id, 'cli')
  assert.equal(restored.document.name, '设计')
  assert.equal(restored.document.content, 'v1')
  assert.equal(restored.version.reason, 'restore')
  assert.equal(restored.version.createdBy, 'cli')

  history = store.listDocumentVersions(doc.id)
  assert.equal(history.length, 4)
  assert.equal(history[0].reason, 'restore')
  assert.deepEqual(history.slice(1).map((v) => v.reason), ['update', 'update', 'create'])
})

test('文档历史：恢复旧名称撞到现存文档时报 DOC_NAME_EXISTS，不覆盖两份文档', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb())
  const p = seedProject(store)
  const target = store.createDocument(p.id, '旧名', 'v1')
  const versionId = store.listDocumentVersions(target.id)[0].id
  store.updateDocument(target.id, { name: '新名' })
  store.createDocument(p.id, '旧名', '另一份文档')

  assert.throws(() => store.restoreDocumentVersion(target.id, versionId), /DOC_NAME_EXISTS/)
  assert.equal(store.listDocuments(p.id).find((d) => d.id === target.id).content, 'v1')
  assert.equal(store.listDocuments(p.id).find((d) => d.name === '旧名' && d.id !== target.id).content, '另一份文档')
})

test('文档历史：空 patch 与同内容 upsert 不留无差异快照', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb())
  const p = seedProject(store)
  const doc = store.createDocument(p.id, '设计', 'v1')

  const beforeRevision = store.getRevision()
  const same = store.updateDocument(doc.id, {})
  assert.equal(same.content, 'v1')
  assert.equal(store.getRevision(), beforeRevision)
  assert.equal(store.listDocumentVersions(doc.id).length, 1)

  const up = store.upsertDocument(p.id, '设计', 'v1')
  assert.equal(up.created, false)
  assert.equal(store.getRevision(), beforeRevision)
  assert.equal(store.listDocumentVersions(doc.id).length, 1)

  store.updateDocument(doc.id, { name: '  设计  ' })
  assert.equal(store.getRevision(), beforeRevision)
  assert.equal(store.listDocumentVersions(doc.id).length, 1)
})

test('文档历史：恢复时快照名 trim 后查重并写入，空名拒绝', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const store = tmp.store.createStore(tmp.openDb())
  const p = seedProject(store)
  const doc = store.createDocument(p.id, '设计', 'v1')

  store.db.prepare('UPDATE document_versions SET name = ? WHERE document_id = ?').run('  设计  ', doc.id)
  store.updateDocument(doc.id, { name: '新版' })
  store.createDocument(p.id, '设计', '占位')
  const trimmed = store.listDocumentVersions(doc.id).find((v) => v.name === '  设计  ')
  assert.throws(() => store.restoreDocumentVersion(doc.id, trimmed.id), /DOC_NAME_EXISTS/)

  store.db.prepare('UPDATE document_versions SET name = ? WHERE id = ?').run('   ', trimmed.id)
  assert.throws(() => store.restoreDocumentVersion(doc.id, trimmed.id), /VALIDATION_FAILED/)
})

test('文档历史（HTTP）：列表、恢复与 revision 递增', async (t) => {
  const { tmp, store, request, close } = await httpServer()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = seedProject(store)
  const created = await request('POST', `/api/nodes/${p.id}/documents`, { name: '接口设计', content: 'v1' })
  assert.equal(created.status, 201)
  const docId = created.body.id
  await request('PATCH', `/api/documents/${docId}`, { content: 'v2' })

  const before = store.getRevision()
  const versions = await request('GET', `/api/documents/${docId}/versions`)
  assert.equal(versions.status, 200)
  assert.deepEqual(versions.body.map((v) => v.content), ['v2', 'v1'])

  const versionId = versions.body.at(-1).id
  const restored = await request('POST', `/api/documents/${docId}/versions/${versionId}/restore`, {})
  assert.equal(restored.status, 200)
  assert.equal(restored.body.document.content, 'v1')
  assert.equal(store.getRevision(), before + 1)
})

test('文档历史（CLI）：doc history 与 doc restore 与 store 语义一致', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const home = tmp.dir
  await cli(home, ['node', 'upsert', '--path', 'P/R'])
  // 用非预置文档名，让本用例专注于「CLI 与 store 的版本历史语义一致」，
  // 不被 requirement 的预置文档拓扑（「需求内容」+「概要设计」）耦合。
  await cli(home, ['doc', 'upsert', 'P/R', '--name', '接口设计', '--content', 'v1'])
  await cli(home, ['doc', 'upsert', 'P/R', '--name', '接口设计', '--content', 'v2'])
  const docs = await cli(home, ['doc', 'list', 'P/R'])
  const doc = docs.find((d) => d.name === '接口设计')

  const history = await cli(home, ['doc', 'history', String(doc.id)])
  assert.deepEqual(history.map((v) => v.content), ['v2', 'v1'])
  const restored = await cli(home, ['doc', 'restore', String(doc.id), '--version', String(history.at(-1).id)])
  assert.equal(restored.document.content, 'v1')
  assert.equal(restored.version.reason, 'restore')
})

test('文档历史 × 需求预置文档：预置即带初始版本，upsert 预置文档追加 update 版本（集成口径）', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const home = tmp.dir
  await cli(home, ['node', 'upsert', '--path', 'P/R'])

  const docs = await cli(home, ['doc', 'list', 'P/R'])
  const preset = docs.find((d) => d.name === '概要设计')
  // 需求节点预置「需求内容」+「概要设计」，各自带一条空白初始版本（create）
  const initial = await cli(home, ['doc', 'history', String(preset.id)])
  assert.equal(initial.length, 1)
  assert.equal(initial[0].reason, 'create')
  assert.equal(initial[0].content, '')

  await cli(home, ['doc', 'upsert', 'P/R', '--name', '概要设计', '--content', '设计正文'])
  const after = await cli(home, ['doc', 'history', String(preset.id)])
  // 追加 update 版本，空白初始版本保留（可回退到「未填写」状态）
  assert.deepEqual(after.map((v) => [v.reason, v.content]), [
    ['update', '设计正文'],
    ['create', '']
  ])
})

test('文档历史（MCP）：doc_version_list / doc_version_restore 真实协议可用', async (t) => {
  const { tmp, store, call, close } = await mcpClient()
  t.after(async () => {
    await close()
    tmp.cleanup()
  })
  const p = seedProject(store)
  const created = await call('doc_create', { ref: String(p.id), name: 'MCP 设计', content: 'v1' })
  const doc = JSON.parse(created.content[0].text)
  await call('doc_update', { docId: doc.id, content: 'v2' })

  const listed = await call('doc_version_list', { docId: doc.id })
  const versions = JSON.parse(listed.content[0].text)
  assert.deepEqual(versions.map((v) => v.content), ['v2', 'v1'])
  const restored = await call('doc_version_restore', { docId: doc.id, versionId: versions.at(-1).id })
  assert.equal(JSON.parse(restored.content[0].text).document.content, 'v1')
})

test('文档历史迁移：老库已有文档首次打开回填 migrated 快照且幂等', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const file = path.join(tmp.dir, 'legacy-docs.db')
  const now = new Date().toISOString()
  const legacy = new DatabaseSync(file)
  legacy.exec(`
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY, type TEXT NOT NULL, parent_id INTEGER, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo', sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'user', updated_by TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, node_id INTEGER NOT NULL, name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'user', updated_by TEXT NOT NULL DEFAULT 'user'
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  legacy
    .prepare('INSERT INTO nodes (id,type,parent_id,name,status,sort,created_at,updated_at) VALUES (1,?,NULL,?,?,0,?,?)')
    .run('project', 'P', 'todo', now, now)
  legacy
    .prepare('INSERT INTO documents (id,node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (4,1,?,?,0,?,?,?,?)')
    .run('描述', '历史正文', now, now, 'cli', 'cli')
  legacy.close()

  const db = tmp.openDb(file)
  const rows = db.prepare('SELECT * FROM document_versions WHERE document_id = 4').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '描述')
  assert.equal(rows[0].content, '历史正文')
  assert.equal(rows[0].reason, 'migrated')
  assert.equal(rows[0].created_by, 'cli')
  db.close()

  const again = tmp.openDb(file)
  assert.equal(again.prepare('SELECT COUNT(*) c FROM document_versions WHERE document_id = 4').get().c, 1)
  again.close()
})

test('文档历史快照：导出→导入按新 document id 重映射历史并保留顺序', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const sourceHome = path.join(tmp.dir, 'source')
  const targetHome = path.join(tmp.dir, 'target')
  const snapPath = path.join(tmp.dir, 'snapshot.json')
  fs.mkdirSync(sourceHome, { recursive: true })
  fs.mkdirSync(targetHome, { recursive: true })

  const source = tmp.store.createStore(tmp.openDb(path.join(sourceHome, 'data.db')))
  const p = seedProject(source)
  const signoffProject = source.createNode({ type: 'project', name: '签收项目' })
  const a = source.createDocument(p.id, 'Alpha', 'a1')
  source.updateDocument(a.id, { content: 'alpha-v2' })
  source.updateDocument(a.id, { content: 'alpha-v3' })
  const b = source.createDocument(p.id, 'Beta', 'b1')
  source.upsertDocument(p.id, '需求内容', 'r1')
  const signoffCase = source.upsertTestCase(signoffProject.id, { name: '验收用例', prompt: 'p' })
  const signoffReport = source.createTestReport(signoffProject.id, { caseId: signoffCase.id, status: 'running' })
  source.finishTestReport(signoffReport.id, { status: 'pass' })
  source.upsertAcceptanceSignoff(signoffProject.id, { decision: 'accepted', comment: '快照签收' }, 'cli')
  const expected = new Map(source.listDocuments(p.id).map((d) => [d.name, source.listDocumentVersions(d.id).map((v) => v.content)]))
  source.db.close()

  // 目标库先有一篇文档，确保导入会重映射主键而不是碰巧沿用旧 id 后看起来正确。
  const target = tmp.store.createStore(tmp.openDb(path.join(targetHome, 'data.db')))
  target.createNode({ type: 'project', name: 'Old' })
  target.createDocument(1, 'N', 'n1')
  target.db.close()

  await snapshotCmd(EXPORT_SNAPSHOT, sourceHome, [snapPath])
  await snapshotCmd(IMPORT_SNAPSHOT, targetHome, [snapPath])

  const restored = tmp.store.createStore(tmp.openDb(path.join(targetHome, 'data.db')))
  const docs = restored.listDocuments(restored.resolveRef('P').id)
  assert.equal(docs.length, expected.size)
  for (const d of docs) {
    assert.deepEqual(restored.listDocumentVersions(d.id).map((v) => v.content), expected.get(d.name))
  }
  assert.deepEqual(
    restored.listDocumentVersions(docs.find((d) => d.name === 'Beta').id).map((v) => v.documentId),
    [docs.find((d) => d.name === 'Beta').id]
  )
  const restoredProject = restored.resolveRef('签收项目')
  const restoredSignoff = restored.getAcceptanceSignoff(restoredProject.id)
  assert.equal(restoredSignoff.decision, 'accepted')
  assert.equal(restoredSignoff.comment, '快照签收')
  assert.equal(restored.buildAcceptanceStatus(restoredProject.id).state, 'accepted')
  restored.db.close()
})

test('文档历史快照：导入孤儿版本行被丢弃且不串到现存文档', async (t) => {
  const tmp = await tempHome()
  t.after(() => tmp.cleanup())
  const sourceHome = path.join(tmp.dir, 'source')
  const targetHome = path.join(tmp.dir, 'target')
  const snapPath = path.join(tmp.dir, 'snapshot.json')
  fs.mkdirSync(sourceHome, { recursive: true })
  fs.mkdirSync(targetHome, { recursive: true })

  const source = tmp.store.createStore(tmp.openDb(path.join(sourceHome, 'data.db')))
  const p = seedProject(source)
  source.createDocument(p.id, 'Alpha', 'a1')
  source.db.close()
  await snapshotCmd(EXPORT_SNAPSHOT, sourceHome, [snapPath])

  const bad = JSON.parse(fs.readFileSync(snapPath, 'utf8'))
  const alpha = bad.tables.documents.find((d) => d.name === 'Alpha')
  const orphan = bad.tables.document_versions.find((v) => v.document_id === alpha.id)
  assert.ok(orphan)
  orphan.document_id = 999999
  orphan.name = '孤儿'
  fs.writeFileSync(snapPath, JSON.stringify(bad, null, 2) + '\n')

  const target = tmp.store.createStore(tmp.openDb(path.join(targetHome, 'data.db')))
  target.createNode({ type: 'project', name: 'Old' })
  const victim = target.createDocument(1, 'N', 'n1')
  target.db.close()

  await snapshotCmd(IMPORT_SNAPSHOT, targetHome, [snapPath])

  const restored = tmp.store.createStore(tmp.openDb(path.join(targetHome, 'data.db')))
  const imported = restored.listDocuments(restored.resolveRef('P').id).find((d) => d.name === 'Alpha')
  assert.deepEqual(
    restored.listDocumentVersions(imported.id).map((v) => [v.name, v.content, v.reason]),
    [['Alpha', 'a1', 'migrated']]
  )
  const orphans = restored.db
    .prepare('SELECT COUNT(*) c FROM document_versions v WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = v.document_id)')
    .get().c
  assert.equal(orphans, 0)
  assert.equal(restored.db.prepare("SELECT COUNT(*) c FROM document_versions WHERE name = '孤儿'").get().c, 0)
  const description = restored.listDocuments(restored.resolveRef('P').id).find((d) => d.name === '描述')
  assert.equal(restored.listDocumentVersions(description.id)[0].content, '')
  restored.db.close()
})
