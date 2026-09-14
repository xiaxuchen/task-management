# 功能：需求就绪门禁（需求管理闭环的前置判定）

- 代码：`server/store.mjs`（就绪聚合 `buildRequirementReadiness`）、`server/ops.mjs`（`renderReadinessMd`）、`server/config.mjs`（门禁口径配置）
- 入口：HTTP（`/api/nodes/:id/readiness`）· CLI（`readiness check <ref>`）· MCP（`requirement_readiness`）
- 主设计文档：`../../docs/design.md` §4.2（documents 预置）/ §4.14（test_cases）；`../../docs/design/04-api.md`（接口表）

## 1. 目标

「需求管理」闭环此前只有后半段的结论：验收报告（`acceptance_report`）回答「测完没有」，
上线检查清单（`release_checklist`）回答「能不能上线」。**起点没有判定**——一份需求在进入回归测试之前，
是否已经具备需求文档、概要设计、可回归用例，只能靠人肉翻抽屉看。

本功能补上闭环的**前置判定**：把「需求内容 / 概要设计 / 可回归测试用例」三条门禁聚合为一个
可查询、可贴进 issue 的确定结论，让「这份需求够不够格进入测试」不再是主观判断。

统一口径：`ready=true` 才允许进入回归测试；`ready=null` 表示**没有可判定的需求**（不是「未就绪」）。

## 2. 需求点

- R1 门禁挂在 `requirement` / `subreq` 节点上（这两类才是需求管理的对象）；其它类型 `scope=self` 报
  `VALIDATION_FAILED`，并提示改用 `scope=subtree`。
- R2 三条门禁（每条独立判定、各自给出依据）：
  - **需求内容文档**：节点下存在名为「需求内容」的文档且正文非空白；
  - **概要设计文档**：节点下存在名为「概要设计」的文档且正文非空白；
  - **可回归测试用例**：节点下存在 ≥1 条启用中的用例，`kind ∈ {regression, acceptance}`。
- R3 门禁口径可配置（`config.readiness`）：文档名与用例类型都是值域而非硬编码，
  便于团队改用「详细设计」等其它命名而不改代码。
- R4 `scope=self` 判定单个节点；`scope=subtree` 判定该节点及其子树内**所有** `requirement` / `subreq`，
  返回逐需求的 `units` 与顶层汇总结论。
- R5 结果口径与既有报告一致：顶层 `ready` 在所有单元就绪时为 `true`，任一未就绪为 `false`，
  **无待判定需求时为 `null`**（不用 `false` 冒充未就绪）。
- R5a `scope` 值域校验：只接受 `self` / `subtree`（缺省 = `self`），其余（含大小写错 / 空串）
  一律 `VALIDATION_FAILED`，**不得静默降级为 `self`**——否则「本节点就绪、子树未就绪」会被翻成
  `ready=true`，放行门禁失去可信度。同一份校验在验收报告 / 上线清单 / 交付门禁 / 分支聚合上共用。
- R6 输出 `items`（逐条门禁 + 依据）/ `blockers`（未通过项）/ `totals`（单元与门禁计数），
  并支持 `format=md` 直接贴进 issue / 评审记录。
- R7 只读聚合：**不写库、不动 revision**——门禁是「读出来的结论」，不是「流水线上的一步」。

## 3. 非目标（首版）

- 不自动生成需求文档 / 概要设计（由 AI 通过 `doc_upsert` 撰写）；
- 不自动补测试用例（由 AI 通过 `test_case_upsert` 撰写）；
- 不改 `nodes.status`、不做状态机强约束——门禁只输出结论，是否拦截由调用方决定；
- 不新增数据表（复用 `documents` + `test_cases`）。

## 4. 验收标准

- `test/readiness.test.mjs`：三条门禁各自独立判定；文档「存在但正文空白」不算通过；
  停用用例不算通过；`kind=code_check` 不算「可回归」；`scope=subtree` 汇总与逐单元结论；
  `ready=null` 空态；非需求类型 `scope=self` 拒绝并提示 `subtree`；聚合只读（revision 不变）。
- `test/scope-validation.test.mjs`：`normalizeScope` 值域（缺省 / 合法 / 非法）；
  四个聚合构建器拒绝非法 `scope`；非法 `scope` 不再把未就绪子树翻成 `ready=true`（D2 核心回归）；
  MCP 聚合工具对非法 `scope` 返回 `isError`（三入口契约一致）。
- `test/http.test.mjs`：全链路（建需求 → 未就绪 → 补文档 + 用例 → 就绪）、`format=md`、`scope=subtree`。
- `npm test` 全绿；三入口 1:1；文档同步更新（本目录 + `docs/design/02-data-model.md` + `docs/design/04-api.md`
  + `docs/api.md` + `docs/design/08-testing.md` + `features/README.md`）。
