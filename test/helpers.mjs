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
  // store.mjs 在计划 1 Task 5 才实现；这里容错，避免 db/config 用例被连带失败
  const store = await import('../server/store.mjs').catch(() => ({
    createStore() {
      throw new Error('server/store.mjs 尚未实现（计划 1 Task 5）')
    }
  }))
  return {
    dir,
    // 注意：config/db 模块在首次 import 时就把 TASKBOARD_HOME 固定下来了（ESM 模块只求值一次），
    // 所以同一个测试文件内多次 tempHome() 并不会换 HOME；要真隔离得给每次调用独立的库文件。
    openDb: (file) => db.openDb(file || path.join(dir, 'data.db')),
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
