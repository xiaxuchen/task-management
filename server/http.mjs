import express from 'express'
import { AppError, CODES } from './errors.mjs'
import { buildSchema, renderTreeMd, upsertByPath, importOutline, applyBatch } from './ops.mjs'
import { loadConfig, saveConfig, maskToken } from './config.mjs'

const STATUS_BY_CODE = {
  [CODES.VALIDATION_FAILED]: 400,
  [CODES.PARENT_TYPE_INVALID]: 400,
  [CODES.LEAF_NODE]: 400,
  [CODES.CYCLE_DETECTED]: 400,
  [CODES.CONFIRM_REQUIRED]: 400,
  [CODES.REPO_NOT_REGISTERED]: 400,
  [CODES.REPO_PATH_MISSING]: 400,
  [CODES.BRANCH_NOT_FOUND]: 400,
  [CODES.BRANCH_EXISTS_DIFFERENT_BASE]: 400,
  [CODES.WORKTREE_PATH_EXISTS]: 409,
  [CODES.NOT_FOUND]: 404,
  [CODES.PATH_NOT_FOUND]: 404,
  [CODES.PATH_AMBIGUOUS]: 409,
  [CODES.DOC_NAME_EXISTS]: 409,
  [CODES.UPLOAD_INVALID_TYPE]: 400,
  [CODES.UPLOAD_TOO_LARGE]: 400,
  [CODES.GITLAB_NOT_CONFIGURED]: 400,
  [CODES.GITLAB_AUTH_FAILED]: 502,
  [CODES.GITLAB_PROJECT_NOT_FOUND]: 502,
  [CODES.GITLAB_UNAVAILABLE]: 502,
  [CODES.GIT_UNAVAILABLE]: 500,
  [CODES.GIT_FAILED]: 500
}

/** 统一的错误体：{ error: { code, message, details } } */
function errorBody(err) {
  const code = err.code || 'INTERNAL_ERROR'
  return { error: { code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } }
}

