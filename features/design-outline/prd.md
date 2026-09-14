# 功能：概要设计大纲 / 思维导图（需求管理 → 概要设计 → 文档）

- 代码：`server/store.mjs`（只读聚合 `buildDesignOutline`）、`server/ops.mjs`（`renderDesignOutlineMd` / `applyDesignOutline`）
- 入口：HTTP（`GET /api/nodes/:id/design-outline`、`POST /api/nodes/:id/design-outline/apply`）· CLI（`design outline|apply <ref>`）· MCP（`design_outline` / `design_outline_apply`）
- 主设计文档：`../../docs/design.md` §2.1（文档 / mermaid）；`../../docs/design/04-api.md`（接口表）

## 1. 目标

需求就绪门禁把「概要设计」文档列为进入回归测试的三条硬门禁之一，但此前 **没有生成侧**：
门禁只会判「概要设计文档在不在、正文空不空」，一份新需求要进入测试，只能靠人 / AI 从零手写。

实际上需求的拆分结构（子需求 / 任务组 / 子任务）用户已经在维护。本功能把这份**既有结构**推导成
概要设计骨架 —— 一张 mermaid 思维导图 + 与需求树逐层对齐的小节 —— 并支持一键写入「概要设计」文档，
让需求 → 概要设计 → 文档这条主线有一个可验证的闭环。

## 2. 需求点

- R1 推导范围限 `requirement` / `subreq`（这两类才承载需求正文），与需求就绪门禁同口径；
  其它类型 `scope=self` 报 `VALIDATION_FAILED` 并提示改用 `scope=subtree`。
- R2 结构来自既有需求树：对每个待推导需求，取其子树里的 `subreq` / `group` / `task` / `defect`，
  按 `sort` 顺序长成一棵树；`totals` 给出单元数与节点数。
- R3 输出两种形态：
  - `format=json`（缺省）：结构树 + 计数，供程序消费；
  - `format=md`：可直接写入「概要设计」文档的 markdown 骨架，含 **mermaid mindmap**（复用需求树结构）
    与逐层小节（按节点类型给出「目标与范围 / 子需求设计 / 任务组拆分 / 实现要点 / 缺陷处理」小节名）。
- R4 一键落库：`apply` 把骨架写入各需求的「概要设计」文档，文档名取 `config.readiness.designDoc`，
  **与需求就绪门禁判定的是同一份文档** —— 写对才算通过门禁。
- R5 默认不覆盖：`overwrite=false`（缺省）时已有**非空**内容的「概要设计」文档原样保留，只回报
  `written:false / reason=already_filled`；避免把人工或 AI 写好的设计冲掉。`overwrite=true` 才覆盖。
- R6 `dryRun` 只回报将写哪些、不落库不动 revision，与其余写接口的预演语义一致。
- R7 `scope=self|subtree` 值域统一走 `store.normalizeScope`，非法值一律 `VALIDATION_FAILED`，
  禁止静默降级成 `self`（参见需求就绪门禁 R5a）。
- R8 `buildDesignOutline` 是**只读聚合**，不写库、不动 revision；真正的落库由 `applyDesignOutline`
  经 `upsertDocument` 完成，保持「推导结论 / 写入数据」分离。

## 3. 非目标（首版）

- 不自动填充小节的正文（骨架里小节标注「待补充」，具体方案仍由 AI / 人补写）；
- 不做脑图的图形化拖拽编辑（结构来源是需求树本身，改结构应改树）；
- 不新增数据表 —— 复用 `documents`；
- 不自动触发测试 / 不改 `nodes.status`。

## 4. 验收标准

- `test/design-outline.test.mjs`：结构树推导与节点计数；`scope=subtree` 逐需求；非需求类型 self 拒绝；
  非法 scope 拒绝（不静默降级）；只读聚合不动 revision；markdown 含 mermaid mindmap 与逐层小节；
  节点名含双引号 / 换行时 mermaid 语法不被破坏；空态提示；`apply` 写入后 `design_doc` 门禁转通过；
  默认不覆盖已有正文；`overwrite=true` 才覆盖；`dryRun` 不落库；文档名随 `config.readiness.designDoc`。
- `test/design-outline-entrypoints.test.mjs`：HTTP JSON / md / apply 全链路、非法 scope/format 400、
  apply 后 readiness 转 ready；MCP 与 store 结果逐字段一致、非法 scope 返回 `isError`；
  CLI `design outline` / `design apply` / `--dry-run` / `--format md`；三入口 1:1。
- `npm test` 全绿；`npm run build` 通过；文档同步（本目录 + `docs/design/04-api.md` + `docs/api.md`
  + `docs/design/09-decisions.md` + `features/README.md` + `AGENTS.md`）。
