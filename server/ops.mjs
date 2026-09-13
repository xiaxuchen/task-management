import { CODES, AppError } from './errors.mjs'
import { CHILD_TYPES } from './db.mjs'
import { resolveRepoDir, commitDiff as gitCommitDiff, commitStat as gitCommitStat, commitTrack as gitCommitTrack } from './git.mjs'

/** 能力清单：MCP 工具 / CLI 命令 / REST 路由 三者 1:1 对应 */
export const TOOLS = [
  'schema',
  'tree',
  'node_get',
  'node_upsert',
  'node_update',
  'node_delete',
  'node_reorder',
  'attr_defs',
  'attr_add',
  'attr_update',
  'attr_remove',
  'attr_set',
  'doc_list',
  'doc_upsert',
  'doc_create',
  'doc_update',
  'doc_remove',
  'doc_reorder',
  'commit_list',
  'commit_diff',
  'commit_track',
  'node_diffs',
  'node_tracks',
  'commit_add',
  'commit_remove',
  'repo_list',
  'repo_add',
  'repo_update',
  'repo_remove',
  'import_outline',
  'batch',
  'config_get',
  'config_set'
]

/** /api/schema：AI 的能力发现入口（节点类型 / 状态值域 / 属性定义 / 工具清单） */
export function buildSchema(store, config) {
  return {
    version: 1,
    nodeTypes: Object.entries(CHILD_TYPES).map(([type, children]) => ({ type, allowedChildren: children })),
    status: config.status,
    docPresets: config.docPresets,
    branchTemplate: config.branchTemplate,
    attrDefs: store.listAttrDefs(undefined, { includeDisabled: true }),
    tools: TOOLS
  }
}

const TYPE_BY_DEPTH = ['project', 'requirement', 'subreq', 'group']

