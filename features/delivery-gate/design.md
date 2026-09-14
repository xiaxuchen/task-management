# 功能设计：交付门禁

## 1. 模块职责

- `server/store.mjs`：新增纯读聚合 `buildDeliveryGate(nodeId, { scope })`。
  - 调用既有 `buildRequirementReadiness` / `buildAcceptanceReport` / `buildReleaseChecklist`；
  - 不直接查明细表，避免和三个来源的口径漂移；
  - 不写库、不 bump revision。
- `server/ops.mjs`：新增 `renderDeliveryGateMd(gate)`，并把 `delivery_gate` 登记进 `TOOLS`。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露。
- `web/src/components/NodeDrawer.vue` + `web/src/api.js`：抽屉「交付」页签，切换 `self` / `subtree`。

## 2. 关键规则

**R1 为什么复用三个既有聚合**：三个来源已经分别实现了状态机、分桶与空态口径。
交付门禁的价值在于「汇总」，不是第二次定义什么叫就绪、通过、上线完成；任何重复实现都会分叉。

**R2 `not_applicable` 不阻塞也不冒充通过**：

- 非需求节点上的 `self` 没有需求就绪判定；
- 没有测试用例时没有验收结论；
- 没有必做上线项时没有上线阻塞。

这三者都返回 `not_applicable`，不进入通过计数，也不进入阻塞项。若所有来源都不适用，整体是 `unknown`，
`ready=null`，调用方应提示「没有可判定的交付证据」，而不是展示绿灯。

**R3 `acceptance` 的门禁口径比通过率更严格**：验收报告里 `running` 与 `not_run` 不计入通过率分母，
但交付时它们都不是可交付证据。因此只要存在 `fail / blocked / error / cancelled / running / notRun` 任一桶，
测试验收来源就是 `fail`；只有所有用例最近结果均为 `pass` 才通过。

**R4 `release` 只被必做项阻塞**：复用 `buildReleaseChecklist`：`ready=null` 映射为 `not_applicable`，
`ready=true` 映射为 `pass`，`ready=false` 映射为 `fail`。可选项未完成不会阻塞交付。

**R5 blocker 展平到条目级**：需求就绪给出未过门禁，测试给出未通过 / 未完成用例，上线给出未完成必做项。
让 AI 与人都能直接从 `blockers` 生成待办，而不用再去遍历三个 evidence 对象。

**R6 三入口与 UI 同源**：HTTP / CLI / MCP / Web 都直接消费 `buildDeliveryGate` 的返回值；
UI 只做标签映射，不复制判定逻辑。

## 3. 踩坑 / 约束

- `buildDeliveryGate` 是纯读入口：测试必须断言 revision 不变，防止后续实现误写审计。
- `readiness` 在非需求节点 `self` 下会抛 `VALIDATION_FAILED`。汇总层必须先判断 `applicable`，不能直接调用。
- `scope=subtree` 下，节点本身可能不是需求，但子树有需求；此时应纳入 readiness，而不是把来源标为不适用。
- `not_applicable` 不是「可选功能不存在」的同义词：它只表示当前范围没有该类证据。
- `scope` 由 `store.normalizeScope` 单点校验（`self|subtree`，缺省 `self`，其余 `VALIDATION_FAILED`）；
  **不得**在入口先做 `scope === 'subtree' ? 'subtree' : 'self'`——那会把非法值吞成 `self`，
  让「子树未就绪」被判成可交付。
- 状态三态命名固定为 `pass / fail / not_applicable`；最终 decision 固定为 `ready / not_ready / unknown`，
  避免 UI 与 AI 各自猜「空态」的语义。

## 4. 关联章节

- 接口表：`docs/design/04-api.md`「交付门禁」段
- 接口示例：`docs/api.md`
- UI：`docs/design/06-ui.md` §8.2
- 测试策略：`docs/design/08-testing.md`（单测分组：`test/delivery-gate.test.mjs`）
- 决策：`docs/design/09-decisions.md` 决策 31
- 前置功能：`../requirement-readiness/`、`../regression-loop/`、`../release-governance/`