export function createApp({ store }) {
  const app = express()
  app.use(express.json({ limit: '20mb' }))

  const wrap = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res)
      if (out && typeof out.then === 'function') out.catch(next)
    } catch (e) {
      next(e)
    }
  }
  const refOf = (req) => req.params.id
  const actorOf = (req) => (req.get('x-taskboard-actor') || req.body?.actor || req.query.actor || 'user')

  // ---------- 发现与读取 ----------

  app.get('/api/health', wrap((req, res) => res.json({ ok: true, revision: store.getRevision() })))

  app.get(
    '/api/schema',
    wrap((req, res) => res.json(buildSchema(store, loadConfig())))
  )

  app.get('/api/revision', wrap((req, res) => res.json({ revision: store.getRevision() })))

  app.get(
    '/api/tree',
    wrap((req, res) => {
      const tree = store.listTree()
      if (req.query.format === 'md') {
        res.type('text/markdown').send(renderTreeMd(store, tree))
        return
      }
      res.json({ revision: store.getRevision(), nodes: tree })
    })
  )

  app.get(
    '/api/nodes/:id',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      res.json({
        ...node,
        attrs: store.getAttrs(node.id),
        documents: store.listDocuments(node.id),
        commits: store.listCommits(node.id),
        children: store.listChildren(node.id)
      })
    })
  )

  // ---------- 节点写入 ----------

  app.post(
    '/api/nodes',
    wrap((req, res) => {
      const { parentId = null, parentPath = null, type, name, status, attrs } = req.body || {}
      const pid = parentPath ? store.resolveRef(parentPath).id : parentId
      res.status(201).json(store.createNode({ parentId: pid, type, name, status, attrs, actor: actorOf(req) }))
    })
  )

  app.patch(
    '/api/nodes/:id',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      const { name, status, parentId, parentPath, attrs, confirm } = req.body || {}
      const moving = parentId !== undefined || parentPath !== undefined
      if (moving && confirm !== true) {
        throw new AppError(CODES.CONFIRM_REQUIRED, `移动节点需要 confirm: true`, { ref: refOf(req) })
      }
      const patch = { name, status, attrs }
      if (moving) {
        patch.parentId = parentPath ? (parentPath === null ? null : store.resolveRef(parentPath).id) : parentId
      }
      res.json(store.updateNode(node.id, patch, actorOf(req)))
    })
  )

  app.delete(
    '/api/nodes/:id',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      if (req.query.confirm !== 'true' && req.body?.confirm !== true) {
        throw new AppError(CODES.CONFIRM_REQUIRED, `删除节点 ${node.path} 需要 confirm`, { ref: refOf(req) })
      }
      res.json(store.deleteNode(node.id))
    })
  )

  app.post(
    '/api/nodes/reorder',
    wrap((req, res) => {
      const { parentId = null, parentPath = null, orderedIds } = req.body || {}
      const pid = parentPath ? store.resolveRef(parentPath).id : parentId
      res.json(store.reorderSiblings(pid, orderedIds || []))
    })
  )

  app.post(
    '/api/nodes/upsert',
    wrap((req, res) => {
      const { path, type, attrs, dryRun } = req.body || {}
      const out = upsertByPath(store, path, { type, attrs, by: actorOf(req), dryRun: !!dryRun })
      res.json(out)
    })
  )

  app.post(
    '/api/batch',
    wrap((req, res) => {
      const { ops, dryRun } = req.body || {}
      res.json(applyBatch(store, ops || [], { dryRun: !!dryRun, by: actorOf(req) }))
    })
  )

  app.post(
    '/api/import',
    wrap((req, res) => {
      const { content, parentPath = null, dryRun } = req.body || {}
      if (typeof content !== 'string') throw new AppError(CODES.VALIDATION_FAILED, 'content 必填（markdown 大纲文本）')
      res.json(importOutline(store, content, { parentPath, dryRun: !!dryRun, by: actorOf(req) }))
    })
  )

  // ---------- 属性定义与值 ----------

  app.get(
    '/api/attr-defs',
    wrap((req, res) =>
      res.json(
        store.listAttrDefs(req.query.nodeType || undefined, { includeDisabled: req.query.includeDisabled === 'true' })
      )
    )
  )
  app.post(
    '/api/attr-defs',
    wrap((req, res) => {
      const b = req.body || {}
      res.status(201).json(
        store.addAttrDef({
          nodeType: b.nodeType,
          key: b.key,
          label: b.label,
          dataType: b.dataType,
          options: b.options,
          required: b.required,
          defaultValue: b.defaultValue,
          sort: b.sort
        })
      )
    })
  )
  app.patch(
    '/api/attr-defs/:id',
    wrap((req, res) => res.json(store.updateAttrDef(Number(req.params.id), req.body || {})))
  )
  app.delete(
    '/api/attr-defs/:id',
    wrap((req, res) => res.json(store.deleteAttrDef(Number(req.params.id))))
  )

  // ---------- 文档 ----------

  app.get(
    '/api/nodes/:id/documents',
    wrap((req, res) => res.json(store.listDocuments(store.resolveRef(refOf(req)).id)))
  )
  app.post(
    '/api/nodes/:id/documents',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      const { name, content } = req.body || {}
      res.status(201).json(store.createDocument(node.id, name, content ?? '', actorOf(req)))
    })
  )
  app.post(
    '/api/nodes/:id/documents/upsert',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      const { name, content } = req.body || {}
      res.json(store.upsertDocument(node.id, name, content ?? null, actorOf(req)))
    })
  )
  app.post(
    '/api/nodes/:id/documents/reorder',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      res.json(store.reorderDocuments(node.id, req.body?.orderedIds || []))
    })
  )
  app.patch(
    '/api/documents/:docId',
    wrap((req, res) => res.json(store.updateDocument(Number(req.params.docId), req.body || {}, actorOf(req))))
  )
  app.delete(
    '/api/documents/:docId',
    wrap((req, res) => res.json(store.deleteDocument(Number(req.params.docId))))
  )

  // ---------- 提交登记 ----------

  app.get(
    '/api/nodes/:id/commits',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      res.json(store.listCommits(node.id, { subtree: req.query.subtree === 'true' }))
    })
  )
  app.post(
    '/api/nodes/:id/commits',
    wrap((req, res) => {
      const node = store.resolveRef(refOf(req))
      const { repo, sha, note } = req.body || {}
      res.status(201).json(store.addCommit(node.id, { repo, sha, note }, actorOf(req)))
    })
  )
  app.delete(
    '/api/commits/:cid',
    wrap((req, res) => res.json(store.removeCommit(Number(req.params.cid))))
  )

  // ---------- 仓库登记 ----------

  app.get('/api/repos', wrap((req, res) => res.json(store.listRepos())))
  app.post(
    '/api/repos',
    wrap((req, res) => {
      const b = req.body || {}
      res.status(201).json(store.addRepo({ name: b.name, localPath: b.localPath, gitlabProject: b.gitlabProject, note: b.note }))
    })
  )
  app.patch(
    '/api/repos/:rid',
    wrap((req, res) => res.json(store.updateRepo(Number(req.params.rid), req.body || {})))
  )
  app.delete(
    '/api/repos/:rid',
    wrap((req, res) => res.json(store.deleteRepo(Number(req.params.rid))))
  )

  // ---------- 本机配置 ----------

  app.get('/api/config', wrap((req, res) => res.json(maskToken(loadConfig()))))
  app.put(
    '/api/config',
    wrap((req, res) => res.json(maskToken(saveConfig(req.body || {}))))
  )
  app.post(
    '/api/config/gitlab/test',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const base = cfg.gitlab.base_url
      const token = cfg.gitlab.token
      if (!base || !token) throw new AppError(CODES.GITLAB_NOT_CONFIGURED, '请先在设置里填写 GitLab 地址与 token')
      let r
      try {
        r = await fetch(`${base.replace(/\/$/, '')}/api/v4/user`, { headers: { 'PRIVATE-TOKEN': token } })
      } catch (e) {
        throw new AppError(CODES.GITLAB_UNAVAILABLE, `连不上 GitLab：${e.message}`)
      }
      if (r.status === 401) throw new AppError(CODES.GITLAB_AUTH_FAILED, 'token 无效或已过期')
      if (!r.ok) throw new AppError(CODES.GITLAB_UNAVAILABLE, `GitLab 返回 ${r.status}`)
      const user = await r.json()
      res.json({ ok: true, user: { id: user.id, username: user.username, name: user.name } })
    })
  )

  // ---------- 错误处理 ----------
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `未知路由 ${req.method} ${req.path}` } }))
  app.use((err, req, res, _next) => {
    const code = err.code || 'INTERNAL_ERROR'
    const status = STATUS_BY_CODE[code] || 500
    if (status >= 500) console.error('[task-board]', err)
    res.status(status).json(errorBody(err))
  })

  return app
}
