import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  return { tmp, db, store }
}

function makeTask(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  const s = store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
  const t = store.createNode({ parentId: s.id, type: 'task', name: 'T' })
  return { t }
}

test('IDE 桥：创建 → 领取（processing）→ 完成（done）；commits 明细自动补全', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo' })
  const c = store.addCommit(task.id, { repo: 'demo', sha: 'abcdef1', note: 'feat: x' })

  const req = store.createIdeRequest('open-diff', { cids: [c.id], path: 'src/a.vue', title: '提交 abcdef1' })
  assert.equal(req.status, 'pending')
  assert.equal(req.path, 'src/a.vue')
  assert.equal(req.commits[0].sha, 'abcdef1')
  assert.equal(req.commits[0].repo, 'demo')

  const claimed = store.claimNextIdeRequest()
  assert.equal(claimed.id, req.id)
  assert.equal(claimed.status, 'processing')

  assert.equal(store.claimNextIdeRequest(), null) // 已无 pending

  const done = store.completeIdeRequest(req.id, { status: 'done' })
  assert.equal(done.status, 'done')
  assert.ok(done.handledAt)
})

test('IDE 桥：队列顺序 / 空 cids 报错 / 卡住的 processing 超时重回队列', async (t) => {
  const { tmp, db, store } = await setup()
  t.after(() => tmp.cleanup())
  const { t: task } = makeTask(store)
  store.addRepo({ name: 'demo' })
  const a = store.addCommit(task.id, { repo: 'demo', sha: 'aaaaaa1' })
  const b = store.addCommit(task.id, { repo: 'demo', sha: 'bbbbbb2' })

  assert.throws(() => store.createIdeRequest('open-diff', { cids: [] }), (e) => e.code === 'VALIDATION_FAILED')

  const r1 = store.createIdeRequest('open-diff', { cids: [a.id] })
  const r2 = store.createIdeRequest('open-diff', { cids: [b.id] })
  assert.equal(store.claimNextIdeRequest().id, r1.id) // 先到先得
  assert.equal(store.claimNextIdeRequest().id, r2.id)

  // 模拟 r2 处理中卡死（handled_at 拨回 60 秒前）→ 下次领取时应重置回 pending 并再次领取
  db.prepare('UPDATE ide_requests SET handled_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 60 * 1000).toISOString(), r2.id)
  const reclaimed = store.claimNextIdeRequest()
  assert.equal(reclaimed.id, r2.id)
  assert.equal(reclaimed.status, 'processing')
})
