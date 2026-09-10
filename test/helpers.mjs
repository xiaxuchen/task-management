import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 每个用例一个独立 HOME，避免污染真实 ~/.taskboard。
 * 用法：
 *   const tmp = await tempHome()
 *   const db = tmp.openDb()
 *   const store = tmp.store.createStore(db)
 *   ...
 *   tmp.cleanup()
 */
export async function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-test-'))
  process.env.TASKBOARD_HOME = dir
  // config/db 在 import 时读取该变量，所以用动态 import 保证顺序
  const db = await import('../server/db.mjs')
  const config = await import('../server/config.mjs')
  const store = await import('../server/store.mjs')
  return {
    dir,
    openDb: db.openDb,
    config,
    store,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      delete process.env.TASKBOARD_HOME
    }
  }
}

export function nodeInput(over = {}) {
  return { parentId: null, type: 'project', name: '示例项目', ...over }
}
