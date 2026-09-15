# 功能：主链路集成收口（需求 → 交付门禁）

- 代码：`scripts/e2e-mainline.mjs`（端到端回归脚本）、`test/e2e-mainline.test.mjs`（守门测试）
- 集成分支：`agent/xpx-126-mainline-integration`（在 `main` 之上按依赖顺序合入 5 条能力分支）
- 关联功能：`../requirement-management/` · `../documents/` · `../design-outline/` · `../requirement-mindmap/` ·
  `../regression-loop/` · `../acceptance-signoff/` · `../release-governance/` · `../delivery-gate/`

## 1. 背景与目标

需求管理 / 概要设计 / 文档 / 思维导图 / 验收签收等能力分别在各自 agent 分支上实现完成，
但都没有合入 `main`，主链路在主干上实际是**断的**。本功能做的是**集成收口**：
把 5 条分支按依赖顺序合入、解决契约冲突、并**用一次真实的全链路回归证明它们能协同工作**。

目标不是新增业务能力，而是让「需求 → 概要设计 → 文档 → 思维导图 → 可回归测试 →
测试报告 → 验收报告/签收 → 上线配置/SQL/检查 → 交付门禁」在**公开入口**上端到端可跑通。

## 2. 需求点

- R1 按依赖顺序合入：`xpx-119`（文档历史）→ `xpx-122`（验收签收，栈在 119 之上）→
  `xpx-120`（需求管理）→ `xpx-113`（概要设计大纲）→ `xpx-126`（思维导图）。
- R2 集成中发现的契约冲突**先修阻塞项再收口**，不带病合并（详见 `design.md` §3）。
- R3 产出一个**可复现的端到端回归脚本**，只用 CLI / HTTP 公开入口，任何人一条命令可跑：
  `npm run e2e:mainline`。
- R4 全链路通过只是一部分；脚本还必须证明门禁**不是无脑绿灯**——
  没有测试证据时给出 `not_ready`，证据齐备后才转 `ready`。
- R5 三入口 1:1：抽查 `readiness` / `mindmap` / `delivery-gate` 在 HTTP 与 CLI 上结论一致。
- R6 `npm test` 全绿（含把 e2e 脚本作为守门测试的 `test/e2e-mainline.test.mjs`）。
- R7 不做「不稳定的大树性能优化」等非阻塞项（PM 明确要求不混进本轮）。

## 3. 非目标

- 不新增业务功能；不改各分支已定的行为口径（除集成冲突所必需的最小修正）。
- 不派发真实测试任务：按 PM 指示，测试阶段后续单独派发；本轮只验证链路与门禁语义。
- 不合并 `xpx-123` / `xpx-124` / `xpx-127` / `xpx-128` / `xpx-130` 等其它分支（不在本轮范围）。

## 4. 验收标准

- 集成分支上 `npm run e2e:mainline` 退出码 0，输出 20+ 个 `✓` 里程碑与 `# 全链路通过 ✅`。
- `npm test` → 327 条 0 失败；`npm run build` 通过。
- `scripts/e2e-mainline.mjs` 可在任意 `TASKBOARD_HOME`（含临时目录）下重复运行，互不干扰。
- 冲突修复点都有对应断言或测试，不靠「手工确认」。
