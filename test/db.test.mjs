import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

test('openDb 建出全部表并开启 WAL / 外键', async () => {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name)
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
