import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { openDb } from './db.mjs'
import { createStore } from './store.mjs'
import { loadConfig, saveConfig, maskToken, DB_PATH } from './config.mjs'
import { buildSchema, renderTreeMd, upsertByPath, importOutline, applyBatch, getCommitDiff, getNodeDiffs, getCommitTrack, getNodeTracks, getCombinedDiff, getNodeDuplicates, runTestCases, renderAcceptanceMd } from './ops.mjs'
import { startAgentRun, retryAndDispatch } from './agent.mjs'

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
  branch: { type: 'string' },
  'overwrite-branch': { type: 'boolean' },
  subtree: { type: 'boolean' },
  scope: { type: 'string' },
  'review-status': { type: 'string' },
  'review-note': { type: 'string' },
  kind: { type: 'string' },
  expectation: { type: 'string' },
  'case-ids': { type: 'string' },
  'case-id': { type: 'string' },
  limit: { type: 'string' },
  summary: { type: 'string' },
  detail: { type: 'string' },
  prompt: { type: 'string' },
  model: { type: 'string' },
  cwd: { type: 'string' },
  agent: { type: 'string' },
  session: { type: 'string' },
  resume: { type: 'boolean' },
  runtime: { type: 'string' },
  daemon: { type: 'string' },
  provider: { type: 'string' },
  'device-info': { type: 'string' },
  visibility: { type: 'string' },
  id: { type: 'string' },
  'runtime-mode': { type: 'string' },
  reason: { type: 'string' },
  'failure-reason': { type: 'string' },
  'cli-session': { type: 'string' },
  'work-dir': { type: 'string' },
  'exit-code': { type: 'string' },
  'max-attempts': { type: 'string' },
  title: { type: 'string' },
  'since-seq': { type: 'string' },
  ids: { type: 'string' },
  branches: { type: 'boolean' },
  keep: { type: 'string' },
  remove: { type: 'string' },
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
  commit add <ref> --sha <sha> [--repo <名>] [--note <说明>] [--branch <分支>] [--overwrite-branch]
  commit review <cid> --review-status pending|approved|issue [--review-note "意见"]
  commit combined-diff --ids "1,2,3"   多个 commit 的合并变更（按仓库分组、文件并集、净 old/new）
  commit duplicates <ref> [--scope self|subtree]   重复检测（same-sha / patch-id / merge 覆盖）
  commit dedupe --keep <cid> --remove "1,2,3"      一键去重（保留 keep，删除重复登记）
  test case list <ref> [--kind regression|acceptance]    该节点的测试用例
  test case upsert <ref> --name <名> --prompt <内容> [--kind regression|acceptance] [--expectation <期望>]
  test case update <cid> [--name n] [--kind k] [--prompt p] [--expectation e]
  test case remove <cid>
  test case reorder <ref> --ids "1,2,3"
  test run <ref> [--kind k] [--case-ids "1,2"] [--prompt "额外要求"] [--dry-run]   派单执行用例（自动开报告）
  test report list <ref> [--kind k] [--case-id <id>]      测试报告列表
  test report get <rid> / test report finish <rid> --status pass|fail|blocked|error|cancelled [--summary s] [--detail d]
  test acceptance <ref> [--scope self|subtree] [--format json|md]   验收报告（聚合最近结果）
  runtime list [--status online|offline]        运行时列表（含本机 CLI 实例状态）
  runtime register [--daemon <主机名>] [--provider qodercli] [--name <名>] [--visibility private|public]
  runtime heartbeat <id>                        运行时心跳（刷新 last_seen_at + 置 online）
  runtime status <id> --status online|offline   手动改运行时状态
  runtime remove <id>                           删除运行时（有未完成任务时拒绝）
  agent session list <ref> [--status active|archived]    节点上的 agent 会话
  agent session new <ref> [--agent qodercli] [--title <标题>]   新建会话（不复用旧的）
  agent session get <sid> / agent session archive <sid>
  agent run <ref> --prompt "..." [--model DeepSeek-Flash] [--cwd <dir>] [--agent qodercli]
                                    [--session <sid>] [--resume] [--runtime <id>] [--max-attempts N]   触发任务（异步；--resume 续跑会话）
  agent runs <ref> [--session <sid>]              任务历史（含输出与状态）
  agent run get <rid> / agent run messages <rid> [--since-seq N]
  agent run cancel <rid> [--reason <原因>] / agent run retry <rid>
  agent run update <rid> --status success|failed|timeout|cancelled [--exit-code N] [--failure-reason r] [--cli-session s] [--work-dir d]
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
      json(
        store.addCommit(
          node.id,
          {
            repo: values.repo,
            sha: values.sha,
            note: values.note,
            branch: values.branch,
            overwriteBranch: !!values['overwrite-branch']
          },
          by
        )
      )
      break
    }
    case 'commit review':
      json(store.updateCommitReview(Number(ref), { reviewStatus: values['review-status'], note: values['review-note'] }, by))
      break
    case 'commit combined-diff':
      json(await getCombinedDiff(store, String(values.ids || '').split(',').map((s) => Number(s.trim()))))
      break
    case 'commit duplicates':
      json(await getNodeDuplicates(store, ref, { scope: values.scope === 'subtree' ? 'subtree' : 'self' }))
      break
    case 'commit dedupe':
      json(store.dedupeCommits({
        keepId: Number(values.keep),
        removeIds: String(values.remove || '').split(',').map((s) => Number(s.trim()))
      }, by))
      break
    // ---------- 回归测试闭环（`test case|run|report|acceptance ...`） ----------
    case 'test case': {
      const sub = ref
      const arg = positionals[3]
      if (sub === 'list') json(store.listTestCases(store.resolveRef(arg).id, { kind: values.kind || null, includeDisabled: !!values['include-disabled'] }))
      else if (sub === 'upsert')
        json(
          store.upsertTestCase(
            store.resolveRef(arg).id,
            {
              name: values.name,
              kind: values.kind || 'regression',
              prompt: readMaybeFile({ content: values.prompt, file: values.file }) ?? values.prompt,
              expectation: values.expectation ?? null
            },
            by
          )
        )
      else if (sub === 'update')
        json(
          store.updateTestCase(Number(arg), {
            name: values.name ?? null,
            kind: values.kind ?? null,
            prompt: values.prompt ?? null,
            expectation: values.expectation !== undefined ? values.expectation : undefined
          }, by)
        )
      else if (sub === 'remove') {
        store.deleteTestCase(Number(arg))
        json({ ok: true, id: Number(arg) })
      } else if (sub === 'reorder')
        json(store.reorderTestCases(store.resolveRef(arg).id, String(values.ids || '').split(',').map((s) => Number(s.trim()))))
      else throw new Error(`test case 支持 list|upsert|update|remove|reorder，收到：${sub}`)
      break
    }
    case 'test run': {
      const node = store.resolveRef(ref)
      json(
        runTestCases(store, node.id, {
          caseIds: values['case-ids'] ? String(values['case-ids']).split(',').map((s) => Number(s.trim())) : null,
          kind: values.kind || null,
          prompt: values.prompt || null,
          agent: values.agent,
          model: values.model,
          cwd: values.cwd,
          dryRun: !!values['dry-run']
        }, by)
      )
      break
    }
    case 'test report': {
      const sub = ref
      const arg = positionals[3]
      if (sub === 'list')
        json(
          store.listTestReports(store.resolveRef(arg).id, {
            kind: values.kind || null,
            caseId: values['case-id'] ? Number(values['case-id']) : null,
            limit: values.limit ? Number(values.limit) : 100
          })
        )
      else if (sub === 'get') json(store.getTestReport(Number(arg)))
      else if (sub === 'finish')
        json(store.finishTestReport(Number(arg), { status: values.status, summary: values.summary, detail: values.detail }, by))
      else throw new Error(`test report 支持 list|get|finish，收到：${sub}`)
      break
    }
    case 'test acceptance': {
      const node = store.resolveRef(ref)
      const report = store.buildAcceptanceReport(node.id, { scope: values.scope === 'subtree' ? 'subtree' : 'self' })
      if (values.format === 'md') process.stdout.write(renderAcceptanceMd(report) + '\n')
      else json(report)
      break
    }
    // ---------- 运行时 ----------
    case 'runtime list':
      json({ summary: store.agentRuntimeSummary(), items: store.listRuntimes({ status: values.status || null }) })
      break
    case 'runtime register':
      json(
        store.upsertRuntime(
          {
            name: values.name,
            daemonId: values.daemon,
            provider: values.provider,
            runtimeMode: values['runtime-mode'] || 'local',
            status: values.status || 'online',
            deviceInfo: values['device-info'] || '',
            visibility: values.visibility || 'private'
          },
          by
        )
      )
      break
    case 'runtime heartbeat':
      json(store.heartbeatRuntime(Number(ref || values.id)))
      break
    case 'runtime status':
      json(store.setRuntimeStatus(Number(ref || values.id), values.status))
      break
    case 'runtime remove':
      json(store.deleteRuntime(Number(ref || values.id)))
      break
    // ---------- 会话（`agent session <list|new|get|archive> [arg]`） ----------
    case 'agent session': {
      const sub = ref
      const arg = positionals[3]
      if (sub === 'list') json(store.listAgentSessions(store.resolveRef(arg).id, { status: values.status || null }))
      else if (sub === 'new')
        json(
          store.createAgentSession(
            store.resolveRef(arg).id,
            { agent: values.agent || undefined, title: values.title, workDir: values.cwd },
            by
          )
        )
      else if (sub === 'get') json(store.getAgentSession(Number(arg)))
      else if (sub === 'archive') json(store.archiveAgentSession(Number(arg)))
      else throw new Error(`agent session 支持 list|new|get|archive，收到：${sub}`)
      break
    }
    // ---------- 任务（runs） ----------
    case 'agent run': {
      // 既支持 `agent run <ref> --prompt ...`，也支持 `agent run get|cancel|retry|update|messages <rid>`
      const sub = ref
      if (['get', 'cancel', 'retry', 'update', 'messages'].includes(sub)) {
        const rid = Number(positionals[3] || values.id)
        if (sub === 'get') json(store.getAgentRun(rid))
        else if (sub === 'cancel') json(store.cancelAgentRun(rid, { reason: values.reason || 'manual' }))
        else if (sub === 'retry') json(retryAndDispatch(store, rid, by))
        else if (sub === 'messages') json(store.listAgentRunMessages(rid, { sinceSeq: Number(values['since-seq']) || 0 }))
        else {
          if (!values.status) throw new Error('agent run update 需要 --status')
          json(
            store.finishAgentRun(rid, {
              status: values.status,
              exitCode: values['exit-code'] !== undefined ? Number(values['exit-code']) : null,
              failureReason: values['failure-reason'] ?? null,
              cliSessionId: values['cli-session'] ?? null,
              workDir: values['work-dir'] ?? null
            })
          )
        }
        break
      }
      const node = store.resolveRef(sub)
      json(
        startAgentRun(
          store,
          node.id,
          {
            prompt: values.prompt,
            agent: values.agent,
            model: values.model,
            cwd: values.cwd,
            sessionId: values.session ? Number(values.session) : null,
            resume: !!values.resume,
            runtimeId: values.runtime ? Number(values.runtime) : null,
            maxAttempts: values['max-attempts'] != null ? Number(values['max-attempts']) : null
          },
          by
        )
      )
      break
    }
    case 'agent runs':
      json(store.listAgentRuns(store.resolveRef(ref).id, { sessionId: values.session ? Number(values.session) : null }))
      break
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
      json(await getNodeTracks(store, ref, { scope: values.scope || 'self', branches: !!values.branches }))
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
