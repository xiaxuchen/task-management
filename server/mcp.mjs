import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openDb } from './db.mjs'
import { createStore } from './store.mjs'
import { loadConfig, saveConfig, maskToken } from './config.mjs'
import { buildSchema, renderTreeMd, upsertByPath, importOutline, applyBatch, getCommitDiff, getNodeDiffs, getCommitTrack, getNodeTracks } from './ops.mjs'

export function createMcpServer({ store }) {
  const cfg = loadConfig()

  const server = new McpServer({ name: 'task-board', version: '0.1.0' })

  // ---------- 读取 ----------

  server.tool('tree', '打印整棵树', { format: z.enum(['md', 'json']).optional() }, async ({ format }) => {
    const tree = store.listTree()
    if (format === 'md') {
      return { content: [{ type: 'text', text: renderTreeMd(store, tree) }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ revision: store.getRevision(), nodes: tree }, null, 2) }] }
  })

  server.tool('schema', '节点类型 / 状态值域 / 属性定义 / 工具清单', async () => {
    return { content: [{ type: 'text', text: JSON.stringify(buildSchema(store, loadConfig()), null, 2) }] }
  })

  server.tool('node_get', '获取节点详情', { ref: z.string().describe('id 或路径') }, async ({ ref }) => {
    const node = store.resolveRef(ref)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ...node, attrs: store.getAttrs(node.id), documents: store.listDocuments(node.id), children: store.listChildren(node.id) },
            null,
            2
          )
        }
      ]
    }
  })

  server.tool(
    'node_upsert',
    '按路径 get-or-create（幂等）',
    {
      path: z.string().describe('节点路径，如 项目A/需求1'),
      type: z.string().optional(),
      attrs: z.record(z.string()).optional(),
      dryRun: z.boolean().optional()
    },
    async ({ path, type, attrs, dryRun }) => {
      const out = upsertByPath(store, path, { type, attrs, by: 'ai', dryRun: !!dryRun })
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
    }
  )

  server.tool(
    'node_update',
    '更新节点（移动需要 confirm: true）',
    {
      ref: z.string().describe('id 或路径'),
      name: z.string().optional(),
      status: z.string().optional(),
      parentPath: z.string().nullable().optional(),
      attrs: z.record(z.string()).optional(),
      confirm: z.boolean().optional()
    },
    async ({ ref, name, status, parentPath, attrs, confirm }) => {
      const node = store.resolveRef(ref)
      const patch = { name, status, attrs }
      if (parentPath !== undefined) {
        if (confirm !== true) return { content: [{ type: 'text', text: '移动节点需要 confirm: true' }], isError: true }
        patch.parentId = parentPath === null ? null : store.resolveRef(parentPath).id
      }
      return { content: [{ type: 'text', text: JSON.stringify(store.updateNode(node.id, patch, 'ai'), null, 2) }] }
    }
  )

  server.tool(
    'node_delete',
    '删除节点（需要 confirm: true）',
    { ref: z.string().describe('id 或路径'), confirm: z.boolean() },
    async ({ ref, confirm }) => {
      if (confirm !== true) return { content: [{ type: 'text', text: '删除节点需要 confirm: true' }], isError: true }
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.deleteNode(node.id), null, 2) }] }
    }
  )

  server.tool(
    'node_reorder',
    '同级排序',
    {
      parentId: z.number().optional(),
      parentPath: z.string().optional(),
      orderedIds: z.array(z.number())
    },
    async ({ parentId, parentPath, orderedIds }) => {
      const pid = parentPath ? store.resolveRef(parentPath).id : parentId
      return { content: [{ type: 'text', text: JSON.stringify(store.reorderSiblings(pid, orderedIds), null, 2) }] }
    }
  )

  // ---------- 属性 ----------

  server.tool(
    'attr_defs',
    '属性定义列表',
    { nodeType: z.string().optional(), includeDisabled: z.boolean().optional() },
    async ({ nodeType, includeDisabled }) => {
      return {
        content: [{ type: 'text', text: JSON.stringify(store.listAttrDefs(nodeType, { includeDisabled: !!includeDisabled }), null, 2) }]
      }
    }
  )

  server.tool(
    'attr_add',
    '新增属性定义',
    {
      nodeType: z.string(),
      key: z.string(),
      label: z.string(),
      dataType: z.enum(['text', 'textarea', 'number', 'date', 'select', 'url']),
      options: z.string().optional(),
      required: z.boolean().optional(),
      sort: z.number().optional()
    },
    async ({ nodeType, key, label, dataType, options, required, sort }) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              store.addAttrDef({ nodeType, key, label, dataType, options: options ? JSON.parse(options) : null, required: !!required, sort }),
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.tool(
    'attr_update',
    '更新属性定义',
    { id: z.number(), label: z.string().optional(), dataType: z.string().optional(), options: z.string().optional(), required: z.boolean().optional(), sort: z.number().optional(), enabled: z.boolean().optional() },
    async ({ id, ...patch }) => {
      if (patch.options) patch.options = JSON.parse(patch.options)
      return { content: [{ type: 'text', text: JSON.stringify(store.updateAttrDef(id, patch), null, 2) }] }
    }
  )

  server.tool('attr_remove', '删除属性定义', { id: z.number() }, async ({ id }) => {
    return { content: [{ type: 'text', text: JSON.stringify(store.deleteAttrDef(id), null, 2) }] }
  })

  server.tool(
    'attr_set',
    '设置节点属性值',
    { ref: z.string().describe('id 或路径'), attrs: z.record(z.string()) },
    async ({ ref, attrs }) => {
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.setAttrs(node.id, attrs, 'ai'), null, 2) }] }
    }
  )

  // ---------- 文档 ----------

  server.tool('doc_list', '列节点文档', { ref: z.string() }, async ({ ref }) => {
    const node = store.resolveRef(ref)
    return { content: [{ type: 'text', text: JSON.stringify(store.listDocuments(node.id), null, 2) }] }
  })

  server.tool(
    'doc_upsert',
    '按文档名 upsert（幂等）',
    { ref: z.string(), name: z.string(), content: z.string().optional() },
    async ({ ref, name, content }) => {
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.upsertDocument(node.id, name, content ?? null, 'ai'), null, 2) }] }
    }
  )

  server.tool(
    'doc_create',
    '新增文档',
    { ref: z.string(), name: z.string(), content: z.string().optional() },
    async ({ ref, name, content }) => {
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.createDocument(node.id, name, content ?? '', 'ai'), null, 2) }] }
    }
  )

  server.tool(
    'doc_update',
    '更新文档',
    { docId: z.number(), name: z.string().optional(), content: z.string().optional() },
    async ({ docId, name, content }) => {
      const patch = {}
      if (name !== undefined) patch.name = name
      if (content !== undefined) patch.content = content
      return { content: [{ type: 'text', text: JSON.stringify(store.updateDocument(docId, patch, 'ai'), null, 2) }] }
    }
  )

  server.tool('doc_remove', '删除文档', { docId: z.number() }, async ({ docId }) => {
    return { content: [{ type: 'text', text: JSON.stringify(store.deleteDocument(docId), null, 2) }] }
  })

  server.tool(
    'doc_reorder',
    '文档排序',
    { ref: z.string(), orderedIds: z.array(z.number()) },
    async ({ ref, orderedIds }) => {
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.reorderDocuments(node.id, orderedIds), null, 2) }] }
    }
  )

  // ---------- commit ----------

  server.tool(
    'commit_list',
    '列出节点的 commit 登记',
    { ref: z.string(), subtree: z.boolean().optional() },
    async ({ ref, subtree }) => {
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.listCommits(node.id, { subtree: !!subtree }), null, 2) }] }
    }
  )

  server.tool(
    'commit_diff',
    '单个 commit 的 diff 预览（文件列表 + 每文件 patch / old / new；仓库读本机 git）',
    { cid: z.number().describe('commit 登记 id（commit_list 返回的 id）') },
    async ({ cid }) => {
      const data = await getCommitDiff(store, cid)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'node_diffs',
    '节点（含子树）聚合 diff：按 (repo, sha) 去重、回填来源节点；单条失败带 error 字段',
    { ref: z.string(), scope: z.enum(['self', 'subtree']).optional() },
    async ({ ref, scope }) => {
      const data = await getNodeDiffs(store, ref, { scope: scope || 'self' })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'commit_track',
    '检测单个 commit 是否已合入测试/预发/上线分支（需仓库配置三分支）',
    { cid: z.number().describe('commit 登记 id（commit_list 返回的 id）') },
    async ({ cid }) => {
      const data = await getCommitTrack(store, cid)
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'node_tracks',
    '节点（含子树）合并状态聚合：按 (repo, sha) 去重；contained=null 表示未配置或本地无该 ref',
    { ref: z.string(), scope: z.enum(['self', 'subtree']).optional() },
    async ({ ref, scope }) => {
      const data = await getNodeTracks(store, ref, { scope: scope || 'self' })
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    }
  )

  server.tool(
    'commit_add',
    '登记 commit',
    { ref: z.string(), sha: z.string(), repo: z.string().optional(), note: z.string().optional() },
    async ({ ref, sha, repo, note }) => {
      const node = store.resolveRef(ref)
      return { content: [{ type: 'text', text: JSON.stringify(store.addCommit(node.id, { repo, sha, note }, 'ai'), null, 2) }] }
    }
  )

  server.tool('commit_remove', '删除 commit 登记', { commitId: z.number() }, async ({ commitId }) => {
    return { content: [{ type: 'text', text: JSON.stringify(store.removeCommit(commitId), null, 2) }] }
  })

  // ---------- 仓库 ----------

  server.tool('repo_list', '仓库列表', async () => {
    return { content: [{ type: 'text', text: JSON.stringify(store.listRepos(), null, 2) }] }
  })

  server.tool(
    'repo_add',
    '新增仓库',
    { name: z.string(), localPath: z.string().optional(), gitlabProject: z.string().optional(), note: z.string().optional(), testBranch: z.string().optional(), preBranch: z.string().optional(), releaseBranch: z.string().optional() },
    async ({ name, localPath, gitlabProject, note, testBranch, preBranch, releaseBranch }) => {
      return { content: [{ type: 'text', text: JSON.stringify(store.addRepo({ name, localPath, gitlabProject, note, testBranch, preBranch, releaseBranch }), null, 2) }] }
    }
  )

  server.tool(
    'repo_update',
    '更新仓库（含测试/预发/上线分支配置）',
    { id: z.number(), name: z.string().optional(), localPath: z.string().optional(), gitlabProject: z.string().optional(), note: z.string().optional(), testBranch: z.string().optional(), preBranch: z.string().optional(), releaseBranch: z.string().optional() },
    async ({ id, ...patch }) => {
      return { content: [{ type: 'text', text: JSON.stringify(store.updateRepo(id, patch), null, 2) }] }
    }
  )

  server.tool('repo_remove', '删除仓库', { id: z.number() }, async ({ id }) => {
    return { content: [{ type: 'text', text: JSON.stringify(store.deleteRepo(id), null, 2) }] }
  })

  // ---------- 导入 / 批量 ----------

  server.tool(
    'import_outline',
    '大纲导入（markdown 缩进格式）',
    { content: z.string(), parentPath: z.string().optional(), dryRun: z.boolean().optional() },
    async ({ content, parentPath, dryRun }) => {
      return { content: [{ type: 'text', text: JSON.stringify(importOutline(store, content, { parentPath, dryRun: !!dryRun, by: 'ai' }), null, 2) }] }
    }
  )

  server.tool(
    'batch',
    '批量操作',
    { ops: z.array(z.any()), dryRun: z.boolean().optional() },
    async ({ ops, dryRun }) => {
      return { content: [{ type: 'text', text: JSON.stringify(applyBatch(store, ops, { dryRun: !!dryRun, by: 'ai' }), null, 2) }] }
    }
  )

  // ---------- 配置 ----------

  server.tool('config_get', '读取配置（token 打码）', async () => {
    return { content: [{ type: 'text', text: JSON.stringify(maskToken(loadConfig()), null, 2) }] }
  })

  server.tool(
    'config_set',
    '更新配置',
    { port: z.number().optional(), gitlabBase: z.string().optional(), gitlabToken: z.string().optional() },
    async ({ port, gitlabBase, gitlabToken }) => {
      const patch = {}
      if (port !== undefined) patch.port = port
      if (gitlabBase !== undefined || gitlabToken !== undefined) {
        patch.gitlab = {}
        if (gitlabBase !== undefined) patch.gitlab.base_url = gitlabBase
        if (gitlabToken !== undefined) patch.gitlab.token = gitlabToken
      }
      return { content: [{ type: 'text', text: JSON.stringify(maskToken(saveConfig(patch)), null, 2) }] }
    }
  )

  return server
}

export async function runMcp() {
  const cfg = loadConfig()
  const db = openDb()
  const store = createStore(db, { docPresets: cfg.docPresets })
  const server = createMcpServer({ store })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const isDirect = process.argv[1] && process.argv[1].endsWith('server/mcp.mjs')
if (isDirect) {
  runMcp().catch((e) => {
    console.error(`MCP: ${e.message}`)
    process.exit(1)
  })
}