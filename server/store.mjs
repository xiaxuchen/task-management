import { AppError, CODES } from './errors.mjs'
import { CHILD_TYPES, LEAF_TYPES } from './db.mjs'

const ACTORS = new Set(['user', 'ai', 'cli', 'import'])
const now = () => new Date().toISOString()

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

  function bumpRevision() {
    db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'").run()
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
    if (attrs) setAttrs(id, attrs, by)
    for (const docName of docPresetNames(type)) upsertDocument(id, docName, '', by)
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
    const all = db
      .prepare('SELECT * FROM nodes ORDER BY sort, id')
      .all()
      .map((r) => ({ ...nodeVO(r), children: [] }))
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
    // revision
    getRevision,
    bumpRevision
  }
}
