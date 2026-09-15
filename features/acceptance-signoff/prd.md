# 功能：验收签收（测试通过不代表业务验收）

- 代码：`server/db.mjs`（acceptance_signoffs）、`server/store.mjs`（buildAcceptanceStatus / upsertAcceptanceSignoff）
- 入口：HTTP（`/api/nodes/:id/acceptance-status`、`/acceptance-signoff`）· CLI（`test acceptance-status|acceptance-sign`）· MCP（`acceptance_status` / `acceptance_sign`）
- 相邻功能：`../regression-loop/`（测试证据）、`../delivery-gate/`（交付判定）

## 1. 目标

补齐研发工作流里的**业务验收结论**：测试报告只能证明「测试做了什么、结果如何」，
不能证明「需求方已经接受这个结果」。本功能把签收人、验收意见和当时的测试证据绑定在一起，
并让交付门禁在「测试全绿但未签收 / 已驳回 / 签收后证据变化」时保持不可交付。

## 2. 需求点

- R1 验收签收挂在任意节点上，`scope=self|subtree` 与验收报告同口径。
- R2 结论只有 `accepted` / `rejected`，可携带验收意见；签收人取入口 actor
  （Web=user、CLI=cli、MCP=mcp）。
- R3 状态机：无用例 `not_applicable`；有用例未签收 `pending`；签收后证据变化 `stale`；
  其余为 `accepted` / `rejected`。
- R4 证据绑定：签收保存验收报告（用例、执行指令、期望、最近报告及结论、分桶）的 sha256 指纹；
  任何测试证据变化都会让旧签收失效。
- R5 交付门禁：验收来源只在「无阻塞测试结果 + 当前证据 accepted」时通过；
  `pending/rejected/stale` 一律阻塞并给出可行动 blocker。
- R6 三入口 1:1，支持 `format=md`；纯读状态查询不写库、不动 revision，签收写入只 +1。

## 3. 非目标（首版）

- 不做多级会签 / 角色权限模型；
- 不自动签收；
- 不替代 test_reports 的执行证据，只记录业务结论。

## 4. 验收标准

- `test/acceptance-signoff.test.mjs`：pending → accepted、rejected → accepted、证据变化 stale、
  用例期望变化 stale、空用例拒绝、非法值拒绝、revision 语义、HTTP/CLI/MCP 一致。
- `test/delivery-gate.test.mjs` / `test/http.test.mjs` / `test/cli-regression-loop.test.mjs`：
  原有交付链路补签收后仍通过。
- `npm test` 全绿；`npm run build` 通过；文档同步更新。
