# 功能设计：需求就绪门禁

## 1. 模块职责

- `server/config.mjs`：新增 `readiness` 配置块（门禁文档名 / 用例类型），随 `config.json` 可覆盖。
- `server/store.mjs`：唯一读写核心，新增 `buildRequirementReadiness(nodeId, {scope})`——
  选定待判定单元 → 逐单元评估三条门禁 → 汇总顶层结论。**纯读，不 bump revision**。
- `server/ops.mjs`：`renderReadinessMd(readiness)` 把聚合结果渲染成 markdown；并把
  `requirement_readiness` 登记进 `TOOLS`（AI 能力发现）。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露（只做参数装配 + 错误映射）。

## 2. 关键规则

**R1 为什么只判 `requirement` / `subreq`**：项目本身不承载需求正文，任务组 / 子任务 / 缺陷是拆分产物。
把节点类型浓缩到需求两层，避免「项目没写需求内容」这类噪声误报。需要看整棵子树时用 `scope=subtree`
挂在项目上——此时只挑出子树里的需求两层，与 `release_checklist` 的 scope 口径一致。

**R2 文档「存在」与「写完」是两回事**：节点创建时会按 `docPresets` 预置一张**空白**「需求内容」文档。
如果只判文档存在，新建需求会立刻显示「就绪」，门禁就失去意义。因此判定口径是
**存在同名文档且 `content.trim()` 非空**——预置空文档必须被真正填写才通过。

**R3 为什么不复用 `release_items`**：上线治理那套是**结构化登记 + 状态回写**（需要落库、需要 revision），
因为上线项本身是业务数据。门禁是**从既有数据推导出的结论**（文档在不在、用例有没有），落库会造成
两处真相并需要同步维护。这里选择「只读聚合」，与 `acceptance_report` 不落表同一条设计原则
（见决策 25 / 27）。

**R4 `ready=null` 与 `ready=false` 的区分**：无待判定需求时返回 `null`，与验收报告
`passRate=null`、上线清单「无必做项 `ready=null`」保持同一条口径：**不知道 ≠ 没通过**。
调用方拿到 `null` 应当提示「没有可判定的需求」，而不是把空态当成失败。

**R5 只读语义**：门禁不修改任何数据，因此**不产生 revision**。这是刻意的——
AI 可以高频轮询它做看板，而不该因此制造变更噪声（否则前端 `/api/revision` 轮询会被自己触发）。

**R5.1 scope 必须做值域校验，不得静默降级**：入口层此前统一写成
`scope === 'subtree' ? 'subtree' : 'self'`，把 `Subtree`（大小写错）/ `subtre` / `xyz` / 空串
一律吞成 `self`——在「本节点就绪、子树未就绪」时会把结果从 `ready=false` 翻成 `ready=true`，
即**放行门禁的假绿**。现在由 `store.normalizeScope(scope)` 单点校验：
合法值 `self|subtree` 原样返回，缺省（`undefined`/`null`）取 `self`，其余一律 `VALIDATION_FAILED`
（`details.allowed` 带值域）。同一份校验被 `buildRequirementReadiness` / `buildAcceptanceReport` /
`buildReleaseChecklist` / `buildDeliveryGate` 与 `getNodeDiffs`/`getNodeTracks`/`getNodeDuplicates` 共用，
保证 HTTP / CLI / MCP 三入口契约一致（HTTP/CLI 把原始值透传给 store；MCP 另由 `z.enum` 在协议层拒绝）。

**R5.2 空态口径（`ready=null`）**：只有「节点本身不是需求类型」且 `scope=self` 才拒绝
（R1 场景，提示改用 `subtree`）；**子树里没有需求属于空态**，返回 `ready=null` / `totals.units=0`，
不再抛 400。原实现提前抛错，让 `units.length === 0 ? null : …` 成为不可达分支——
文档承诺与实现二选一，这里选择兑现文档（与上线清单「无必做项 `ready=null`」同口径）。

**R6 为什么把 `items` 展平到顶层**：`scope=subtree` 时调用方最常问的是「还有哪些门禁没过」，
逐单元 `units` 适合渲染树状明细，顶层 `items` / `blockers` 适合直接列出待办。两者都返回，避免调用方二次遍历。

## 3. 踩坑 / 约束

- **不要用文档 `count()` 判存在**：`createNode` 会预置空白文档，`docCount>0` 恒真（见 R2）。
- **`listTestCases` 默认已过滤停用用例**，判定「可回归用例」时无需再筛 `enabled`；
  但若传 `includeDisabled:true` 会把停用用例算进来，聚合里**不要**传该选项。
- **入口不要先做 `scope` 三元再传给 store**：那样非法值到不了校验点（见 R5.1）。
  正确做法是把原始值透传，由 `normalizeScope` 统一判定。
- `scope=self` 挂到 `project` / `group` 上会报 `VALIDATION_FAILED`；错误信息里要带上
  「子树里有 N 个需求」的提示（与 `runReleaseChecks` 的 hintSubtree 同款），否则调用方会误以为没有任何需求。
- 门禁口径来自 `config.readiness`，测试里用默认值即可；改配置项时要同步
  `docs/design/02-data-model.md` 的 config 段与 `test/readiness.test.mjs`。

## 4. 关联章节

- 数据模型：`docs/design/02-data-model.md` §4.10（config 的 readiness 段）
- 接口表：`docs/design/04-api.md`「需求就绪门禁」段
- 接口示例：`docs/api.md`
- 测试策略：`docs/design/08-testing.md`（单测分组：`test/readiness.test.mjs`）
- 相邻功能：`../documents/`（需求内容 / 概要设计文档）、`../regression-loop/`（可回归用例）、
  `../release-governance/`（闭环后半段的结论）
