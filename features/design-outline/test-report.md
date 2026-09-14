# 概要设计大纲 / 思维导图 —— 回归测试报告

- 被测仓库：`xiaxuchen/task-management`（本地 `/Users/xuchen.xia/charge2/task-board`）
- 被测分支 / 提交：`agent/xpx-113-requirement-mindmap` @ `b7b9429`
- 测试角色：高级测试（本轮回归验证与测试报告）
- 报告落盘：`features/design-outline/test-report.md`

## 1. 测试概要

针对资深开发交付的「需求管理 → 概要设计 → 文档」生成侧切片做回归验证。切片把需求就绪门禁里
「概要设计」这条硬门禁补上了生成侧：从既有需求树推导 markdown 骨架（mermaid 思维导图 + 逐层小节），
并经三入口（HTTP / CLI / MCP）一键写入与门禁同一份「概要设计」文档。

本轮重点不是复跑 UT，而是独立核对产品经理指定的三处口径是否真的成立：

| 口径 | 独立验证手段 | 结论 |
|---|---|---|
| 三入口写入的是与 readiness `designDoc` 同一份文档 | 用自定义 `designDoc=详细设计` 配置，分别走 HTTP / CLI / MCP 落库后反查 readiness 判定 | 成立 |
| 默认不覆盖的幂等语义 | 空白文档应写入、非空文档应跳过并保内容、`overwrite:true` 才覆盖 | 成立 |
| 只读推导不 bump revision | 三入口的 outline 读取 + `dryRun` 前后比对 revision | 成立（推导侧） |
| 端到端链路 | 推导 → apply → readiness `design_doc` 转通过 → 再次 apply 幂等（HTTP 真实链路） | 成立 |

**总体结论：切片主线可用，三处口径与端到端闭环均成立；发现 3 个缺陷（1 严重 / 2 一般），
其中 HTTP `apply` 未透传 `dryRun` 属可造成误覆盖的实写缺陷，建议打回开发修正后再进验收。**

## 2. 测试范围与环境

- 范围：`server/store.mjs`（`buildDesignOutline`）、`server/ops.mjs`（`renderDesignOutlineMd` /
  `applyDesignOutline`）、三入口装配（`server/http.mjs` / `server/cli.mjs` / `server/mcp.mjs`）。
- 环境：Node v22.22.0（`node:test`）；本地 `TASKBOARD_HOME` 临时目录隔离；HTTP 用真实 `createApp`
  监听随机端口；MCP 用 `InMemoryTransport` 真实协议；CLI 用 `bin/taskboard.js` 子进程。
- 基线：`npm test` 268 通过 / 0 失败；`npm run build` 通过。
- 补充验证：mermaid 思维导图用真实 mermaid 解析器（bundled `vditor` 4.0 mermaid + jsdom/DOMPurify）
  校验语法可渲染，而非仅断言字符串包含。

## 3. 模块拆分 & 用例清单

**A. 结构推导（store.buildDesignOutline）**
- 从需求树推导结构树与节点计数（R + S1 + G + T1 + S2 = 5）；`scope=self` / `subtree` 语义。
- 非需求类型 `self` → `VALIDATION_FAILED` 且提示改用 `subtree`；子树无需求 → 空态不报错。
- 只读：不写库、不动 revision（HTTP GET / CLI outline / MCP design_outline 三入口分别核对）。

