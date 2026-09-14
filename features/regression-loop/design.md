# 功能设计：回归测试闭环

## 1. 模块职责

- `server/db.mjs`：新增 `test_cases` / `test_reports` 两张表（SCHEMA 对新库生效，`migrate()` 对老库幂等补表）。
- `server/store.mjs`：唯一读写核心。
  - 用例：`createTestCase` / `listTestCases` / `getTestCase` / `upsertTestCase` / `updateTestCase` / `deleteTestCase` / `reorderTestCases`
  - 报告：`createTestReport` / `listTestReports` / `getTestReport` / `finishTestReport`
  - 聚合：`buildAcceptanceReport`（按节点或子树汇总最近结果与通过率）
- `server/ops.mjs`：跨 store 的编排，不绑定入口。
  - `runTestCases`：选用例 → 拼提示词 → `startAgentRun` 派单 → 开 running 报告；`dryRun` 走纯预演分支。
  - `composeTestPrompt`：把用例拼成给 agent 的回归指令（显式要求 `PASS|FAIL|BLOCKED` 逐条结论）。
  - `renderAcceptanceMd`：聚合结果 → markdown 验收报告。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露（只做参数装配 + 错误映射）。

## 2. 关键规则

**R1 为什么挂在任意节点上**：需求 / 子需求 / 任务组 / 子任务都可能需要回归；缺陷也常需要复现验证。
用统一的 `node_id` 挂载，避免为每类节点各建一张表。

**R2 `kind` 作为扩展轴**：表约束里直接列出五个取值，v1 只实现前两个的执行语义，
其余三个（`code_check` / `biz_check` / `release_check`）先可用作分类标签——
上线配置 / 上线 SQL / 代码检查 / 业务检查的后续需求可以**只加用例与检查器**，不动表结构与入口契约。

**R3 upsert 幂等**：AI 反复调用 `test_case_upsert` 安全（与 `doc_upsert` 一致）；
按 `(node_id, name)` 唯一，`created` 标记让调用方知道是新建还是覆盖。

**R4 执行与报告解耦**：`runTestCases` 只负责「派单 + 开报告」，不阻塞等待 agent 结果。
agent 任务结束后由前台执行者（或后续收尾钩子）用 `test_report_finish` 逐条回写 pass/fail。
这样复用现有 agent 运行时（qodercli 后台 / Qoder IDE 前台 ideMode），不引入新的执行器。

**R5 验收口径**：验收报告的通过率**以已执行用例为分母**（未执行单独计入 `notRun`），
避免「没跑 = 失败」误导判断；`passRate` 在无用例 / 无执行时为 `null` 而非 0。

**R6 历史保留**：删除用例时报告不删（`case_id` 经 `ON DELETE SET NULL` 置空），
历史执行记录仍可追溯。

## 3. 踩坑 / 约束

- `runTestCases(store, nodeId, …)` 的第一个参数是 **store**，不是 node；三入口装配时别传错
  （HTTP / MCP / CLI 各有一处）；传错时 `dryRun` 会返回 `undefined` 而不是对象。
- 报告状态机只有「running → 终态」的语义约束，未在 DB 设触发器；
  `finishTestReport` 允许改回 running（极少用），以保证前台回写幂等。
- `runTestCases` 需要节点子树内有带本地路径的登记仓库才能真派单；
  纯用例管理（upsert / dryRun / acceptance）不依赖仓库，可在任意节点使用。

## 4. 关联章节

- 数据模型：`docs/design/02-data-model.md` §4.14
- 接口表：`docs/design/04-api.md`「回归测试闭环」段
- 接口示例：`docs/api.md`
- 测试策略：`docs/design/08-testing.md`（单测分组：`test/test-case.test.mjs`）
