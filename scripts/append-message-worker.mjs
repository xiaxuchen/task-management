// 并发追加消息的独立进程 worker：模拟 MCP/CLI 等独立入口同时写同一条任务。
// 用法：node append-message-worker.mjs <dbPath> <runId> <count> <label>
import { openDb } from '../server/db.mjs'
import { createStore } from '../server/store.mjs'

const [dbPath, runId, count, label] = process.argv.slice(2)
const db = openDb(dbPath)
const store = createStore(db)
const n = Number(count) || 1
const failed = []

for (let i = 0; i < n; i++) {
  try {
    store.appendAgentRunMessage(Number(runId), { type: 'text', content: `${label}-${i}` })
  } catch (e) {
    failed.push(String((e && e.message) || e))
  }
}

db.close()
if (failed.length) {
  process.stderr.write(JSON.stringify(failed) + '\n')
  process.exit(1)
}
process.exit(0)
