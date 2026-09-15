# 功能设计：验收签收

## 1. 模块职责

- `server/db.mjs`：新增 `acceptance_signoffs`（node_id + scope 唯一），SCHEMA 与老库迁移都建表。
- `server/store.mjs`：
  - `buildAcceptanceReport` 增加 `evidenceFingerprint`；
  - `buildAcceptanceStatus` 聚合测试证据与签收状态；
  - `upsertAcceptanceSignoff` 校验结论与用例存在性，写入签收并 bump revision；
  - `buildDeliveryGate` 的 acceptance 来源改看签收有效性。
- `server/ops.mjs`：`renderAcceptanceStatusMd` + TOOLS 登记。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1。
- `web/src/components/NodeDrawer.vue`：交付页签显示签收状态、证据指纹，并提供通过/驳回操作。
- `scripts/{export,import}-snapshot.mjs`：快照包含签收并按 node_id 重映射。

## 2. 关键规则

**R1 测试与验收分离**：`test_reports` 是客观执行事实，`acceptance_signoffs` 是业务判断。
测试全绿只让 acceptance 来源进入「可签收」候选，不能直接变绿。

**R2 证据指纹**：签收时对 scope、分桶、passRate 与按稳定 `caseId` 升序排序的 canonical 用例集合
做 sha256；每条用例纳入 id/name/kind/prompt/expectation/latestStatus/latestReportId。
它覆盖「用例集变化、执行指令变化、期望变化、最新报告变化」四类会导致旧验收结论失效的事件；
展示字段与排序不参与指纹，避免噪声。

**R3 状态优先级**：存在签收时，先判 `stale`，再返回 `accepted/rejected`；
没有签收时按用例数返回 `not_applicable/pending`。这样过期签收绝不会继续显示为已验收。

**R4 blocker 可行动**：测试本身有问题时逐用例列出最近结果；测试全过但签收无效时，
额外给出「尚未完成验收签收 / 验收已驳回 / 验收签收已失效」三类原因。

**R5 写入语义**：签收按 `(node_id, scope)` upsert，重复签收覆盖结论与意见但保留 id；
签收写入是一次 revision 递增，状态查询与交付门禁仍为纯读。

## 3. 踩坑 / 约束

- MCP actor 必须允许 `mcp`，否则 AI 签收会被静默记成 `user`（本功能测试发现的缺陷）。
- 不能把 `scope` 先做三元再传 store：非法值必须由 `normalizeScope` 拒绝。
- 签收只记录结论，不自动改节点 status，也不自动执行任务。
- 删除用例后历史报告保留；签收指纹会因用例集变化自然变 stale。

## 4. 关联章节

- 数据模型：`docs/design/02-data-model.md` §4.14
- 接口表：`docs/design/04-api.md`「回归测试闭环」段
- 接口示例：`docs/api.md`
- 交付口径：`../delivery-gate/`