**B. 骨架渲染（ops.renderDesignOutlineMd）**
- 含 mermaid mindmap + 逐层小节；节点名含双引号 / 换行时脑图语法不被破坏。
- 特殊符号（`<>` `|` 反引号 `\` `()` `[]` `{}`）与超长名（5000+ 字符）下语法仍可解析。
- **真实解析器验证**：`self` / `subtree` / 光杆需求 / 带引号换行 / 特殊符号 5 种骨架 `mermaid.parse` 全部通过；
  负例（未闭合、非图类型、多层嵌套）正确失败，证明解析器是活的。

**C. 落库与门禁（ops.applyDesignOutline）**
- 写入后 readiness `design_doc` 转通过；文档名取 `config.readiness.designDoc`（三入口均用自定义名验证）。
- 默认不覆盖：空白视为未填写（写入）、非空跳过（`already_filled`）且内容原样保留、`overwrite:true` 才覆盖。
- `scope=subtree` 逐需求各写一份，各自独立判定覆盖。

**D. 三入口一致性**
- HTTP GET JSON / `format=md` / POST apply；CLI `design outline` / `design apply` / `--dry-run` / `--format md`；
  MCP `design_outline` / `design_outline_apply`。
- 非法 `scope` / `format` 一律 `VALIDATION_FAILED`（HTTP 400、CLI 非零退出、MCP `isError`），不静默降级。

**E. 端到端链路（真实 HTTP）**
- 推导（`totals.units=1`，md 含 mindmap）→ `design_doc` 写前未通过 → apply `written=1` 且 bump 一次
  → readiness `design_doc` 转通过、`ready=true` → 再次 apply `written=0 / already_filled`、内容与 revision 不变。

## 4. 异常专项测试用例

| # | 场景 | 输入 | 预期 | 实测 |
|---|---|---|---|---|
| E1 | 非法 scope（大小写/拼写/空串） | `Subtree` / `subtre` / `all` / `""` | 400 `VALIDATION_FAILED` | 符合 |
| E2 | 非需求类型 self | project 上取 outline | 400 并提示 `subtree` | 符合 |
| E3 | 未知节点 | 不存在的路径 apply | `PATH_NOT_FOUND` | 符合 |
| E4 | 空结构 | 项目子树无需求 | 空态提示，不报错 | 符合 |
| E5 | 超长/特殊符号 | 5000+ 字符 + `<>|` 等 | 脑图仍可解析 | 符合 |
| E6 | 空白已有文档 | 概要设计 = 空格 | 视为未填写并写入 | 符合 |
| E7 | `overwrite` + `dryRun` 同传（HTTP） | `{overwrite:true, dryRun:true}` | 只预演、不落库 | **不符合 → D1** |
| E8 | `dryRun`（MCP） | `{dryRun:true}` | 只预演、不落库 | **不符合 → D2** |

## 5. 缺陷汇总

### D1（严重）HTTP `POST /design-outline/apply` 未透传 `dryRun`，预演变成实写、可误覆盖人工文档

- 位置：`server/http.mjs:585`（apply 路由体内只装配 `scope` / `overwrite` / `by`，丢失 `body.dryRun`）。
- 对照：`server/cli.mjs:466` 正确透传 `dryRun: !!values['dry-run']`；`server/ops.mjs` 的
  `applyDesignOutline` 对 `dryRun` 处理正确。即 **CLI 与 store 都对、唯独 HTTP 入口丢失该参数**，
  与设计文档 R6「`dryRun` 只回报将写哪些、不落库不动 revision」和三入口 1:1 口径冲突。
- 复现：
  - `POST /api/nodes/{id}/design-outline/apply` body `{"dryRun":true}` →
    实测返回 `dryRun:false, written:1`，文档被创建、revision `2→3`。
  - 叠加覆盖时更危险：body `{"overwrite":true,"dryRun":true}` → 实测返回 `dryRun:false, written:1`，
    **已有的人工设计正文被覆盖销毁**，而调用方以为只是预览。
- 影响：任何按文档传 `dryRun` 的 HTTP 调用方（前端、脚本、AI）都会在「预览」语义下触发真实写入；
  与 `overwrite:true` 组合即静默破坏人工成果，属数据安全问题。
- 建议：路由体补 `dryRun: !!body.dryRun`，并补一条 HTTP `apply` + `dryRun` 的回归用例
  （现有 UT 覆盖了 CLI `--dry-run`，未覆盖 HTTP）。

### D2（一般）MCP `design_outline_apply` 不接受 `dryRun`，且静默忽略

- 位置：`server/mcp.mjs:790`（工具 schema 仅 `node / scope / overwrite`，无 `dryRun`）。
- 复现：`design_outline_apply {node, dryRun:true}` → 未报错（`isError` 为空），但返回 `dryRun:false, written:1`，
  文档被创建、revision 递增。即参数被静默吞掉，而非明确拒绝。
- 影响：AI / MCP 路径缺失「先预演再落库」能力（设计文档 R6 的预演语义在 MCP 侧不可达）；
  静默忽略比报错更危险——调用方无法察觉预演未生效。三入口能力不对齐。
- 建议：schema 补 `dryRun: z.boolean().optional()` 并透传；或在 `mcpValidate` 拒绝未知参数，
  避免「传了但没生效」。

### D3（一般 / 优化）MCP 落库 actor 归属失真：`'mcp'` 被降级为 `'user'`

- 位置：`server/mcp.mjs:799` 传 `by: 'mcp'`；`server/store.mjs:4` 的 `ACTORS` 仅
  `['user','ai','cli','import']`，`actor()`（`server/store.mjs:135`）对未知值回退 `'user'`。
- 实测：MCP `doc_upsert` 写入文档 `updatedBy=ai`；MCP `design_outline_apply` 写入同一文档
  `updatedBy=user`，两者不一致。
- 影响：AI 经 MCP 生成的概要设计在审计字段上被记成「用户写的」，追溯与可信度受损。
- 备注：`'mcp'` 作为 actor 传入是 `server/mcp.mjs` 既有模式（`doc_upsert` 之外多处），
  非本切片引入；但 `design_outline_apply` 新继承了该问题，建议一并收口为 `'ai'` 或把 `'mcp'`
  纳入 `ACTORS`。

## 6. 测试结论 & 优化建议

- **结论**：三处重点口径（同一份 `designDoc` 文档、默认不覆盖幂等、只读推导不 bump revision）经独立验证
  全部成立；端到端链路（推导 → apply → readiness `design_doc` 转通过 → 再 apply 幂等）在真实 HTTP 入口通过。
  `npm test` 268 通过、`npm run build` 通过，mindmap 经真实解析器可渲染。主线功能可交付。
- **但** HTTP `apply` 的 `dryRun` 缺失（D1）会使「预览」变「实写」并可能覆盖人工设计，
  建议**打回开发修正 D1（含回归用例）后再进验收**；D2 / D3 建议同批收口。
- 遗留风险：
  1. 三入口的 `dryRun` 能力当前不对齐（HTTP 丢失、MCP 缺失、CLI 正确），修 D1/D2 后需补一条
     三入口 `dryRun` 一致性回归，防止再次漂移。
  2. actor 归属在 MCP 侧系统性降级为 `user`（D3），影响审计而非功能，建议独立收口。
  3. `apply` 为逐单元顺序写、非事务（设计文档已说明为刻意取舍）；大批量 `subtree` 下部分失败时
     仅能靠逐条 `results[]` 观察，调用方需自行处理中间态。
  4. 本轮未做并发 / 断网 / 超时专项（切片为本地同步 SQLite 写，无外网依赖），如需上线级压测可另开一轮。
