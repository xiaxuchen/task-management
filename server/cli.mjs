import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { openDb } from './db.mjs'
import { createStore } from './store.mjs'
import { loadConfig, saveConfig, maskToken, DB_PATH } from './config.mjs'
import { buildSchema, renderTreeMd, upsertByPath, importOutline, applyBatch, getCommitDiff, getNodeDiffs, getCommitTrack, getNodeTracks } from './ops.mjs'

const OPTIONS = {
  path: { type: 'string' },
  type: { type: 'string' },
  name: { type: 'string' },
  status: { type: 'string' },
  parent: { type: 'string' },
  to: { type: 'string' },
  attr: { type: 'string', multiple: true },
  format: { type: 'string' },
  content: { type: 'string' },
  file: { type: 'string' },
  sha: { type: 'string' },
  repo: { type: 'string' },
  note: { type: 'string' },
  subtree: { type: 'boolean' },
  scope: { type: 'string' },
  confirm: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  actor: { type: 'string' },
  key: { type: 'string' },
  label: { type: 'string' },
  'data-type': { type: 'string' },
  options: { type: 'string' },
  required: { type: 'boolean' },
  sort: { type: 'string' },
  'local-path': { type: 'string' },
  'gitlab-project': { type: 'string' },
  tags: { type: 'string' },
  'test-branch': { type: 'string' },
  'pre-branch': { type: 'string' },
  'release-branch': { type: 'string' },
  port: { type: 'string' },
  'gitlab-base': { type: 'string' },
  'gitlab-token': { type: 'string' },
  'include-disabled': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
}

const HELP = `task-board <命令>

读取
  tree [--format md|json]            打印整棵树（md 可再喂给 import）
  schema                             节点类型 / 状态值域 / 属性定义 / 工具清单
  node get <ref>                     ref = 节点 id 或路径（项目A/需求1）
  attr list [--type <nodeType>]
  doc list <ref>
  commit list <ref> [--subtree]
  commit diff <cid>                  单个 commit 的 diff（文件列表 + patch）
  commit track <cid>                 检测提交是否已合入测试/预发/上线分支
  node diffs <ref> [--scope self|subtree]   节点（含子树）聚合 diff（含来源节点）
  node tracks <ref> [--scope self|subtree]  节点（含子树）分支合并状态聚合
  repo list
  config get

写入（默认 actor=cli，可用 --actor ai|user）
  node upsert --path <path> [--type t] [--name n] [--attr k=v ...] [--dry-run]
  node update <ref> [--name n] [--status s] [--parent <path>] [--attr k=v ...] [--confirm]
  node move <ref> --to <path> --confirm
  node delete <ref> --confirm
  attr set <ref> k=v [k2=v2 ...]
  attr-def add --type t --key k --label l [--data-type text|textarea|number|date|select|url] [--options '[...]'] [--required]
  doc upsert <ref> --name <文档名> [--content <正文>|--file <path>]    # 按文档名幂等
  commit add <ref> --sha <sha> [--repo <名>] [--note <说明>]
  repo add --name <名> [--local-path <路径>] [--gitlab-project <路径>] [--tags 前端,后端]
  repo update <名|id> [--local-path p] [--tags t] [--test-branch b] [--pre-branch b] [--release-branch b]
  branch-config list                 标签级追踪目标列表（测试/预发/上线）
  branch-config set <标签> [--test-branch b] [--pre-branch b] [--release-branch b]
  branch-config remove <标签>
  import --file <md 大纲> [--parent <path>] [--dry-run]
  batch --file <ops.json> [--dry-run]
  config set [--port 3210] [--gitlab-base <url>] [--gitlab-token <token>]

数据文件：${DB_PATH}（可用 TASKBOARD_HOME 覆盖）`

function parseAttrPairs(list) {
  const out = {}
  for (const item of list || []) {
    const i = item.indexOf('=')
    if (i < 0) throw new Error(`--attr 需要 k=v 形式：${item}`)
    out[item.slice(0, i)] = item.slice(i + 1)
  }
  return out
}

function readMaybeFile({ content, file }) {
  if (file) return fs.readFileSync(file, 'utf8')
  return content
}