/** 树 → markdown 大纲（与 import_outline 的输入格式一致，可往返） */
export function renderTreeMd(store, tree, { withAttrs = true } = {}) {
  const lines = []
  const walk = (list, depth) => {
    for (const n of list) {
      const tag = n.type === 'task' || n.type === 'defect' ? `[${n.type}] ` : ''
      lines.push(`${'  '.repeat(depth)}- ${tag}${n.name}`)
      if (withAttrs) {
        const attrs = store.getAttrs(n.id)
        for (const [k, v] of Object.entries(attrs)) {
          if (v != null && v !== '') lines.push(`${'  '.repeat(depth + 1)}- ${k}: ${v}`)
        }
      }
      if (n.children && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return lines.join('\n') + '\n'
}

function findChildByName(store, parent, name) {
  const siblings = store.listChildren(parent ? parent.id : null)
  return siblings.find((n) => n.name === name) || null
}

/**
 * 按路径 get-or-create（幂等）：`项目A/需求1/子需求2`
 * 中间层级不存在会按父节点的第一个允许子类型自动创建；根必须是 project。
 */
export function upsertByPath(store, path, { type = null, attrs = null, by = 'user', dryRun = false } = {}) {
  const parts = String(path || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) throw new AppError(CODES.VALIDATION_FAILED, 'path 不能为空', { field: 'path' })
  let parent = null
  const steps = []
  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1
    const name = parts[i]
    let node = findChildByName(store, parent, name)
    if (!node) {
      const nodeType = parent === null ? 'project' : isLast && type ? type : CHILD_TYPES[parent.type][0]
      if (dryRun) {
        node = { id: null, type: nodeType, name, path: parts.slice(0, i + 1).join('/') }
        steps.push({ path: node.path, type: nodeType, action: 'create' })
      } else {
        node = store.createNode({
          parentId: parent ? parent.id : null,
          type: nodeType,
          name,
          attrs: isLast ? attrs : undefined,
          actor: by
        })
        steps.push({ path: node.path, type: node.type, action: 'create' })
      }
    } else if (isLast && attrs) {
      if (!dryRun) store.setAttrs(node.id, attrs, by)
      steps.push({ path: node.path, type: node.type, action: 'attr' })
    }
    parent = node
  }
  return { node: parent, steps }
}

/** markdown 缩进大纲 → 节点树（解析） */
export function parseOutline(md) {
  const roots = []
  const stack = []
  for (const raw of String(md || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue // 空行与 # 注释忽略
    const indent = raw.match(/^\s*/)[0].length
    const body = raw.trim().replace(/^-\s*/, '')
    const depth = Math.floor(indent / 2)
    const attr = body.match(/^([^\s:：]+)\s*[:：]\s*(.+)$/)
    if (attr && stack.length) {
      stack[stack.length - 1].node.attrs[attr[1]] = attr[2].trim()
      continue
    }
    let type = null
    let name = body
    const tag = body.match(/^\[(project|requirement|subreq|group|task|defect)\]\s*(.+)$/)
    if (tag) {
      type = tag[1]
      name = tag[2]
    }
    const node = { name: String(name).trim(), type, attrs: {}, children: [] }
    if (!node.type) node.type = TYPE_BY_DEPTH[Math.min(depth, TYPE_BY_DEPTH.length - 1)]
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].node.children.push(node)
    stack.push({ depth, node })
  }
  return roots
}

/** 大纲导入：一次落成整棵子树（parentPath 下），idempotent */
export function importOutline(store, md, { parentPath = null, dryRun = false, by = 'user' } = {}) {
  const outline = parseOutline(md)
  let parent = null
  if (parentPath) {
    parent = store.resolveRef(parentPath)
  }
  // parentPath 给出的父节点下：清除 outline 解析的类型，全由 visit 按父子约束推导
  const clearOutlineType = (nodes) => { for (const n of nodes) { delete n.type; if (n.children.length) clearOutlineType(n.children) } }
  const steps = []
  const visit = (nodes, parentNode) => {
    for (const spec of nodes) {
      const type =
        spec.type || (parentNode ? CHILD_TYPES[parentNode.type][0] : 'project')
      let node = findChildByName(store, parentNode, spec.name)
      if (!node) {
        if (dryRun) {
          node = { id: null, type, name: spec.name, path: `${parentNode ? parentNode.path + '/' : ''}${spec.name}` }
          steps.push({ path: node.path, type, action: 'create' })
        } else {
          node = store.createNode({
            parentId: parentNode ? parentNode.id : null,
            type,
            name: spec.name,
            attrs: Object.keys(spec.attrs).length ? spec.attrs : undefined,
            actor: by
          })
          steps.push({ path: node.path, type: node.type, action: 'create' })
        }
      } else {
        steps.push({ path: node.path, type: node.type, action: 'exist' })
        if (Object.keys(spec.attrs).length) {
          if (!dryRun) store.setAttrs(node.id, spec.attrs, by)
          steps.push({ path: node.path, type: node.type, action: 'attr' })
        }
      }
      if (spec.children.length) visit(spec.children, node)
    }
  }
  if (parent) {
    clearOutlineType(outline)
    const rootType = CHILD_TYPES[parent.type][0]
    const normalised = outline.map((n) => ({ ...n, type: rootType }))
    visit(normalised, parent)
  } else {
    visit(outline, null)
  }
  return { dryRun, count: steps.length, steps }
}

/** 单个 commit 的 diff 预览（HTTP / CLI / MCP 共用） */
export async function getCommitDiff(store, cid) {
  const commit = store.getCommit(cid)
  const repo = commit.repo ? store.listRepos().find((r) => r.name === commit.repo) : null
  if (!repo) {
    throw new AppError(
      CODES.REPO_NOT_REGISTERED,
      commit.repo ? `仓库 ${commit.repo} 未登记（先 repo add）` : '该提交未标注仓库，无法定位本地仓库',
      { repo: commit.repo }
    )
  }
  const dir = resolveRepoDir(repo)
  const diff = await gitCommitDiff(dir, commit.sha)
  return { commit, repo: { name: repo.name, localPath: repo.localPath }, ...diff }
}

/**
 * 节点（含子树）聚合 diff：按 (repo, sha) 去重、回填来源节点；
 * 单条失败不影响整体（该项带 error 字段，便于部分仓库不可用时仍可浏览其他提交）
 */
export async function getNodeDiffs(store, nodeRef, { scope = 'self' } = {}) {
  const node = store.resolveRef(nodeRef)
  const commits = store.listCommits(node.id, { subtree: scope === 'subtree' })
  const repos = new Map(store.listRepos().map((r) => [r.name, r]))
  const items = []
  const byKey = new Map()
  for (const c of commits) {
    const key = `${c.repo || ''}@${c.sha}`
    const sourcePath = store.getNode(c.nodeId).path
    const existing = byKey.get(key)
    if (existing) {
      existing.sourceNodes.push({ nodeId: c.nodeId, path: sourcePath })
      continue
    }
    const item = { commit: c, sourceNodes: [{ nodeId: c.nodeId, path: sourcePath }], repo: null, files: [], error: null }
    byKey.set(key, item)
    items.push(item)
    try {
      const repo = c.repo ? repos.get(c.repo) : null
      if (!repo) {
        throw new AppError(
          CODES.REPO_NOT_REGISTERED,
          c.repo ? `仓库 ${c.repo} 未登记（先 repo add）` : '该提交未标注仓库'
        )
      }
      const dir = resolveRepoDir(repo)
      item.repo = { name: repo.name, localPath: repo.localPath }
      item.files = await gitCommitStat(dir, c.sha)
    } catch (e) {
      item.error = { code: e.code || 'ERROR', message: e.message }
    }
  }
  return { scope, count: items.length, items }
}

/** 单个 commit 的分支合并状态（测试 / 预发 / 上线；需仓库配置 testBranch/preBranch/releaseBranch） */
export async function getCommitTrack(store, cid) {
  const commit = store.getCommit(cid)
  const repo = commit.repo ? store.listRepos().find((r) => r.name === commit.repo) : null
  if (!repo) {
    throw new AppError(
      CODES.REPO_NOT_REGISTERED,
      commit.repo ? `仓库 ${commit.repo} 未登记（先 repo add）` : '该提交未标注仓库，无法定位本地仓库',
      { repo: commit.repo }
    )
  }
  const dir = resolveRepoDir(repo)
  const targets = store.resolveBranchTargets(repo)
  const branches = { test: targets.test, pre: targets.pre, release: targets.release }
  const track = await gitCommitTrack(dir, commit.sha, branches)
  return { commit, repo: { name: repo.name, localPath: repo.localPath, ...branches, targetSource: targets.source }, track }
}

/**
 * 节点（含子树）聚合分支合并状态：按 (repo, sha) 去重、回填来源节点；
 * contained=null 表示分支未配置或本地无该 ref（先 fetch）；单条失败带 error 不拖垮整体
 */
export async function getNodeTracks(store, nodeRef, { scope = 'self' } = {}) {
  const node = store.resolveRef(nodeRef)
  const commits = store.listCommits(node.id, { subtree: scope === 'subtree' })
  const repos = new Map(store.listRepos().map((r) => [r.name, r]))
  const items = []
  const byKey = new Map()
  for (const c of commits) {
    const key = `${c.repo || ''}@${c.sha}`
    const sourcePath = store.getNode(c.nodeId).path
    const existing = byKey.get(key)
    if (existing) {
      existing.sourceNodes.push({ nodeId: c.nodeId, path: sourcePath })
      continue
    }
    const item = { commit: c, sourceNodes: [{ nodeId: c.nodeId, path: sourcePath }], repo: null, track: null, error: null }
    byKey.set(key, item)
    items.push(item)
    try {
      const repo = c.repo ? repos.get(c.repo) : null
      if (!repo) {
        throw new AppError(
          CODES.REPO_NOT_REGISTERED,
          c.repo ? `仓库 ${c.repo} 未登记（先 repo add）` : '该提交未标注仓库'
        )
      }
      const dir = resolveRepoDir(repo)
      const targets = store.resolveBranchTargets(repo)
      const branches = { test: targets.test, pre: targets.pre, release: targets.release }
      item.repo = { name: repo.name, ...branches, targetSource: targets.source }
      item.track = await gitCommitTrack(dir, c.sha, branches)
    } catch (e) {
      item.error = { code: e.code || 'ERROR', message: e.message }
    }
  }
  return { scope, count: items.length, items }
}

/**
 * 批量操作：`{ ops: [...], dryRun }`；单个 op 失败不影响其余，逐条返回状态。
 * op：node.create / node.upsert / node.update / node.delete / attr.set / doc.upsert / doc.update /
 *     doc.remove / commit.add / commit.remove / repo.add / attr_add
 */
export function applyBatch(store, ops, { dryRun = false, by = 'user' } = {}) {
  const results = []
  for (const [index, op] of (ops || []).entries()) {
    try {
      results.push({ index, op: op.op, ok: true, result: runOp(store, op, { dryRun, by }) })
    } catch (e) {
      results.push({
        index,
        op: op.op,
        ok: false,
        error: { code: e.code || 'ERROR', message: e.message, details: e.details }
      })
    }
  }
  return { dryRun, total: results.length, failed: results.filter((r) => !r.ok).length, results }
}

function runOp(store, op, { dryRun, by }) {
  switch (op.op) {
    case 'node.create':
      if (dryRun) return { planned: 'node.create', name: op.name }
      return store.createNode({ parentId: op.parentId ?? (op.parentPath ? store.resolveRef(op.parentPath).id : null), type: op.type, name: op.name, attrs: op.attrs, actor: by })
    case 'node.upsert':
      return upsertByPath(store, op.path, { type: op.type, attrs: op.attrs, by, dryRun }).node
    case 'node.update': {
      const node = store.resolveRef(op.ref)
      if (op.confirm !== true && (op.patch?.parentId !== undefined || op.patch?.parentPath !== undefined)) {
        throw new AppError(CODES.CONFIRM_REQUIRED, `移动节点 ${node.path} 需要 confirm: true`, { ref: op.ref })
      }
      if (dryRun) return { planned: 'node.update', path: node.path, patch: op.patch }
      const patch = { ...op.patch }
      if (patch.parentPath !== undefined) {
        patch.parentId = patch.parentPath === null ? null : store.resolveRef(patch.parentPath).id
        delete patch.parentPath
      }
      return store.updateNode(node.id, patch, by)
    }
    case 'node.delete': {
      const node = store.resolveRef(op.ref)
      if (op.confirm !== true) throw new AppError(CODES.CONFIRM_REQUIRED, `删除节点 ${node.path} 需要 confirm: true`, { ref: op.ref })
      if (dryRun) return { planned: 'node.delete', path: node.path }
      return store.deleteNode(node.id)
    }
    case 'attr.set': {
      const node = store.resolveRef(op.ref)
      if (dryRun) return { planned: 'attr.set', path: node.path, attrs: op.attrs }
      return store.setAttrs(node.id, op.attrs, by)
    }
    case 'attr_add':
      if (dryRun) return { planned: 'attr_add', key: op.key }
      return store.addAttrDef({ ...op, nodeType: op.nodeType, dataType: op.dataType })
    case 'doc.upsert': {
      const node = store.resolveRef(op.ref)
      if (dryRun) return { planned: 'doc.upsert', path: node.path, name: op.name }
      return store.upsertDocument(node.id, op.name, op.content ?? null, by)
    }
    case 'doc.create': {
      const node = store.resolveRef(op.ref)
      if (dryRun) return { planned: 'doc.create', path: node.path, name: op.name }
      return store.createDocument(node.id, op.name, op.content ?? '', by)
    }
    case 'doc.update':
      if (dryRun) return { planned: 'doc.update', id: op.docId }
      return store.updateDocument(op.docId, { name: op.name, content: op.content }, by)
    case 'doc.remove':
      if (dryRun) return { planned: 'doc.remove', id: op.docId }
      return store.deleteDocument(op.docId)
    case 'commit.add': {
      const node = store.resolveRef(op.ref)
      if (dryRun) return { planned: 'commit.add', path: node.path, sha: op.sha }
      return store.addCommit(node.id, { repo: op.repo, sha: op.sha, note: op.note }, by)
    }
    case 'commit.remove':
      if (dryRun) return { planned: 'commit.remove', id: op.commitId }
      return store.removeCommit(op.commitId)
    case 'repo.add':
      if (dryRun) return { planned: 'repo.add', name: op.name }
      return store.addRepo({ name: op.name, localPath: op.localPath, gitlabProject: op.gitlabProject, note: op.note })
    default:
      throw new AppError(CODES.VALIDATION_FAILED, `不支持的 op：${op.op}`, { op: op.op })
  }
}
