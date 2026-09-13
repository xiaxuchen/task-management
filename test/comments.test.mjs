import test from 'node:test'
import assert from 'node:assert/strict'
import { tempHome } from './helpers.mjs'

async function setup() {
  const tmp = await tempHome()
  const db = tmp.openDb()
  const store = tmp.store.createStore(db)
  return { tmp, store }
}

function makeTask(store) {
  const p = store.createNode({ type: 'project', name: 'P' })
  const r = store.createNode({ parentId: p.id, type: 'requirement', name: 'R' })
  return store.createNode({ parentId: r.id, type: 'subreq', name: 'S' })
}

test('comments：创建 / 节点查 / 文件查 / 更新 / 删除', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  const s = makeTask(store)
  const c = store.createComment(s.id, {
    repo: 'xp-thor-mgnt',
    filePath: 'src/a.js',
    commitSha: 'abc1234',
    lineStart: 10,
    lineEnd: 12,
    snippet: 'const x = 1',
    content: '这里逻辑要确认'
  }, 'user')
  assert.equal(c.id > 0, true)
  assert.equal(c.filePath, 'src/a.js')
  assert.equal(c.status, 'open')
  assert.equal(c.lineStart, 10)

  const byNode = store.listComments(s.id)
  assert.equal(byNode.length, 1)

  const byFile = store.listCommentsByFile('src/a.js', { commitSha: 'abc1234' })
  assert.equal(byFile.length, 1)
  assert.equal(store.listCommentsByFile('src/a.js', { commitSha: 'nope' }).length, 0)

  const updated = store.updateComment(c.id, { status: 'resolved' })
  assert.equal(updated.status, 'resolved')

  store.deleteComment(c.id)
  assert.equal(store.listComments(s.id).length, 0)
})

test('comments：空内容拒绝', async (t) => {
  const { tmp, store } = await setup()
  t.after(() => tmp.cleanup())
  const s = makeTask(store)
  assert.throws(() => store.createComment(s.id, { filePath: 'a.js', content: '  ' }), /评论内容不能为空/)
})