export async function run(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })

  if (values.help || positionals.length === 0) {
    console.log(HELP)
    return 0
  }

  const cfg = loadConfig()
  const db = openDb()
  const store = createStore(db, { docPresets: cfg.docPresets })
  const by = values.actor || 'cli'
  const [group, action, ref] = positionals
  const json = (v) => console.log(JSON.stringify(v, null, 2))

  switch (`${group} ${action || ''}`.trim()) {
    case 'tree': {
      const tree = store.listTree()
      if (values.format === 'md') {
        process.stdout.write(renderTreeMd(store, tree))
      } else json({ revision: store.getRevision(), nodes: tree })
      break
    }
    case 'schema':
      json(buildSchema(store, cfg))
      break
    case 'node get':
      json({
        ...store.resolveRef(ref),
        attrs: store.getAttrs(store.resolveRef(ref).id),
        documents: store.listDocuments(store.resolveRef(ref).id).map((d) => ({ id: d.id, name: d.name })),
        commits: store.listCommits(store.resolveRef(ref).id),
        children: store.listChildren(store.resolveRef(ref).id)
      })
      break
    case 'node upsert': {
      const out = upsertByPath(store, values.path, {
        type: values.type,
        attrs: parseAttrPairs(values.attr),
        by,
        dryRun: !!values['dry-run']
      })
      json({ node: out.node, steps: out.steps })
      break
    }
    case 'node update': {
      const node = store.resolveRef(ref)
      const moving = values.parent !== undefined
      if (moving && !values.confirm) throw Object.assign(new Error('移动节点需要 --confirm'), { code: 'CONFIRM_REQUIRED' })
      const patch = { name: values.name, status: values.status, attrs: parseAttrPairs(values.attr) }
      if (moving) patch.parentId = store.resolveRef(values.parent).id
      json(store.updateNode(node.id, patch, by))
      break
    }
    case 'node move': {
      if (!values.to || !values.confirm) {
        throw Object.assign(new Error('移动需要 --to <path> 与 --confirm'), { code: 'CONFIRM_REQUIRED' })
      }
      const node = store.resolveRef(ref)
      json(store.updateNode(node.id, { parentId: store.resolveRef(values.to).id }, by))
      break
    }
    case 'node delete': {
      if (!values.confirm) throw Object.assign(new Error('删除需要 --confirm'), { code: 'CONFIRM_REQUIRED' })
      json(store.deleteNode(store.resolveRef(ref).id))
      break
    }
    case 'attr list':
      json(store.listAttrDefs(values.type, { includeDisabled: !!values['include-disabled'] }))
      break
    case 'attr set': {
      const node = store.resolveRef(ref)
      const pairs = parseAttrPairs(positionals.slice(3))
      json(store.setAttrs(node.id, pairs, by))
      break
    }
    case 'attr-def add':
      json(
        store.addAttrDef({
          nodeType: values.type,
          key: values.key,
          label: values.label,
          dataType: values['data-type'],
          options: values.options ? JSON.parse(values.options) : null,
          required: !!values.required,
          sort: values.sort ? Number(values.sort) : undefined
        })
      )
      break
    case 'doc list':
      json(store.listDocuments(store.resolveRef(ref).id))
      break
    case 'doc upsert': {
      const node = store.resolveRef(ref)
      const body = readMaybeFile({ content: values.content, file: values.file }) ?? null
      json(store.upsertDocument(node.id, values.name, body, by))
      break
    }
    case 'commit list':
      json(store.listCommits(store.resolveRef(ref).id, { subtree: !!values.subtree }))
      break
    case 'commit add': {
      const node = store.resolveRef(ref)
      json(store.addCommit(node.id, { repo: values.repo, sha: values.sha, note: values.note }, by))
      break
    }
    case 'commit diff':
      json(await getCommitDiff(store, Number(ref)))
      break
    case 'node diffs':
      json(await getNodeDiffs(store, ref, { scope: values.scope || 'self' }))
      break
    case 'commit track':
      json(await getCommitTrack(store, Number(ref)))
      break
    case 'node tracks':
      json(await getNodeTracks(store, ref, { scope: values.scope || 'self' }))
      break
    case 'repo list':
      json(store.listRepos())
      break
    case 'repo add':
      json(store.addRepo({ name: values.name, localPath: values['local-path'], gitlabProject: values['gitlab-project'], tags: values.tags, testBranch: values['test-branch'], preBranch: values['pre-branch'], releaseBranch: values['release-branch'] }))
      break
    case 'repo update': {
      const repo = store.listRepos().find((r) => r.name === ref || String(r.id) === String(ref))
      if (!repo) throw new Error(`仓库不存在：${ref}`)
      const patch = {}
      if (values['local-path'] !== undefined) patch.localPath = values['local-path']
      if (values['gitlab-project'] !== undefined) patch.gitlabProject = values['gitlab-project']
      if (values.note !== undefined) patch.note = values.note
      if (values.tags !== undefined) patch.tags = values.tags
      if (values['test-branch'] !== undefined) patch.testBranch = values['test-branch']
      if (values['pre-branch'] !== undefined) patch.preBranch = values['pre-branch']
      if (values['release-branch'] !== undefined) patch.releaseBranch = values['release-branch']
      json(store.updateRepo(repo.id, patch))
      break
    }
    case 'branch-config list':
      json(store.listBranchConfigs())
      break
    case 'branch-config set':
      json(store.upsertBranchConfig(ref, {
        testBranch: values['test-branch'] ?? null,
        preBranch: values['pre-branch'] ?? null,
        releaseBranch: values['release-branch'] ?? null
      }))
      break
    case 'branch-config remove':
      json(store.deleteBranchConfig(ref))
      break
    case 'import': {
      const md = readMaybeFile({ content: values.content, file: values.file })
      json(importOutline(store, md, { parentPath: values.parent, dryRun: !!values['dry-run'], by }))
      break
    }
    case 'batch': {
      const opsRaw = readMaybeFile({ content: values.content, file: values.file })
      if (!opsRaw) throw new Error('需要 --file <ops.json> 或 --content')
      const parsed = JSON.parse(opsRaw)
      json(applyBatch(store, Array.isArray(parsed) ? parsed : parsed.ops, { dryRun: !!values['dry-run'], by }))
      break
    }
    case 'config get':
      json(maskToken(cfg))
      break
    case 'config set': {
      const patch = {}
      if (values.port) patch.port = Number(values.port)
      if (values['gitlab-base'] !== undefined || values['gitlab-token'] !== undefined) {
        patch.gitlab = {}
        if (values['gitlab-base'] !== undefined) patch.gitlab.base_url = values['gitlab-base']
        if (values['gitlab-token'] !== undefined) patch.gitlab.token = values['gitlab-token']
      }
      json(maskToken(saveConfig(patch)))
      break
    }
    default:
      console.error(`未知命令：${positionals.join(' ')}`)
      console.log(HELP)
      return 2
  }
  return 0
}

const isDirect = process.argv[1] && process.argv[1].endsWith('server/cli.mjs')
if (isDirect) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`${e.code || 'ERROR'}: ${e.message}`)
      process.exit(1)
    })
}
