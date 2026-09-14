import { AppError, CODES } from './errors.mjs'
import { CHILD_TYPES, LEAF_TYPES } from './db.mjs'

const ACTORS = new Set(['user', 'ai', 'cli', 'import'])
const now = () => new Date().toISOString()
const REVIEW_STATUSES = ['pending', 'approved', 'issue']

/** 写事务抢锁失败时的兜底重试（busy_timeout 之外的保险） */
const SQLITE_BUSY_RETRIES = 5
const SQLITE_BUSY_RETRY_MS = 40
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const isSqliteBusy = (e) => /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(String((e && e.message) || e))
/** 任务默认重试上限（含首次执行）：attempt 1 → 最多可重试到 3；超限重试被硬性拒绝 */
const DEFAULT_MAX_ATTEMPTS = 3

/** 预置文档名（与 config.docPresets 默认值一致） */
const DEFAULT_DOC_PRESETS = {
  project: ['描述'],
  requirement: ['需求内容'],
  subreq: ['需求内容'],
  group: [],
  task: [],
  defect: ['描述', '复现步骤']
}

export function createStore(db, options = {}) {
  const docPresets = options.docPresets || DEFAULT_DOC_PRESETS
  const stmt = (sql) => db.prepare(sql)

  let bumpDepth = 0

  function bumpRevision() {
    if (bumpDepth > 0) return // 组合写入期间只算一次（见 withoutBump）
    db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'").run()
  }

  /** 把一组内部写入合并成一次 revision 递增（一次用户/AI 操作 = 一次递增） */
  function withoutBump(fn) {
    bumpDepth += 1
    try {
      return fn()
    } finally {
      bumpDepth -= 1
    }
  }
  function getRevision() {
    return Number(db.prepare("SELECT value FROM meta WHERE key = 'revision'").get().value)
  }
  function actor(a) {
    return ACTORS.has(a) ? a : 'user'
  }

  function subtreeIds(rootId) {
    return db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM nodes WHERE id = ?
           UNION ALL SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
         ) SELECT id FROM sub`
      )
      .all(rootId)
      .map((r) => r.id)
  }

  function rawNode(id) {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)
    if (!row) throw new AppError(CODES.NOT_FOUND, `节点 ${id} 不存在`, { id })
    return row
  }

  function buildPath(id) {
    const names = []
    let cur = id
    while (cur != null) {
      const row = db.prepare('SELECT id,name,parent_id FROM nodes WHERE id = ?').get(cur)
      if (!row) break
      names.unshift(row.name)
      cur = row.parent_id
    }
    return names.join('/')
  }

  function nodeVO(row) {
    return {
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      status: row.status,
      sort: row.sort,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      path: buildPath(row.id)
    }
  }

  function validateParent(type, parentId) {
    if (!Object.prototype.hasOwnProperty.call(CHILD_TYPES, type)) {
      throw new AppError(CODES.VALIDATION_FAILED, `未知节点类型 ${type}`, { type })
    }
    if (parentId == null) {
      if (type !== 'project') {
        throw new AppError(CODES.PARENT_TYPE_INVALID, `只有 project 可以没有父节点，${type} 必须挂在父节点下`, { type })
      }
      return null
    }
    const parent = rawNode(parentId)
    const allowedChildren = CHILD_TYPES[parent.type] || []
    if (allowedChildren.length === 0) {
      throw new AppError(CODES.LEAF_NODE, `${parent.type} 是叶子节点，不能再挂子节点`, { parentId })
    }
    if (!allowedChildren.includes(type)) {
      throw new AppError(CODES.PARENT_TYPE_INVALID, `${parent.type} 下不能挂 ${type}`, {
        type,
        parentType: parent.type,
        allowedChildren
      })
    }
    return parent
  }

  function createNode({ parentId = null, type, name, status = 'todo', attrs, actor: by = 'user' }) {
    if (!type) throw new AppError(CODES.VALIDATION_FAILED, 'type 必填')
    if (!name || !String(name).trim()) throw new AppError(CODES.VALIDATION_FAILED, 'name 必填', { field: 'name' })
    validateParent(type, parentId)
    const ts = now()
    const nextSort = db
      .prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM nodes WHERE IFNULL(parent_id,0) = IFNULL(?,0)')
      .get(parentId).s
    const info = db
      .prepare(
        'INSERT INTO nodes (type,parent_id,name,status,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(type, parentId, String(name).trim(), status, nextSort, ts, ts, actor(by), actor(by))
    const id = Number(info.lastInsertRowid)
    // 建节点 + 写属性 + 预置文档属于「一次操作」，只递增一次 revision
    withoutBump(() => {
      if (attrs) setAttrs(id, attrs, by)
      for (const docName of docPresetNames(type)) upsertDocument(id, docName, '', by)
    })
    bumpRevision()
    return nodeVO(rawNode(id))
  }

  const docPresetNames = (type) => docPresets[type] || []

  function updateNode(id, patch, by = 'user') {
    const cur = rawNode(id)
    const fields = []
    const args = []
    if (patch.name !== undefined) {
      if (!String(patch.name).trim()) throw new AppError(CODES.VALIDATION_FAILED, 'name 不能为空', { field: 'name' })
      fields.push('name = ?')
      args.push(String(patch.name).trim())
    }
    if (patch.status !== undefined) {
      fields.push('status = ?')
      args.push(patch.status)
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId === id) throw new AppError(CODES.CYCLE_DETECTED, '不能移动到自己下面')
      if (patch.parentId != null) {
        if (subtreeIds(id).includes(patch.parentId)) {
          throw new AppError(CODES.CYCLE_DETECTED, '不能移动到自己的后代下面', { id, parentId: patch.parentId })
        }
        validateParent(cur.type, patch.parentId)
      } else {
        validateParent(cur.type, null)
      }
      fields.push('parent_id = ?')
      args.push(patch.parentId)
    }
    fields.push('updated_at = ?', 'updated_by = ?')
    args.push(now(), actor(by))
    args.push(id)
    db.prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    if (patch.attrs) setAttrs(id, patch.attrs, by)
    bumpRevision()
    return nodeVO(rawNode(id))
  }

  function deleteNode(id) {
    rawNode(id)
    const ids = subtreeIds(id)
    const placeholders = ids.map(() => '?').join(',')
    const counts = {
      documents: db.prepare(`SELECT COUNT(*) c FROM documents WHERE node_id IN (${placeholders})`).get(...ids).c,
      attrValues: db.prepare(`SELECT COUNT(*) c FROM attr_values WHERE node_id IN (${placeholders})`).get(...ids).c,
      commits: db.prepare(`SELECT COUNT(*) c FROM commits WHERE node_id IN (${placeholders})`).get(...ids).c,
      mrs: db.prepare(`SELECT COUNT(*) c FROM mrs WHERE node_id IN (${placeholders})`).get(...ids).c,
      merges: db.prepare(`SELECT COUNT(*) c FROM merges WHERE node_id IN (${placeholders})`).get(...ids).c
    }
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id)
    bumpRevision()
    return { nodes: ids.length, ...counts }
  }

  function listChildren(parentId) {
    const rows =
      parentId == null
        ? db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL ORDER BY sort, id').all()
        : db.prepare('SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort, id').all(parentId)
    return rows.map((r) => ({
      ...nodeVO(r),
      childCount: db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent_id = ?').get(r.id).c
    }))
  }

  function listTree() {
    // 一次聚合查出每个节点的文档数与直接子节点数（表格列展示用，避免每行单独查询）
    const docCounts = new Map(
      db.prepare('SELECT node_id, COUNT(*) c FROM documents GROUP BY node_id').all().map((r) => [r.node_id, r.c])
    )
    const childCounts = new Map(
      db
        .prepare('SELECT parent_id, COUNT(*) c FROM nodes WHERE parent_id IS NOT NULL GROUP BY parent_id')
        .all()
        .map((r) => [r.parent_id, r.c])
    )
    const all = db
      .prepare('SELECT * FROM nodes ORDER BY sort, id')
      .all()
      .map((r) => ({
        ...nodeVO(r),
        children: [],
        docCount: docCounts.get(r.id) || 0,
        childCount: childCounts.get(r.id) || 0
      }))
    const byId = new Map(all.map((n) => [n.id, n]))
    const roots = []
    for (const n of all) {
      if (n.parentId == null) roots.push(n)
      else byId.get(n.parentId)?.children.push(n)
    }
    return roots
  }

  function resolveRef(ref) {
    const asText = String(ref ?? '').trim()
    if (asText === '') throw new AppError(CODES.PATH_NOT_FOUND, '引用为空', { ref })
    if (/^\d+$/.test(asText)) return nodeVO(rawNode(Number(asText)))

    const parts = asText.split('/').map((s) => s.trim()).filter(Boolean)
    let candidates = db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL').all()
    let cur = null
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]
      const matched = candidates.filter((n) => n.name === name)
      const walked = parts.slice(0, i + 1).join('/')
      if (matched.length === 0) {
        throw new AppError(CODES.PATH_NOT_FOUND, `路径不存在：${walked}`, { ref })
      }
      if (matched.length > 1) {
        throw new AppError(CODES.PATH_AMBIGUOUS, `路径歧义：${walked}，请改用 id 引用`, {
          ref,
          matchedIds: matched.map((m) => m.id)
        })
      }
      cur = matched[0]
      candidates = db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(cur.id)
    }
    return nodeVO(cur)
  }

  function reorderSiblings(parentId, orderedIds) {
    const ts = now()
    const upd = db.prepare('UPDATE nodes SET sort = ?, updated_at = ? WHERE id = ?')
    db.exec('BEGIN')
    try {
      orderedIds.forEach((id, idx) => upd.run((idx + 1) * 10, ts, id))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    bumpRevision()
    return listChildren(parentId)
  }

  const DATA_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'url'])

  function defVO(r) {
    return {
      id: r.id,
      nodeType: r.node_type,
      key: r.key,
      label: r.label,
      dataType: r.data_type,
      options: r.options ? JSON.parse(r.options) : null,
      required: !!r.required,
      defaultValue: r.default_value,
      sort: r.sort,
      enabled: !!r.enabled
    }
  }

  function listAttrDefs(nodeType, { includeDisabled = false } = {}) {
    const rows = nodeType
      ? db.prepare('SELECT * FROM attr_defs WHERE node_type = ? ORDER BY sort, id').all(nodeType)
      : db.prepare('SELECT * FROM attr_defs ORDER BY node_type, sort, id').all()
    return rows.map(defVO).filter((d) => includeDisabled || d.enabled)
  }

  function addAttrDef({
    nodeType,
    key,
    label,
    dataType = 'text',
    options = null,
    required = false,
    defaultValue = null,
    sort = 100
  }) {
    if (!nodeType || !key || !label) throw new AppError(CODES.VALIDATION_FAILED, 'nodeType / key / label 必填')
    if (!DATA_TYPES.has(dataType)) throw new AppError(CODES.VALIDATION_FAILED, `不支持的 dataType ${dataType}`, { dataType })
    const dup = db.prepare('SELECT id FROM attr_defs WHERE node_type = ? AND key = ?').get(nodeType, key)
    if (dup) throw new AppError(CODES.VALIDATION_FAILED, `${nodeType} 下已存在属性 ${key}`, { key })
    const ts = now()
    const info = db
      .prepare(
        'INSERT INTO attr_defs (node_type,key,label,data_type,options,required,default_value,sort,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)'
      )
      .run(
        nodeType,
        key,
        label,
        dataType,
        options ? JSON.stringify(options) : null,
        required ? 1 : 0,
        defaultValue,
        sort,
        ts,
        ts
      )
    bumpRevision()
    return defVO(db.prepare('SELECT * FROM attr_defs WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function updateAttrDef(id, patch) {
    const cur = db.prepare('SELECT * FROM attr_defs WHERE id = ?').get(id)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `属性定义 ${id} 不存在`, { id })
    const fields = []
    const args = []
    if (patch.label !== undefined) {
      fields.push('label = ?')
      args.push(patch.label)
    }
    if (patch.dataType !== undefined) {
      if (!DATA_TYPES.has(patch.dataType)) {
        throw new AppError(CODES.VALIDATION_FAILED, `不支持的 dataType ${patch.dataType}`)
      }
      fields.push('data_type = ?')
      args.push(patch.dataType)
    }
    if (patch.options !== undefined) {
      fields.push('options = ?')
      args.push(patch.options ? JSON.stringify(patch.options) : null)
    }
    if (patch.required !== undefined) {
      fields.push('required = ?')
      args.push(patch.required ? 1 : 0)
    }
    if (patch.defaultValue !== undefined) {
      fields.push('default_value = ?')
      args.push(patch.defaultValue)
    }
    if (patch.sort !== undefined) {
      fields.push('sort = ?')
      args.push(patch.sort)
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?')
      args.push(patch.enabled ? 1 : 0)
    }
    fields.push('updated_at = ?')
    args.push(now(), id)
    db.prepare(`UPDATE attr_defs SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    bumpRevision()
    return defVO(db.prepare('SELECT * FROM attr_defs WHERE id = ?').get(id))
  }

  function deleteAttrDef(id) {
    const cur = db.prepare('SELECT id FROM attr_defs WHERE id = ?').get(id)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `属性定义 ${id} 不存在`, { id })
    db.prepare('DELETE FROM attr_defs WHERE id = ?').run(id)
    bumpRevision()
    return { id }
  }

  function validateValue(def, value) {
    if (value == null || value === '') {
      if (def.required) {
        throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必填`, { key: def.key, required: true })
      }
      return null
    }
    const v = String(value)
    if (def.dataType === 'number' && Number.isNaN(Number(v))) {
      throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必须是数字`, { key: def.key, value: v })
    }
    if (def.dataType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必须是 YYYY-MM-DD`, { key: def.key, value: v })
    }
    if (def.dataType === 'select') {
      const allowed = (def.options || []).map((o) => String(o.value))
      if (!allowed.includes(v)) {
        throw new AppError(CODES.VALIDATION_FAILED, `属性「${def.label}」必须是 ${allowed.join(' / ')} 之一`, {
          key: def.key,
          value: v
        })
      }
    }
    return v
  }

  function setAttrs(nodeId, attrs, by = 'user') {
    const node = rawNode(nodeId)
    const defs = new Map(listAttrDefs(node.type).map((d) => [d.key, d]))
    const ts = now()
    db.exec('BEGIN')
    try {
      for (const [key, raw] of Object.entries(attrs || {})) {
        const def = defs.get(key)
        if (!def) throw new AppError(CODES.VALIDATION_FAILED, `属性 ${key} 不在 ${node.type} 的启用定义里（或已停用）`, { key })
        const value = validateValue(def, raw)
        const existing = db.prepare('SELECT id FROM attr_values WHERE node_id = ? AND attr_def_id = ?').get(nodeId, def.id)
        if (existing) {
          db.prepare('UPDATE attr_values SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(
            value,
            ts,
            actor(by),
            existing.id
          )
        } else {
          db.prepare('INSERT INTO attr_values (node_id,attr_def_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)').run(
            nodeId,
            def.id,
            value,
            ts,
            actor(by)
          )
        }
      }
      db.prepare('UPDATE nodes SET updated_at = ?, updated_by = ? WHERE id = ?').run(ts, actor(by), nodeId)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    bumpRevision()
    return getAttrs(nodeId)
  }

  function getAttrs(nodeId) {
    rawNode(nodeId)
    const rows = db
      .prepare(
        `SELECT d.key, d.label, d.data_type, d.options, v.value, v.updated_at, v.updated_by
           FROM attr_values v JOIN attr_defs d ON d.id = v.attr_def_id
          WHERE v.node_id = ?`
      )
      .all(nodeId)
    const out = {}
    for (const r of rows) out[r.key] = r.value
    Object.defineProperty(out, '__meta', {
      enumerable: false,
      value: Object.fromEntries(
        rows.map((r) => [
          r.key,
          { label: r.label, dataType: r.data_type, updatedAt: r.updated_at, updatedBy: r.updated_by }
        ])
      )
    })
    return out
  }

  function docVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      name: r.name,
      content: r.content,
      sort: r.sort,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      createdBy: r.created_by,
      updatedBy: r.updated_by
    }
  }

  function listDocuments(nodeId) {
    rawNode(nodeId)
    return db.prepare('SELECT * FROM documents WHERE node_id = ? ORDER BY sort, id').all(nodeId).map(docVO)
  }

  function createDocument(nodeId, name, content = '', by = 'user') {
    rawNode(nodeId)
    const docName = String(name || '').trim()
    if (!docName) throw new AppError(CODES.VALIDATION_FAILED, '文档名必填', { field: 'name' })
    const dup = db.prepare('SELECT id FROM documents WHERE node_id = ? AND name = ?').get(nodeId, docName)
    if (dup) throw new AppError(CODES.DOC_NAME_EXISTS, `节点下已存在文档「${docName}」`, { nodeId, name: docName })
    const ts = now()
    const sort = db.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM documents WHERE node_id = ?').get(nodeId).s
    const info = db
      .prepare(
        'INSERT INTO documents (node_id,name,content,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(nodeId, docName, String(content ?? ''), sort, ts, ts, actor(by), actor(by))
    bumpRevision()
    return docVO(db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function updateDocument(docId, patch, by = 'user') {
    const cur = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `文档 ${docId} 不存在`, { id: docId })
    const fields = []
    const args = []
    if (patch.name !== undefined) {
      const docName = String(patch.name || '').trim()
      if (!docName) throw new AppError(CODES.VALIDATION_FAILED, '文档名必填', { field: 'name' })
      const dup = db
        .prepare('SELECT id FROM documents WHERE node_id = ? AND name = ? AND id <> ?')
        .get(cur.node_id, docName, docId)
      if (dup) throw new AppError(CODES.DOC_NAME_EXISTS, `节点下已存在文档「${docName}」`, { name: docName })
      fields.push('name = ?')
      args.push(docName)
    }
    if (patch.content !== undefined) {
      fields.push('content = ?')
      args.push(String(patch.content ?? ''))
    }
    fields.push('updated_at = ?', 'updated_by = ?')
    args.push(now(), actor(by), docId)
    db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    bumpRevision()
    return docVO(db.prepare('SELECT * FROM documents WHERE id = ?').get(docId))
  }

  function upsertDocument(nodeId, name, content = null, by = 'user') {
    rawNode(nodeId)
    const docName = String(name || '').trim()
    if (!docName) throw new AppError(CODES.VALIDATION_FAILED, '文档名必填', { field: 'name' })
    const existing = db.prepare('SELECT * FROM documents WHERE node_id = ? AND name = ?').get(nodeId, docName)
    if (!existing) {
      const created = createDocument(nodeId, docName, content ?? '', by)
      return { id: created.id, created: true, name: docName }
    }
    if (content != null) updateDocument(existing.id, { content }, by)
    return { id: existing.id, created: false, name: docName }
  }

  function deleteDocument(docId) {
    const cur = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `文档 ${docId} 不存在`, { id: docId })
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId)
    bumpRevision()
    return { id: docId }
  }

  function reorderDocuments(nodeId, orderedIds) {
    rawNode(nodeId)
    const ts = now()
    const upd = db.prepare('UPDATE documents SET sort = ?, updated_at = ? WHERE id = ? AND node_id = ?')
    db.exec('BEGIN')
    try {
      orderedIds.forEach((id, idx) => upd.run((idx + 1) * 10, ts, id, nodeId))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    bumpRevision()
    return listDocuments(nodeId)
  }

  // ---------- commits（手工登记关联提交） ----------

  const SHA_RE = /^[0-9a-f]{7,40}$/i

  function commitVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      repo: r.repo,
      sha: r.sha,
      branch: r.branch,
      note: r.note,
      reviewStatus: r.review_status || 'pending',
      reviewNote: r.review_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      patchId: r.patch_id || null,
      createdAt: r.created_at
    }
  }

  /** 缓存 patch-id（重复检测用） */
  function setCommitPatchId(commitId, patchIdValue) {
    db.prepare('UPDATE commits SET patch_id = ? WHERE id = ?').run(patchIdValue, Number(commitId))
  }

  /** 全库提交（可限定 repo），带节点路径（用于跨节点重复关联） */
  function listCommitsWithNode({ repo = null } = {}) {
    const rows = repo
      ? db.prepare('SELECT * FROM commits WHERE repo = ? ORDER BY id').all(repo)
      : db.prepare('SELECT * FROM commits ORDER BY id').all()
    return rows.map((r) => ({ ...commitVO(r), nodePath: buildPath(r.node_id) }))
  }

  /** 沿 parent 链上溯，找第一个指定类型的祖先节点 */
  function findAncestorOfType(nodeId, type) {
    let cur = rawNode(nodeId)
    while (cur) {
      if (cur.type === type) return cur
      if (!cur.parent_id) return null
      cur = db.prepare('SELECT * FROM nodes WHERE id = ?').get(cur.parent_id)
    }
    return null
  }

  /**
   * 一键去重：删除重复登记（保留 keepId）。
   * 安全校验：removeIds 必须与 keep 同 repo，且 sha 相同或（非 merge 的）patch_id 相同
   */
  function dedupeCommits({ keepId, removeIds } = {}, by = 'user') {
    const keep = getCommit(Number(keepId))
    const ids = (Array.isArray(removeIds) ? removeIds : []).map((n) => Number(n)).filter(Number.isFinite)
    if (ids.length === 0) throw new AppError(CODES.VALIDATION_FAILED, 'removeIds 不能为空', {})
    const removed = []
    for (const id of ids) {
      if (id === keep.id) continue
      const c = getCommit(id)
      if (c.repo !== keep.repo) {
        throw new AppError(CODES.VALIDATION_FAILED, `提交 ${id} 与保留项仓库不同，不允许去重`, { id })
      }
      const sameSha = c.sha === keep.sha
      const samePatch = keep.patchId && c.patchId && keep.patchId !== '__merge__' && keep.patchId === c.patchId
      if (!sameSha && !samePatch) {
        throw new AppError(CODES.VALIDATION_FAILED, `提交 ${id} 与保留项不是重复关系（sha/patch-id 均不同），拒绝删除`, { id })
      }
      db.prepare('DELETE FROM commits WHERE id = ?').run(id)
      removed.push(id)
    }
    bumpRevision()
    return { kept: keep.id, removed }
  }

  function getCommit(id) {
    const r = db.prepare('SELECT * FROM commits WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `提交记录 ${id} 不存在`, { id })
    return commitVO(r)
  }

  function listCommits(nodeId, { subtree = false } = {}) {
    rawNode(nodeId)
    const ids = subtree ? subtreeIds(nodeId) : [nodeId]
    const ph = ids.map(() => '?').join(',')
    return db
      .prepare(`SELECT * FROM commits WHERE node_id IN (${ph}) ORDER BY created_at, id`)
      .all(...ids)
      .map(commitVO)
  }

  function addCommit(nodeId, { repo = null, sha, note = null, branch = null, overwriteBranch = false } = {}, by = 'user') {
    rawNode(nodeId)
    const s = String(sha || '').trim()
    if (!SHA_RE.test(s)) throw new AppError(CODES.VALIDATION_FAILED, 'sha 必须是 7–40 位十六进制', { sha: s })
    if (repo) {
      const known = db.prepare('SELECT id FROM repos WHERE name = ?').get(repo)
      if (!known) throw new AppError(CODES.REPO_NOT_REGISTERED, `仓库 ${repo} 未登记（先 repo add）`, { repo })
    }
    const existing = db.prepare('SELECT * FROM commits WHERE node_id = ? AND sha = ?').get(nodeId, s)
    if (existing) {
      // 已存在：补齐 branch（原来没有而这次给了）；overwriteBranch 时允许显式纠正已有值
      if (branch && (overwriteBranch ? branch !== existing.branch : !existing.branch)) {
        db.prepare('UPDATE commits SET branch = ? WHERE id = ?').run(branch, existing.id)
        bumpRevision()
        return { ...commitVO(db.prepare('SELECT * FROM commits WHERE id = ?').get(existing.id)), created: false }
      }
      return { ...commitVO(existing), created: false }
    }
    const ts = now()
    const info = db
      .prepare('INSERT INTO commits (node_id,repo,sha,branch,note,created_at) VALUES (?,?,?,?,?,?)')
      .run(nodeId, repo, s, branch, note, ts)
    bumpRevision()
    return { ...commitVO(db.prepare('SELECT * FROM commits WHERE id = ?').get(Number(info.lastInsertRowid))), created: true }
  }

  function removeCommit(commitId) {
    const cur = db.prepare('SELECT id FROM commits WHERE id = ?').get(commitId)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `提交记录 ${commitId} 不存在`, { id: commitId })
    db.prepare('DELETE FROM commits WHERE id = ?').run(commitId)
    bumpRevision()
    return { id: commitId }
  }

  /** 更新 commit 审查结果（pending / approved / issue）；pending 时清空审者信息 */
  function updateCommitReview(commitId, { reviewStatus, note = undefined } = {}, by = 'user') {
    if (!REVIEW_STATUSES.includes(reviewStatus)) {
      throw new AppError(CODES.VALIDATION_FAILED, `reviewStatus 必须是 ${REVIEW_STATUSES.join(' / ')}`, { reviewStatus })
    }
    const cur = db.prepare('SELECT * FROM commits WHERE id = ?').get(Number(commitId))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `提交记录 ${commitId} 不存在`, { id: commitId })
    const isPending = reviewStatus === 'pending'
    const reviewedBy = isPending ? null : by
    const reviewedAt = isPending ? null : now()
    if (note !== undefined) {
      db.prepare('UPDATE commits SET review_status=?, review_note=?, reviewed_by=?, reviewed_at=? WHERE id=?')
        .run(reviewStatus, note, reviewedBy, reviewedAt, cur.id)
    } else {
        db.prepare('UPDATE commits SET review_status=?, reviewed_by=?, reviewed_at=? WHERE id=?')
        .run(reviewStatus, reviewedBy, reviewedAt, cur.id)
    }
    bumpRevision()
    return commitVO(db.prepare('SELECT * FROM commits WHERE id = ?').get(cur.id))
  }

  // ---------- comments（diff 行级评论） ----------

  function commentVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      repo: r.repo,
      filePath: r.file_path,
      commitSha: r.commit_sha,
      lineStart: r.line_start,
      lineEnd: r.line_end,
      snippet: r.snippet,
      content: r.content,
      author: r.author,
      status: r.status,
      createdAt: r.created_at
    }
  }

  function createComment(nodeId, { repo = null, filePath, commitSha = null, lineStart = 0, lineEnd = 0, snippet = null, content }, by = 'user') {
    rawNode(nodeId)
    if (!content || !content.trim()) {
      throw new AppError(CODES.VALIDATION_FAILED, '评论内容不能为空', {})
    }
    const info = db
      .prepare('INSERT INTO comments (node_id,repo,file_path,commit_sha,line_start,line_end,snippet,content,author,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(nodeId, repo, filePath || '', commitSha, Number(lineStart) || 0, Number(lineEnd) || 0, snippet, content.trim(), actor(by), 'open', now())
    bumpRevision()
    return commentVO(db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function listComments(nodeId, { filePath = null } = {}) {
    rawNode(nodeId)
    if (filePath) {
      return db.prepare('SELECT * FROM comments WHERE node_id = ? AND file_path = ? ORDER BY line_start, id')
        .all(nodeId, filePath)
        .map(commentVO)
    }
    return db.prepare('SELECT * FROM comments WHERE node_id = ? ORDER BY file_path, line_start, id')
      .all(nodeId)
      .map(commentVO)
  }

  /** 按文件（可选 commit）全库查——插件在 diff 里展示时用 */
  function listCommentsByFile(filePath, { commitSha = null } = {}) {
    if (commitSha) {
      return db.prepare('SELECT * FROM comments WHERE file_path = ? AND commit_sha = ? ORDER BY line_start, id')
        .all(filePath, commitSha)
        .map(commentVO)
    }
    return db.prepare('SELECT * FROM comments WHERE file_path = ? ORDER BY line_start, id')
      .all(filePath)
      .map(commentVO)
  }

  function updateComment(id, { status = null, content = null } = {}) {
    const r = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(id))
    if (!r) {
      throw new AppError(CODES.NOT_FOUND, `评论 ${id} 不存在`, { id })
    }
    db.prepare('UPDATE comments SET status = ?, content = ? WHERE id = ?')
      .run(status || r.status, content != null ? content : r.content, Number(id))
    bumpRevision()
    return commentVO(db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(id)))
  }

  function deleteComment(id) {
    db.prepare('DELETE FROM comments WHERE id = ?').run(Number(id))
    bumpRevision()
  }

  // ---------- 回归测试闭环（AI 可回归测试用例 + 测试/验收报告） ----------
  //
  // 需求 → 概要设计/文档（走 documents）→ AI 可回归测试（test_cases）→ 测试/验收报告（test_reports）。
  // kind 是统一扩展轴：v1 实现 regression / acceptance；code_check / biz_check / release_check
  // 已在 CHECK 里占位，新增一类检查只加用例，不改表结构与入口。

  const TEST_CASE_KINDS = new Set(['regression', 'acceptance', 'code_check', 'biz_check', 'release_check'])

  function testCaseVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      name: r.name,
      kind: r.kind,
      prompt: r.prompt,
      expectation: r.expectation,
      enabled: !!r.enabled,
      sort: r.sort,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      createdBy: r.created_by,
      updatedBy: r.updated_by
    }
  }

  function assertCaseKind(kind) {
    if (!TEST_CASE_KINDS.has(kind)) {
      throw new AppError(CODES.VALIDATION_FAILED, `未知测试类型 ${kind}`, {
        kind,
        allowed: [...TEST_CASE_KINDS]
      })
    }
  }

  function createTestCase(nodeId, { name, kind = 'regression', prompt, expectation = null, enabled = 1 }, by = 'user') {
    rawNode(nodeId)
    if (!name || !String(name).trim()) throw new AppError(CODES.VALIDATION_FAILED, '测试用例名必填', { field: 'name' })
    if (!prompt || !String(prompt).trim()) {
      throw new AppError(CODES.VALIDATION_FAILED, '测试用例内容（prompt）必填', { field: 'prompt' })
    }
    assertCaseKind(kind)
    const dup = db.prepare('SELECT id FROM test_cases WHERE node_id = ? AND name = ?').get(nodeId, String(name).trim())
    if (dup) {
      throw new AppError(CODES.TEST_CASE_NAME_EXISTS, `测试用例已存在：${String(name).trim()}`, { name: String(name).trim() })
    }
    const ts = now()
    const sort = db.prepare('SELECT IFNULL(MAX(sort),0) + 10 s FROM test_cases WHERE node_id = ?').get(nodeId).s
    const info = db
      .prepare(
        'INSERT INTO test_cases (node_id,name,kind,prompt,expectation,enabled,sort,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(nodeId, String(name).trim(), kind, String(prompt).trim(), expectation, enabled ? 1 : 0, sort, ts, ts, actor(by), actor(by))
    bumpRevision()
    return testCaseVO(db.prepare('SELECT * FROM test_cases WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function listTestCases(nodeId, { kind = null, includeDisabled = false } = {}) {
    rawNode(nodeId)
    const rows = db.prepare('SELECT * FROM test_cases WHERE node_id = ? ORDER BY sort, id').all(nodeId)
    return rows
      .filter((r) => (kind ? r.kind === kind : true))
      .filter((r) => (includeDisabled ? true : !!r.enabled))
      .map(testCaseVO)
  }

  function getTestCase(id) {
    const r = db.prepare('SELECT * FROM test_cases WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `测试用例 ${id} 不存在`, { id })
    return testCaseVO(r)
  }

  /** 按用例名 get-or-create（幂等）：已存在则更新字段并返回 {created:false}，与文档 upsert 语义一致 */
  function upsertTestCase(nodeId, { name, kind = 'regression', prompt, expectation = null, enabled = 1 }, by = 'user') {
    rawNode(nodeId)
    const trimmed = name == null ? '' : String(name).trim()
    if (!trimmed) throw new AppError(CODES.VALIDATION_FAILED, '测试用例名必填', { field: 'name' })
    const cur = db.prepare('SELECT * FROM test_cases WHERE node_id = ? AND name = ?').get(nodeId, trimmed)
    if (!cur) return { ...createTestCase(nodeId, { name: trimmed, kind, prompt, expectation, enabled }, by), created: true }
    const updated = updateTestCase(cur.id, { kind, prompt, expectation, enabled }, by)
    return { ...updated, created: false }
  }

  function updateTestCase(id, { name = null, kind = null, prompt = null, expectation = undefined, enabled = null } = {}, by = 'user') {
    const cur = db.prepare('SELECT * FROM test_cases WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `测试用例 ${id} 不存在`, { id })
    if (kind != null) assertCaseKind(kind)
    if (name != null && !String(name).trim()) throw new AppError(CODES.VALIDATION_FAILED, '测试用例名不能为空', { field: 'name' })
    if (prompt != null && !String(prompt).trim()) throw new AppError(CODES.VALIDATION_FAILED, '测试用例内容不能为空', { field: 'prompt' })
    const nextName = name != null ? String(name).trim() : cur.name
    if (nextName !== cur.name) {
      const dup = db.prepare('SELECT id FROM test_cases WHERE node_id = ? AND name = ? AND id <> ?').get(cur.node_id, nextName, Number(id))
      if (dup) throw new AppError(CODES.TEST_CASE_NAME_EXISTS, `测试用例已存在：${nextName}`, { name: nextName })
    }
    db.prepare(
      'UPDATE test_cases SET name = ?, kind = ?, prompt = ?, expectation = ?, enabled = ?, updated_at = ?, updated_by = ? WHERE id = ?'
    ).run(
      nextName,
      kind || cur.kind,
      prompt != null ? String(prompt).trim() : cur.prompt,
      expectation !== undefined ? expectation : cur.expectation,
      enabled != null ? (enabled ? 1 : 0) : cur.enabled,
      now(),
      actor(by),
      Number(id)
    )
    bumpRevision()
    return testCaseVO(db.prepare('SELECT * FROM test_cases WHERE id = ?').get(Number(id)))
  }

  function deleteTestCase(id) {
    db.prepare('DELETE FROM test_cases WHERE id = ?').run(Number(id))
    bumpRevision()
  }

  function reorderTestCases(nodeId, orderedIds) {
    rawNode(nodeId)
    withoutBump(() => {
      orderedIds.forEach((id, i) => {
        db.prepare('UPDATE test_cases SET sort = ? WHERE id = ? AND node_id = ?').run((i + 1) * 10, Number(id), nodeId)
      })
    })
    bumpRevision()
    return listTestCases(nodeId, { includeDisabled: true })
  }

  function testReportVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      caseId: r.case_id,
      runId: r.run_id,
      kind: r.kind,
      status: r.status,
      summary: r.summary,
      detail: r.detail,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      updatedAt: r.updated_at,
      createdBy: r.created_by
    }
  }

  /** 开一条报告（一次执行 = 一行）；run_id 关联 agent 任务，便于从报告回看执行日志 */
  function createTestReport(nodeId, { caseId = null, runId = null, kind = 'regression', status = 'running', summary = null, detail = null }, by = 'user') {
    rawNode(nodeId)
    assertCaseKind(kind)
    const ts = now()
    const info = db
      .prepare(
        'INSERT INTO test_reports (node_id,case_id,run_id,kind,status,summary,detail,started_at,finished_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(nodeId, caseId, runId, kind, status, summary, detail, ts, status === 'running' ? null : ts, ts, actor(by))
    bumpRevision()
    return testReportVO(db.prepare('SELECT * FROM test_reports WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function listTestReports(nodeId, { caseId = null, kind = null, limit = 100 } = {}) {
    rawNode(nodeId)
    return db
      .prepare('SELECT * FROM test_reports WHERE node_id = ? ORDER BY id DESC LIMIT ?')
      .all(nodeId, Number(limit) || 100)
      .filter((r) => (caseId ? r.case_id === Number(caseId) : true))
      .filter((r) => (kind ? r.kind === kind : true))
      .map(testReportVO)
  }

  function getTestReport(id) {
    const r = db.prepare('SELECT * FROM test_reports WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `测试报告 ${id} 不存在`, { id })
    return testReportVO(r)
  }

  /** 回写报告终态（agent 任务结束 / 前台执行者回写时调用）；status=running 表示仍在进行 */
  function finishTestReport(id, { status, summary = undefined, detail = undefined, runId = undefined } = {}, by = 'user') {
    const cur = db.prepare('SELECT * FROM test_reports WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `测试报告 ${id} 不存在`, { id })
    const ts = now()
    db.prepare(
      'UPDATE test_reports SET status = ?, summary = ?, detail = ?, run_id = ?, finished_at = ?, updated_at = ?, created_by = ? WHERE id = ?'
    ).run(
      status || cur.status,
      summary !== undefined ? summary : cur.summary,
      detail !== undefined ? detail : cur.detail,
      runId !== undefined ? runId : cur.run_id,
      status && status !== 'running' ? ts : cur.finished_at,
      ts,
      actor(by),
      Number(id)
    )
    bumpRevision()
    return testReportVO(db.prepare('SELECT * FROM test_reports WHERE id = ?').get(Number(id)))
  }

  /**
   * 验收报告聚合：把节点（含可选子树）下的用例与报告汇总成一个可读结构 ——
   * 每个用例的最近一次结果 + 总体通过率 + 未覆盖用例清单。
   */
  function buildAcceptanceReport(nodeId, { scope = 'self' } = {}) {
    const root = rawNode(nodeId)
    const ids = scope === 'subtree' ? subtreeIds(nodeId) : [nodeId]
    const ph = ids.map(() => '?').join(',')
    const cases = db.prepare(`SELECT * FROM test_cases WHERE node_id IN (${ph}) ORDER BY node_id, sort, id`).all(...ids).map(testCaseVO)
    const reports = db.prepare(`SELECT * FROM test_reports WHERE node_id IN (${ph}) ORDER BY id DESC`).all(...ids).map(testReportVO)
    const latestByCase = new Map()
    for (const r of reports) {
      if (r.caseId == null) continue
      if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r)
    }
    const items = cases.map((c) => {
      const latest = latestByCase.get(c.id) || null
      return {
        caseId: c.id,
        nodeId: c.nodeId,
        name: c.name,
        kind: c.kind,
        expectation: c.expectation,
        latestStatus: latest ? latest.status : 'not_run',
        latestReportId: latest ? latest.id : null,
        latestAt: latest ? latest.updatedAt : null
      }
    })
    const ran = items.filter((i) => i.latestStatus !== 'not_run')
    const passed = items.filter((i) => i.latestStatus === 'pass')
    return {
      node: { id: root.id, name: root.name, type: root.type },
      scope,
      totals: {
        cases: items.length,
        run: ran.length,
        pass: passed.length,
        fail: items.filter((i) => i.latestStatus === 'fail').length,
        blocked: items.filter((i) => i.latestStatus === 'blocked' || i.latestStatus === 'error').length,
        notRun: items.length - ran.length
      },
      passRate: ran.length ? Math.round((passed.length / ran.length) * 1000) / 1000 : null,
      items,
      reports: reports.slice(0, 20)
    }
  }

  // ---------- agent 运行时管理（参考 multica agent_runtime / chat_session / agent_task_queue） ----------
  //
  // 三层模型：
  //   agent_runtimes  —— 机器级执行环境（daemon_id + provider 唯一），带 online/offline 心跳；
  //   agent_sessions  —— 节点上一个 agent 的连续对话（可 --resume 续跑同一个 CLI 会话）；
  //   agent_runs      —— 一次任务（队列条目），带 attempt/parent_run_id 重试链 + 消息流。

  const TERMINAL_RUN_STATUSES = new Set(['success', 'failed', 'timeout', 'cancelled'])
  const AGENT_OUTPUT_LIMIT = 200 * 1024
  const AGENT_HEARTBEAT_STALE_MS = 90 * 1000

  function parseJson(raw, fallback = {}) {
    if (raw == null || raw === '') return fallback
    try {
      const v = JSON.parse(raw)
      return v && typeof v === 'object' ? v : fallback
    } catch {
      return fallback
    }
  }

  function safeParse(s) {
    try {
      return JSON.parse(s)
    } catch {
      return s
    }
  }

  function runtimeVO(r) {
    if (!r) return null
    return {
      id: r.id,
      name: r.name,
      daemonId: r.daemon_id,
      runtimeMode: r.runtime_mode,
      provider: r.provider,
      status: r.status,
      deviceInfo: r.device_info,
      visibility: r.visibility,
      metadata: parseJson(r.metadata, {}),
      lastSeenAt: r.last_seen_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      createdBy: r.created_by
    }
  }

  function sessionVO(r) {
    if (!r) return null
    return {
      id: r.id,
      nodeId: r.node_id,
      agent: r.agent,
      runtimeId: r.runtime_id,
      title: r.title,
      cliSessionId: r.cli_session_id,
      workDir: r.work_dir,
      status: r.status,
      runCount: r.run_count,
      lastActivityAt: r.last_activity_at,
      createdAt: r.created_at,
      createdBy: r.created_by
    }
  }

  function agentRunVO(r) {
    return {
      id: r.id,
      nodeId: r.node_id,
      sessionId: r.session_id,
      runtimeId: r.runtime_id,
      agent: r.agent,
      model: r.model,
      prompt: r.prompt,
      cwd: r.cwd,
      status: r.status,
      output: r.output,
      exitCode: r.exit_code,
      attempt: r.attempt,
      maxAttempts: r.max_attempts,
      parentRunId: r.parent_run_id,
      failureReason: r.failure_reason,
      cliSessionId: r.cli_session_id,
      workDir: r.work_dir,
      priority: r.priority,
      resumed: !!r.resumed,
      waitReason: r.wait_reason,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      createdBy: r.created_by
    }
  }

  // ---------- 运行时 ----------

  /** 注册/更新运行时（按 daemon_id + provider 幂等 upsert；daemon 心跳也走这里） */
  function upsertRuntime({ name, daemonId, runtimeMode = 'local', provider = 'qodercli', status = 'online', deviceInfo = '', visibility = 'private', metadata = {} } = {}, by = 'system') {
    const d = String(daemonId || '').trim()
    const p = String(provider || '').trim()
    if (!d) throw new AppError(CODES.VALIDATION_FAILED, 'daemonId 不能为空', { field: 'daemonId' })
    if (!p) throw new AppError(CODES.VALIDATION_FAILED, 'provider 不能为空', { field: 'provider' })
    if (!['online', 'offline'].includes(status)) {
      throw new AppError(CODES.VALIDATION_FAILED, `status 非法：${status}`, { status })
    }
    const ts = now()
    const metaJson = JSON.stringify(metadata || {})
    const existing = db.prepare('SELECT * FROM agent_runtimes WHERE daemon_id = ? AND provider = ?').get(d, p)
    if (existing) {
      db.prepare(
        `UPDATE agent_runtimes SET name=?, runtime_mode=?, status=?, device_info=?, visibility=?, metadata=?,
           last_seen_at=CASE WHEN ?='online' THEN ? ELSE last_seen_at END, updated_at=? WHERE id=?`
      ).run(
        String(name || existing.name), runtimeMode, status, deviceInfo,
        visibility, metaJson, status, ts, ts, existing.id
      )
      bumpRevision()
      return runtimeVO(db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(existing.id))
    }
    const info = db
      .prepare(
        `INSERT INTO agent_runtimes (name,daemon_id,runtime_mode,provider,status,device_info,visibility,metadata,last_seen_at,created_at,updated_at,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(String(name || p), d, runtimeMode, p, status, deviceInfo, visibility, metaJson, status === 'online' ? ts : null, ts, ts, actor(by))
    bumpRevision()
    return runtimeVO(db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  /** 心跳：刷新 last_seen_at 并置 online。故意不 bumpRevision——心跳是高频噪声 */
  function heartbeatRuntime(id) {
    const r = db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `运行时 ${id} 不存在`, { id })
    const ts = now()
    db.prepare("UPDATE agent_runtimes SET status='online', last_seen_at=?, updated_at=? WHERE id=?").run(ts, ts, Number(id))
    return runtimeVO(db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(id)))
  }

  function setRuntimeStatus(id, status) {
    if (!['online', 'offline'].includes(status)) {
      throw new AppError(CODES.VALIDATION_FAILED, `status 非法：${status}`, { status })
    }
    const r = db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `运行时 ${id} 不存在`, { id })
    db.prepare('UPDATE agent_runtimes SET status=?, updated_at=? WHERE id=?').run(status, now(), Number(id))
    bumpRevision()
    return runtimeVO(db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(id)))
  }

  function getRuntime(id) {
    const r = db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `运行时 ${id} 不存在`, { id })
    return runtimeVO(r)
  }

  /** 运行时列表：读时收敛——把超时未心跳的 online 行降级为 offline，不需要后台任务 */
  function listRuntimes({ status = null } = {}) {
    const stale = new Date(Date.now() - AGENT_HEARTBEAT_STALE_MS).toISOString()
    db.prepare("UPDATE agent_runtimes SET status='offline', updated_at=? WHERE status='online' AND (last_seen_at IS NULL OR last_seen_at < ?)")
      .run(now(), stale)
    const rows = status
      ? db.prepare('SELECT * FROM agent_runtimes WHERE status = ? ORDER BY id ASC').all(status)
      : db.prepare('SELECT * FROM agent_runtimes ORDER BY id ASC').all()
    return rows.map(runtimeVO)
  }

  function deleteRuntime(id) {
    const r = db.prepare('SELECT * FROM agent_runtimes WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `运行时 ${id} 不存在`, { id })
    const active = db.prepare('SELECT COUNT(*) c FROM agent_runs WHERE runtime_id = ? AND finished_at IS NULL').get(Number(id)).c
    if (active > 0) {
      throw new AppError(CODES.VALIDATION_FAILED, `运行时 ${id} 仍有 ${active} 个未完成任务，不能删除`, { active })
    }
    // 历史行解绑（不级联删除任务历史），再删运行时本身
    db.prepare('UPDATE agent_runs SET runtime_id = NULL WHERE runtime_id = ?').run(Number(id))
    db.prepare('UPDATE agent_sessions SET runtime_id = NULL WHERE runtime_id = ?').run(Number(id))
    db.prepare('DELETE FROM agent_runtimes WHERE id = ?').run(Number(id))
    bumpRevision()
    return { ok: true, id: Number(id) }
  }

  // ---------- 会话 ----------

  /** 取/建该 (node, agent) 的活动会话（幂等；续跑同一会话时用它） */
  function ensureAgentSession(nodeId, { agent = 'qodercli', runtimeId = null, workDir = null, title = '' } = {}, by = 'user') {
    rawNode(nodeId)
    const existing = db
      .prepare("SELECT * FROM agent_sessions WHERE node_id = ? AND agent = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
      .get(Number(nodeId), agent)
    if (existing) {
      if (runtimeId && existing.runtime_id !== Number(runtimeId)) {
        db.prepare('UPDATE agent_sessions SET runtime_id = ? WHERE id = ?').run(Number(runtimeId), existing.id)
      }
      if (workDir && existing.work_dir !== workDir) {
        db.prepare('UPDATE agent_sessions SET work_dir = ? WHERE id = ?').run(workDir, existing.id)
      }
      return sessionVO(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(existing.id))
    }
    const info = db
      .prepare('INSERT INTO agent_sessions (node_id,agent,runtime_id,title,work_dir,status,run_count,last_activity_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(Number(nodeId), agent, runtimeId ? Number(runtimeId) : null, String(title || ''), workDir, 'active', 0, now(), now(), actor(by))
    bumpRevision()
    return sessionVO(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  /** 显式新建会话（不复用旧会话；「新会话」按钮用） */
  function createAgentSession(nodeId, { agent = 'qodercli', runtimeId = null, workDir = null, title = '' } = {}, by = 'user') {
    rawNode(nodeId)
    const info = db
      .prepare('INSERT INTO agent_sessions (node_id,agent,runtime_id,title,work_dir,status,run_count,last_activity_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(Number(nodeId), agent, runtimeId ? Number(runtimeId) : null, String(title || ''), workDir, 'active', 0, now(), now(), actor(by))
    bumpRevision()
    return sessionVO(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function getAgentSession(id) {
    const r = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `agent 会话 ${id} 不存在`, { id })
    return sessionVO(r)
  }

  function listAgentSessions(nodeId, { status = null, limit = 50 } = {}) {
    rawNode(nodeId)
    const rows = status
      ? db.prepare('SELECT * FROM agent_sessions WHERE node_id = ? AND status = ? ORDER BY COALESCE(last_activity_at, created_at) DESC LIMIT ?').all(Number(nodeId), status, Number(limit))
      : db.prepare('SELECT * FROM agent_sessions WHERE node_id = ? ORDER BY COALESCE(last_activity_at, created_at) DESC LIMIT ?').all(Number(nodeId), Number(limit))
    return rows.map(sessionVO)
  }

  function updateAgentSession(id, { title, status, cliSessionId, workDir } = {}) {
    const cur = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `agent 会话 ${id} 不存在`, { id })
    if (status && !['active', 'archived'].includes(status)) {
      throw new AppError(CODES.VALIDATION_FAILED, `status 非法：${status}`, { status })
    }
    db.prepare('UPDATE agent_sessions SET title=?, status=?, cli_session_id=?, work_dir=? WHERE id=?').run(
      title !== undefined ? String(title) : cur.title,
      status !== undefined ? status : cur.status,
      cliSessionId !== undefined ? cliSessionId : cur.cli_session_id,
      workDir !== undefined ? workDir : cur.work_dir,
      Number(id)
    )
    bumpRevision()
    return sessionVO(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(Number(id)))
  }

  function archiveAgentSession(id) {
    return updateAgentSession(id, { status: 'archived' })
  }

  // ---------- 任务（run） ----------

  function touchSession(sessionId, ts) {
    if (!sessionId) return
    db.prepare('UPDATE agent_sessions SET run_count = run_count + 1, last_activity_at = ? WHERE id = ?').run(ts, Number(sessionId))
  }

  /**
   * 创建任务。sessionId 缺省时自动挂到该 (node, agent) 的活动会话（没有就建）；
   * parentRunId + attempt 构成重试链；resumed 表示这次是续跑同一个 CLI 会话。
   */
  function createAgentRun(
    nodeId,
    {
      agent = 'qodercli',
      model = 'DeepSeek-Flash',
      prompt,
      cwd = null,
      sessionId = null,
      runtimeId = null,
      attempt = 1,
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
      parentRunId = null,
      priority = 0,
      resumed = false
    } = {},
    by = 'user'
  ) {
    rawNode(nodeId)
    const p = String(prompt || '').trim()
    if (!p) throw new AppError(CODES.VALIDATION_FAILED, 'prompt 不能为空', { field: 'prompt' })
    const maxA = Number(maxAttempts)
    if (!Number.isInteger(maxA) || maxA < 1) {
      throw new AppError(CODES.VALIDATION_FAILED, `maxAttempts 必须是 ≥1 的整数，收到：${maxAttempts}`, { maxAttempts })
    }
    const attemptA = Number(attempt)
    if (!Number.isInteger(attemptA) || attemptA < 1) {
      throw new AppError(CODES.VALIDATION_FAILED, `attempt 必须是 ≥1 的整数，收到：${attempt}`, { attempt })
    }
    const ts = now()
    let sid = sessionId ? Number(sessionId) : null
    if (sid) {
      const s = db.prepare('SELECT id FROM agent_sessions WHERE id = ?').get(sid)
      if (!s) throw new AppError(CODES.NOT_FOUND, `agent 会话 ${sid} 不存在`, { sessionId: sid })
    } else {
      sid = ensureAgentSession(nodeId, { agent, runtimeId, workDir: cwd }, by).id
    }
    const info = db
      .prepare(
        `INSERT INTO agent_runs (node_id,session_id,runtime_id,agent,model,prompt,cwd,status,attempt,max_attempts,parent_run_id,priority,resumed,started_at,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        Number(nodeId), sid, runtimeId ? Number(runtimeId) : null, agent, model, p, cwd,
        'running', attemptA, maxA,
        parentRunId ? Number(parentRunId) : null, Number(priority) || 0, resumed ? 1 : 0, ts, actor(by)
      )
    touchSession(sid, ts)
    bumpRevision()
    return agentRunVO(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  /**
   * 追加执行输出（限 200KB）。
   * 大块 stdout 会按「无换行 + ≤4KB」切成多条 text 消息，落进消息流——
   * 这样 UI 可以按 seq 增量拉取，而不是每次整块重读 output 字段。
   */
  function appendAgentRunOutput(id, chunk) {
    const cur = db.prepare('SELECT output FROM agent_runs WHERE id = ?').get(Number(id))
    if (!cur) return
    const base = cur.output || ''
    if (base.length >= AGENT_OUTPUT_LIMIT) return
    const next = (base + chunk).slice(0, AGENT_OUTPUT_LIMIT)
    db.prepare('UPDATE agent_runs SET output = ? WHERE id = ?').run(next, Number(id))
  }

  /**
   * 追加一条任务消息（事件流；参考 multica task_message）。seq 服务端自增，保证顺序稳定。
   * 「读 MAX + 写」必须包在同一个写事务里，否则 MCP/CLI 等独立进程并发追加同一条任务时
   * 会各自读到同一个 MAX，撞 UNIQUE(run_id, seq)。BEGIN IMMEDIATE 让写事务一开始就持写锁，
   * 并在拿不到锁时按 busy_timeout + 重试兜底。
   */
  function appendAgentRunMessage(runId, { type, tool = null, content = null, input = null, output = null } = {}) {
    const rid = Number(runId)
    const run = db.prepare('SELECT id FROM agent_runs WHERE id = ?').get(rid)
    if (!run) throw new AppError(CODES.NOT_FOUND, `agent 任务 ${runId} 不存在`, { id: runId })
    const t = String(type || '').trim()
    if (!t) throw new AppError(CODES.VALIDATION_FAILED, '消息 type 不能为空', { field: 'type' })
    const ts = now()
    const inputVal = input == null ? null : (typeof input === 'string' ? input : JSON.stringify(input))
    const insertStmt = db.prepare(
      'INSERT INTO agent_run_messages (run_id,seq,type,tool,content,input,output,created_at) VALUES (?,?,?,?,?,?,?,?)'
    )
    const maxStmt = db.prepare('SELECT COALESCE(MAX(seq), 0) s FROM agent_run_messages WHERE run_id = ?')
    const insertNext = () => {
      const seq = (maxStmt.get(rid).s || 0) + 1
      const info = insertStmt.run(rid, seq, t, tool, content, inputVal, output, ts)
      return { seq, id: Number(info.lastInsertRowid) }
    }

    let inserted
    if (db.isTransaction) {
      // 调用方已经开了事务，直接复用（此时写锁已在调用方事务里）
      inserted = insertNext()
    } else {
      let lastErr
      for (let i = 0; i <= SQLITE_BUSY_RETRIES; i++) {
        try {
          db.exec('BEGIN IMMEDIATE')
        } catch (e) {
          if (isSqliteBusy(e) && i < SQLITE_BUSY_RETRIES) {
            sleepSync(SQLITE_BUSY_RETRY_MS)
            continue
          }
          throw e
        }
        try {
          inserted = insertNext()
          db.exec('COMMIT')
          lastErr = null
          break
        } catch (e) {
          try {
            db.exec('ROLLBACK')
          } catch {
            /* 事务已结束则忽略 */
          }
          lastErr = e
          if (isSqliteBusy(e) && i < SQLITE_BUSY_RETRIES) {
            sleepSync(SQLITE_BUSY_RETRY_MS)
            continue
          }
          throw e
        }
      }
      if (lastErr) throw lastErr
      if (!inserted) throw new AppError(CODES.VALIDATION_FAILED, '消息写入失败', { id: runId })
    }

    const { seq, id } = inserted
    return {
      id,
      runId: rid,
      seq,
      type: t,
      tool,
      content,
      input: inputVal == null ? null : (typeof input === 'string' ? safeParse(inputVal) : input),
      output,
      createdAt: ts
    }
  }

  function listAgentRunMessages(runId, { sinceSeq = 0 } = {}) {
    const run = db.prepare('SELECT id FROM agent_runs WHERE id = ?').get(Number(runId))
    if (!run) throw new AppError(CODES.NOT_FOUND, `agent 任务 ${runId} 不存在`, { id: runId })
    return db
      .prepare('SELECT * FROM agent_run_messages WHERE run_id = ? AND seq > ? ORDER BY seq ASC')
      .all(Number(runId), Number(sinceSeq) || 0)
      .map((m) => ({
        id: m.id,
        runId: m.run_id,
        seq: m.seq,
        type: m.type,
        tool: m.tool,
        content: m.content,
        input: m.input == null ? null : safeParse(m.input),
        output: m.output,
        createdAt: m.created_at
      }))
  }

  /**
   * 收尾任务。cliSessionId/workDir 会沉淀到所属会话，供下次 --resume 续跑。
   * failureReason 用 multica 的分类口径（runtime_recovery / timeout / agent_error…）。
   */
  function finishAgentRun(id, { status, exitCode = null, failureReason = null, cliSessionId = null, workDir = null } = {}) {
    if (!TERMINAL_RUN_STATUSES.has(status)) {
      throw new AppError(CODES.VALIDATION_FAILED, `status 非法：${status}`, { status })
    }
    const cur = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `agent 任务 ${id} 不存在`, { id })
    const ts = now()
    db.prepare(
      'UPDATE agent_runs SET status=?, exit_code=?, failure_reason=?, cli_session_id=?, work_dir=?, finished_at=? WHERE id=?'
    ).run(
      status, exitCode, failureReason,
      cliSessionId !== null ? cliSessionId : cur.cli_session_id,
      workDir !== null ? workDir : cur.work_dir,
      ts, Number(id)
    )
    // 会话级的「记忆」：把 CLI 会话号与工作目录沉淀到 session，供 --resume 续跑
    if (cur.session_id) {
      const s = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(cur.session_id)
      if (s) {
        db.prepare('UPDATE agent_sessions SET cli_session_id=?, work_dir=?, last_activity_at=? WHERE id=?').run(
          cliSessionId !== null ? cliSessionId : s.cli_session_id,
          workDir !== null ? workDir : s.work_dir,
          ts,
          cur.session_id
        )
      }
    }
    bumpRevision()
    return agentRunVO(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(id)))
  }

  /** 取消任务（把未结束任务置 cancelled；参考 multica 的 cancelled 语义） */
  function cancelAgentRun(id, { reason = 'manual' } = {}) {
    const cur = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `agent 任务 ${id} 不存在`, { id })
    if (TERMINAL_RUN_STATUSES.has(cur.status)) return agentRunVO(cur)
    db.prepare("UPDATE agent_runs SET status='cancelled', failure_reason=?, finished_at=? WHERE id=?").run(reason, now(), Number(id))
    bumpRevision()
    return agentRunVO(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(id)))
  }

  /** 重试：新建一条 attempt+1 的子任务，回头指向原任务（参考 multica 的 parent_task_id） */
  function retryAgentRun(id, { by = 'user' } = {}) {
    const cur = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `agent 任务 ${id} 不存在`, { id })
    if (!TERMINAL_RUN_STATUSES.has(cur.status)) {
      throw new AppError(CODES.VALIDATION_FAILED, `任务 ${id} 尚未结束（${cur.status}），不能重试`, { status: cur.status })
    }
    // max_attempts 是硬上限：已用满最后一次尝试后拒绝重试，避免无限重试链
    const attempt = Number(cur.attempt) || 1
    const maxAttempts = Number(cur.max_attempts) || 1
    if (attempt >= maxAttempts) {
      throw new AppError(
        CODES.VALIDATION_FAILED,
        `任务 ${id} 已达重试上限（第 ${attempt} 次 / 上限 ${maxAttempts} 次），不能再重试`,
        { attempt, maxAttempts }
      )
    }
    return createAgentRun(
      cur.node_id,
      {
        agent: cur.agent,
        model: cur.model,
        prompt: cur.prompt,
        cwd: cur.cwd,
        sessionId: cur.session_id,
        runtimeId: cur.runtime_id,
        attempt: attempt + 1,
        maxAttempts,
        parentRunId: cur.id,
        priority: cur.priority || 0,
        // 会话已有 CLI 会话号时，重试即续跑同一段对话
        resumed: !!cur.cli_session_id
      },
      by
    )
  }

  function getAgentRun(id) {
    const r = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(Number(id))
    if (!r) throw new AppError(CODES.NOT_FOUND, `agent 运行记录 ${id} 不存在`, { id })
    return agentRunVO(r)
  }

  function listAgentRuns(nodeId, { limit = 20, sessionId = null } = {}) {
    rawNode(nodeId)
    const rows = sessionId
      ? db.prepare('SELECT * FROM agent_runs WHERE node_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?').all(Number(nodeId), Number(sessionId), Number(limit))
      : db.prepare('SELECT * FROM agent_runs WHERE node_id = ? ORDER BY id DESC LIMIT ?').all(Number(nodeId), Number(limit))
    return rows.map(agentRunVO)
  }

  /** 最近一次任务（用于「继续上次会话」） */
  function latestAgentRun(nodeId, { agent = null } = {}) {
    rawNode(nodeId)
    const row = agent
      ? db.prepare('SELECT * FROM agent_runs WHERE node_id = ? AND agent = ? ORDER BY id DESC LIMIT 1').get(Number(nodeId), agent)
      : db.prepare('SELECT * FROM agent_runs WHERE node_id = ? ORDER BY id DESC LIMIT 1').get(Number(nodeId))
    return row ? agentRunVO(row) : null
  }

  /** 运行时总览统计（运行时页卡片用） */
  function agentRuntimeSummary() {
    const runtimes = listRuntimes()
    const active = db.prepare('SELECT COUNT(*) c FROM agent_runs WHERE finished_at IS NULL').get().c
    const sessions = db.prepare("SELECT COUNT(*) c FROM agent_sessions WHERE status = 'active'").get().c
    return {
      runtimes: runtimes.length,
      online: runtimes.filter((r) => r.status === 'online').length,
      activeRuns: active,
      activeSessions: sessions
    }
  }

  /** 服务启动时调用：把残留的 running 标记为 failed（子进程已随服务退出） */
  function failStaleAgentRuns() {
    const ts = now()
    const info = db
      .prepare("UPDATE agent_runs SET status='failed', failure_reason='runtime_recovery', output=COALESCE(output,'') || ?, finished_at=? WHERE status='running'")
      .run('\n[task-board] 服务重启，本次运行已中断\n', ts)
    // 重启后没有任何 daemon 在线：把在线行收敛为离线，等下次心跳恢复
    db.prepare("UPDATE agent_runtimes SET status='offline', updated_at=? WHERE status='online'").run(ts)
    if (info.changes > 0) bumpRevision()
    return { cleared: info.changes }
  }

  // ---------- 网页 → IDEA 打开请求（IDE 桥） ----------

  function ideRequestVO(r) {
    let payload = {}
    try {
      payload = JSON.parse(r.payload || '{}')
    } catch {
      payload = {}
    }
    return { id: r.id, kind: r.kind, status: r.status, ...payload, createdAt: r.created_at, handledAt: r.handled_at }
  }

  /** 网页端：请求 IDEA 打开 diff（cids 必填；commits 明细在此补全供插件直接使用） */
  function createIdeRequest(kind, payload, by = 'user') {
    if (kind !== 'open-diff') {
      throw new AppError(CODES.VALIDATION_FAILED, `不支持的 kind: ${kind}`, { kind })
    }
    const cids = ((payload && Array.isArray(payload.cids)) ? payload.cids : []).map((n) => Number(n)).filter(Number.isFinite)
    if (cids.length === 0) throw new AppError(CODES.VALIDATION_FAILED, 'cids 不能为空', {})
    const commits = cids.map((cid) => {
      const c = getCommit(cid)
      return { cid: c.id, sha: c.sha, repo: c.repo, note: c.note }
    })
    const body = JSON.stringify({
      cids,
      commits,
      path: (payload && payload.path) || null,
      title: (payload && payload.title) || null,
      requestedBy: actor(by)
    })
    const info = db
      .prepare('INSERT INTO ide_requests (kind,payload,status,created_at) VALUES (?,?,?,?)')
      .run(kind, body, 'pending', now())
    bumpRevision()
    return ideRequestVO(db.prepare('SELECT * FROM ide_requests WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  const IDE_REQUEST_TTL_MS = 10 * 60 * 1000
  const IDE_PROCESSING_TIMEOUT_MS = 30 * 1000

  /** IDEA 插件轮询领取：重置卡住的 processing + 过期清理 + 领最早的 pending 置为 processing */
  function claimNextIdeRequest() {
    const ts = now()
    db.prepare("UPDATE ide_requests SET status='pending' WHERE status='processing' AND handled_at < ?")
      .run(new Date(Date.now() - IDE_PROCESSING_TIMEOUT_MS).toISOString())
    db.prepare("UPDATE ide_requests SET status='expired', handled_at=? WHERE status IN ('pending','processing') AND created_at < ?")
      .run(ts, new Date(Date.now() - IDE_REQUEST_TTL_MS).toISOString())
    const row = db.prepare("SELECT * FROM ide_requests WHERE status='pending' ORDER BY id LIMIT 1").get()
    if (!row) return null
    db.prepare("UPDATE ide_requests SET status='processing', handled_at=? WHERE id=?").run(ts, row.id)
    return ideRequestVO({ ...row, status: 'processing' })
  }

  /** 插件处理完成回报（done / failed） */
  function completeIdeRequest(id, { status = 'done' } = {}) {
    if (!['done', 'failed'].includes(status)) {
      throw new AppError(CODES.VALIDATION_FAILED, `status 非法：${status}`, { status })
    }
    const cur = db.prepare('SELECT * FROM ide_requests WHERE id = ?').get(Number(id))
    if (!cur) throw new AppError(CODES.NOT_FOUND, `ide 请求 ${id} 不存在`, { id })
    db.prepare('UPDATE ide_requests SET status=?, handled_at=? WHERE id=?').run(status, now(), cur.id)
    return ideRequestVO(db.prepare('SELECT * FROM ide_requests WHERE id = ?').get(cur.id))
  }

  // ---------- repos（仓库登记） ----------

  function repoVO(r) {
    return {
      id: r.id,
      name: r.name,
      localPath: r.local_path,
      gitlabProject: r.gitlab_project,
      note: r.note,
      tags: r.tags,
      testBranch: r.test_branch,
      preBranch: r.pre_branch,
      releaseBranch: r.release_branch,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  }

  function listRepos() {
    return db.prepare('SELECT * FROM repos ORDER BY name').all().map(repoVO)
  }

  function addRepo({ name, localPath = null, gitlabProject = null, note = null, tags = null, testBranch = null, preBranch = null, releaseBranch = null } = {}) {
    const n = String(name || '').trim()
    if (!n) throw new AppError(CODES.VALIDATION_FAILED, '仓库名必填', { field: 'name' })
    const dup = db.prepare('SELECT id FROM repos WHERE name = ?').get(n)
    if (dup) throw new AppError(CODES.VALIDATION_FAILED, `仓库 ${n} 已登记`, { name: n })
    const ts = now()
    const info = db
      .prepare('INSERT INTO repos (name,local_path,gitlab_project,note,tags,test_branch,pre_branch,release_branch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(n, localPath, gitlabProject, note, tags, testBranch, preBranch, releaseBranch, ts, ts)
    bumpRevision()
    return repoVO(db.prepare('SELECT * FROM repos WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function updateRepo(id, patch) {
    const cur = db.prepare('SELECT * FROM repos WHERE id = ?').get(id)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `仓库 ${id} 不存在`, { id })
    const fields = []
    const args = []
    const map = { localPath: 'local_path', gitlabProject: 'gitlab_project', note: 'note', name: 'name', tags: 'tags', testBranch: 'test_branch', preBranch: 'pre_branch', releaseBranch: 'release_branch' }
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) {
        fields.push(`${col} = ?`)
        args.push(patch[k])
      }
    }
    if (fields.length === 0) return repoVO(cur)
    fields.push('updated_at = ?')
    args.push(now(), id)
    db.prepare(`UPDATE repos SET ${fields.join(', ')} WHERE id = ?`).run(...args)
    bumpRevision()
    return repoVO(db.prepare('SELECT * FROM repos WHERE id = ?').get(id))
  }

  function deleteRepo(id) {
    const cur = db.prepare('SELECT id FROM repos WHERE id = ?').get(id)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `仓库 ${id} 不存在`, { id })
    db.prepare('DELETE FROM repos WHERE id = ?').run(id)
    bumpRevision()
    return { id }
  }

  // ---------- 标签级分支配置（仓库通过 tags 继承） ----------

  function branchConfigVO(r) {
    return {
      id: r.id,
      tag: r.tag,
      testBranch: r.test_branch,
      preBranch: r.pre_branch,
      releaseBranch: r.release_branch,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  }

  function listBranchConfigs() {
    return db.prepare('SELECT * FROM branch_configs ORDER BY tag').all().map(branchConfigVO)
  }

  function upsertBranchConfig(tag, { testBranch = null, preBranch = null, releaseBranch = null } = {}) {
    const t = String(tag || '').trim()
    if (!t) throw new AppError(CODES.VALIDATION_FAILED, '标签名必填', { field: 'tag' })
    const cur = db.prepare('SELECT * FROM branch_configs WHERE tag = ?').get(t)
    const ts = now()
    if (cur) {
      db.prepare('UPDATE branch_configs SET test_branch=?, pre_branch=?, release_branch=?, updated_at=? WHERE id=?')
        .run(testBranch, preBranch, releaseBranch, ts, cur.id)
      bumpRevision()
      return branchConfigVO(db.prepare('SELECT * FROM branch_configs WHERE id = ?').get(cur.id))
    }
    const info = db
      .prepare('INSERT INTO branch_configs (tag,test_branch,pre_branch,release_branch,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(t, testBranch, preBranch, releaseBranch, ts, ts)
    bumpRevision()
    return branchConfigVO(db.prepare('SELECT * FROM branch_configs WHERE id = ?').get(Number(info.lastInsertRowid)))
  }

  function deleteBranchConfig(tag) {
    const t = String(tag || '').trim()
    const cur = db.prepare('SELECT * FROM branch_configs WHERE tag = ?').get(t)
    if (!cur) throw new AppError(CODES.NOT_FOUND, `标签配置 ${t} 不存在`, { tag: t })
    db.prepare('DELETE FROM branch_configs WHERE id = ?').run(cur.id)
    bumpRevision()
    return { id: cur.id }
  }

  /**
   * 解析仓库的追踪目标：仓库级（任一非空）优先；否则按 repo.tags 顺序取第一个有配置的标签
   * 返回 { test, pre, release, source }（source: 'repo' | 'tag:<名>' | null）
   */
  function resolveBranchTargets(repo) {
    const own = { test: repo.testBranch || null, pre: repo.preBranch || null, release: repo.releaseBranch || null }
    if (own.test || own.pre || own.release) return { ...own, source: 'repo' }
    const tags = String(repo.tags || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const tag of tags) {
      const cfg = db.prepare('SELECT * FROM branch_configs WHERE tag = ?').get(tag)
      if (cfg && (cfg.test_branch || cfg.pre_branch || cfg.release_branch)) {
        return { test: cfg.test_branch, pre: cfg.pre_branch, release: cfg.release_branch, source: `tag:${tag}` }
      }
    }
    return { test: null, pre: null, release: null, source: null }
  }

  return {
    db,
    // nodes
    createNode,
    updateNode,
    deleteNode,
    getNode: (id) => nodeVO(rawNode(id)),
    resolveRef,
    listChildren,
    listTree,
    reorderSiblings,
    subtreeIds,
    // attrs / documents
    setAttrs,
    getAttrs,
    listAttrDefs,
    addAttrDef,
    updateAttrDef,
    deleteAttrDef,
    listDocuments,
    createDocument,
    updateDocument,
    upsertDocument,
    deleteDocument,
    reorderDocuments,
    docPresetNames,
    // commits
    getCommit,
    listCommits,
    addCommit,
    removeCommit,
    updateCommitReview,
    setCommitPatchId,
    listCommitsWithNode,
    findAncestorOfType,
    dedupeCommits,
    // comments（diff 行级评论）
    createComment,
    listComments,
    listCommentsByFile,
    updateComment,
    deleteComment,
    // 回归测试闭环（AI 可回归测试用例 + 测试/验收报告）
    TEST_CASE_KINDS,
    createTestCase,
    listTestCases,
    getTestCase,
    upsertTestCase,
    updateTestCase,
    deleteTestCase,
    reorderTestCases,
    createTestReport,
    listTestReports,
    getTestReport,
    finishTestReport,
    buildAcceptanceReport,
    // agent 运行时管理
    upsertRuntime,
    heartbeatRuntime,
    setRuntimeStatus,
    getRuntime,
    listRuntimes,
    deleteRuntime,
    agentRuntimeSummary,
    // agent 会话
    ensureAgentSession,
    createAgentSession,
    getAgentSession,
    listAgentSessions,
    updateAgentSession,
    archiveAgentSession,
    // agent 任务（runs）+ 消息流
    createAgentRun,
    appendAgentRunOutput,
    appendAgentRunMessage,
    listAgentRunMessages,
    finishAgentRun,
    cancelAgentRun,
    retryAgentRun,
    getAgentRun,
    listAgentRuns,
    latestAgentRun,
    failStaleAgentRuns,
    // IDE 桥（网页 → IDEA 打开 diff）
    createIdeRequest,
    claimNextIdeRequest,
    completeIdeRequest,
    // repos
    listRepos,
    addRepo,
    updateRepo,
    deleteRepo,
    // branch configs（标签级）
    listBranchConfigs,
    upsertBranchConfig,
    deleteBranchConfig,
    resolveBranchTargets,
    // revision
    getRevision,
    bumpRevision
  }
}
