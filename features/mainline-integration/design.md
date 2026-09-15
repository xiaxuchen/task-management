# 功能设计：主链路集成收口

## 1. 合并顺序与依赖

合并顺序不是任意的，按**数据结构与共享函数**的依赖倒序：

| 顺序 | 分支 | 带进来的能力 | 合并提交 |
|---|---|---|---|
| 1 | `xpx-119-document-history` | 文档版本历史（新增 `document_versions` 表 + 快照） | `6e6c035` |
| 2 | `xpx-122-acceptance-signoff` | 验收签收 + 证据指纹（栈在 119 之上，故紧随其后） | `15da93a` |
| 3 | `xpx-120-requirement-management` | 需求管理（受控状态流转 + 预置双文档） | `df87e47` |
| 4 | `xpx-113-requirement-mindmap` | 概要设计大纲 / 思维导图（`design_outline`） | `527221a` |
| 5 | `xpx-126-requirement-mindmap` | 思维导图只读投影（`mindmap`） | `1833425` |

**为什么 119 必须早于 122**：122 的验收指纹逻辑依赖 119 引入的文档快照语义（它栈在 119 之上，
先合 119 可让 122 基本干净合并）。

**为什么 120 早于 113**：113 的「概要设计」门禁要写 `config.readiness.designDoc` 对应的文档，
而 120 决定了 `requirement` 节点会**预置**这份文档。顺序反了会把两套假设都合错。

## 2. 端到端回归脚本的设计

`scripts/e2e-mainline.mjs` 只用**公开入口**（CLI 子进程 + HTTP 端点），不直接调 store 做断言，
这样它验证的是「用户与 AI 真实能跑通的链路」。它顺序覆盖九个阶段：

1. 需求管理：`requirement create` → `transition`（含非法状态被拒）
2. 文档：写「需求内容」
3. 概要设计：`design outline`（含 mermaid 脑图）→ `design apply`（含重复 apply 不覆盖）
4. 思维导图：`mindmap`（含深度截断与非法参数被拒）
5. AI 可回归测试：`test case upsert`（regression / code_check / biz_check）+ `test run --dry-run`
6. 需求就绪门禁：三条门禁齐备 → `ready=true`
7. 测试报告 / 验收报告 / 验收签收
8. 上线治理：`release item upsert`（config / sql）→ `release checklist`（未完成 `ready=false`，
   完成后 `ready=true`）
9. 交付门禁：**先 `not_ready`、补证据后 `ready`**，并抽查 HTTP 与 CLI 结论一致

**关键设计（证明门禁不是绿灯机器）**：脚本刻意断言交付门禁的两个状态——
没有测试证据时 `decision=not_ready` 且失败来源恰为「测试验收」；为全部启用用例补上
`pass` 结论并重新签收后 `decision=ready`。一条只会返回 `ready` 的门禁会在这两处之一失败。

**为什么模拟回写而不是真派单**：完整派单会拉起 `qodercli` 子进程（真正执行测试），
属于 PM 明确要单独派发的「测试阶段」。脚本用**同一套核心能力**开报告，再走**公开 CLI 入口**
`test report finish` 回写终态——路径与真实收尾完全一致，只是不真的跑测试。

## 3. 集成中发现的契约冲突（先修阻塞项）

合并并非零冲突。以下几处是**跨分支的真实契约冲突**，都按「先修阻塞项」处理：

**C1 需求预置文档数 4 → 5**（`test/store-nodes.test.mjs`）
119 假定 `requirement` 预置 1 份文档（「需求内容」），120 把它变成 2 份
（+「概要设计」）。级联删除计数因此从 4 变 5。修法：按合并后的预置拓扑改期望值，
并在注释里写清 4→5 的来源，避免下次又被改回去。

**C2 需求就绪门禁的预置文档语义**（`test/design-outline.test.mjs`、`...-entrypoints.test.mjs`）
113 的 `applyDesignOutline` 原先假定「概要设计」文档不存在，`created:true` 表示新建。
120 之后该文档**总是预先存在**（空白），所以写入是 `upsert`：`created:false`、
`written:true`。修法：断言改为真实口径，并把 dryRun 的安全性重新表述为
「预置空白文档仍保持空白」而不是「文档不存在」——**安全意图不变，断言对象更准确**。

**C3 dryRun 的「不落库」含义**（同上）
原断言 `find(...) === undefined` 已不可能成立。改为断言内容仍为空串，
这才是 dryRun 真正要保证的（不写入正文），关注点从「行是否存在」收敛到「内容是否被改」。

**C4 MCP 审计 actor 落点**（`test/design-outline-entrypoints.test.mjs`）
113 新增 `mcp` actor 并断言 `createdBy === 'mcp'`。120 之后文档行由**建节点时**创建
（`createdBy='user'`），AI 的归属落在**内容写入**上。修法：断言 `updatedBy === 'mcp'`
并追加断言「版本历史里存在一条 `reason=update, createdBy=mcp` 的快照」——
比原来更贴近审计要保证的东西（谁改了内容）。

**C5 决策编号撞号**（`docs/design/09-decisions.md`）
120 / 113 都用 36，113 / 122 都用 37，122 另用 39。修法：重排为唯一编号
（36 需求管理 / 37-38 概要设计 / 39 验收签收 / 40-41 思维导图），
并同步更新 `features/design-outline/design.md` 与 `features/requirement-mindmap/design.md`
里对决策号的引用。文档内其它位置无跨引用，重排安全。

**C6 CLI 帮助与 dispatch 的可加性**（`server/cli.mjs`）
113 加 `design outline` / `design apply`（两层命令），126 加 `mindmap`（单层命令）。
两者共用同一个 switch，`mindmap` 需要在 switch 前做位置归一化（ref 落在 action 位）。
合并时保留两条路径并用 e2e 覆盖，确认互不影响。

## 4. 踩坑与约束

- **e2e 必须显式固定 `TASKBOARD_HOME`**：脚本自身会 `openDb()` 做 HTTP 抽查，
  若不把 `process.env.TASKBOARD_HOME` 指向隔离目录，会落到真实 `~/.taskboard`。
- **签收按 `(node, scope)` 存储**：门禁用 `subtree` 口径查，签收也必须用 `--scope subtree`，
  否则出现「签了 self、门禁查 subtree」的错配，表现为「明明签了却仍 pending」。
- **证据变化会让签收失效**（设计行为）：补测试报告后原签收 `stale`，需重新签收。
  e2e 顺带把这条语义也断言了。
- **验收来源聚合子树内全部启用用例**（含 `code_check` / `biz_check`）：只跑 regression
  不足以让门禁转绿。
- **合并时不要用 `-X ours/theirs` 一把梭**：本轮冲突多为「两侧都对、需并集」，
  机器选择会静默丢能力（例如丢掉 113 的 `概要设计` 页签或 126 的 `导图` 页签）。

## 5. 关联章节

- 交付门禁语义：`docs/design/04-api.md`「交付门禁」段、决策 33/34/35/39
- 需求管理：决策 36；概要设计：决策 37/38；思维导图：决策 40/41
- 测试策略：`docs/design/08-testing.md`（`test/e2e-mainline.test.mjs`）
- 本目录 `test-report.md`：本轮端到端验收报告
