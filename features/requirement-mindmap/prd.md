# 功能：需求思维导图（树 → mermaid mindmap 只读投影）

- 代码：`server/store.mjs`（`buildMindmap`）、`server/ops.mjs`（`renderMindmapMd` + `TOOLS` 登记）、
  `server/http.mjs` / `cli.mjs` / `mcp.mjs`（三入口）、`web/src/components/MindmapPane.vue`（抽屉「导图」页签）
- 入口：HTTP（`GET /api/nodes/:id/mindmap`）· CLI（`mindmap <ref>`）· MCP（`mindmap`）· Web（节点抽屉「导图」页签）
- 主设计文档：`../../docs/design.md` §2.1；`../../docs/design/04-api.md`（接口表）；`../../docs/design/06-ui.md`（抽屉页签）

## 1. 目标

任务树是层级结构，但 Web 与 AI 此前只能以「表格式展开树」逐层查看，缺少一眼俯瞰
「这份需求拆成了哪些子需求 / 任务组 / 子任务」的视图。导图是需求管理闭环里
「需求拆解是否合理」的天然载体，也是 `requirement_readiness` 之后人最常需要的第二种视图。

本功能把既有节点树**只读投影**成 mermaid `mindmap` 文本：AI 可直接贴进 issue / 设计文档，
Web 用站点既有的 Vditor mermaid 渲染链路画出来。不新增数据表、不改变任何写路径。

## 2. 需求点

- R1 `buildMindmap(nodeId, { scope, maxDepth })` 挂任意节点；`scope=self` 只画本节点，
  `scope=subtree` 画本节点及其整棵子树（与 readiness / acceptance / delivery-gate 同一份 scope 口径）。
- R2 输出 mermaid `mindmap` 文本（首行 `mindmap`，层级用缩进表达）**以及**结构化
  `nodes` / `edges` / `totals`：
  - `mermaid`：可直接渲染 / 粘贴的代码块正文；
  - `nodes`：`{id, name, type, status, depth}` 列表（含 `depth`，便于前端做深度分析）；
  - `edges`：`{from, to}` 父子边；树的性质保证 `edges = nodes - 1`（非空子树）；
  - `totals`：`{nodes, edges, depth, byType, truncated}`。
- R3 标签安全：mermaid mindmap 的节点串用 `["文本"]` 承载，文本里的 `"` 会提前闭合节点串，
  因此 `"` → `&quot;`、`&` → `&amp;`（先转义 `&`，避免二次转义）；空名用占位符 `（未命名）`。
  其余字符（括号 / 方括号 / 花括号 / 竖线 / `#` / 冒号 / 中文 / 反斜杠 / 换行）在引号内实测 mermaid 11.x 均接受。
- R4 深度保护：`maxDepth` 为 `0..50` 的整数；超出或非法（含 `''`、越界、非整数）一律
  `VALIDATION_FAILED`，**不静默降级**。触达深度上限且有子节点时，`totals.truncated` 记被截断的**子节点数**，
  让调用方察觉「图被截了」，而不是把截断后的图当成完整树。
- R5 `scope` / `format` 值域校验复用 `store.normalizeScope` / `normalizeFormat`，与其它聚合接口一致；
  非法值 `400 VALIDATION_FAILED`（MCP 返回 `isError`），不静默降级。
- R6 `format=md` 返回可粘贴 markdown（标题 + 统计行 + ```mermaid 代码块）；
  缺省 `json`。三入口 1:1，同一节点同一 scope 的 `mermaid` 文本必须逐字节一致。
- R7 **纯读**：不写库、不动 revision——与 `acceptance_report` / `readiness` / `delivery_gate`
  同一条「结论不落库」原则（AI 可高频轮询做看板而不制造变更噪声）。
- R8 Web「导图」页签：默认 `scope=subtree`（导图的用途就是俯瞰子树），可切 `仅本节点`，
  展示 `节点 / 连接 / 深度` 统计与截断提示，支持一键复制 mermaid。

## 3. 非目标（首版）

- 不做拖拽编辑导图（导图是**投影**，真相仍在节点树上；改结构请改节点）。
- 不做富样式（颜色 / 图标 / 优先级着色）——首版只投影 `name`，`type` / `status` 放在结构化字段里备用。
- 不做多语言节点标签 / 自定义根标签。
- 不引入服务端图布局引擎：渲染交给前端 Vditor 内置的 mermaid，服务端只产出文本。

## 4. 验收标准

- `test/mindmap.test.mjs`：`scope=self` / `subtree` 的节点·边·深度计数；mermaid 首行与逐层 `+2` 空格缩进、
  顶层唯一；`"` / `&` 转义（含 `&amp;` 不二次转义）；空名占位符；`maxDepth` 截断计数与 `0` 只保留根；
  非法 `maxDepth` 一律 `VALIDATION_FAILED`；纯读（revision 不变）；`renderMindmapMd` 输出与 `TOOLS` 登记。
- `test/mindmap-entrypoints.test.mjs`：HTTP（JSON / md / 非法 scope / 非法 maxDepth / 非法 format）、
  CLI（单层命令可用 + 路径引用 + `--max-depth` + 非法值）、MCP（JSON / md / isError）、
  以及**三入口 1:1 的 mermaid 文本一致性**。
- `npm test` 全绿；`npm run build` 通过（新增 Vue 组件可编译）。
- 文档同步：本目录三件套 + `docs/design/04-api.md` + `docs/api.md` + `docs/design/06-ui.md`
  + `docs/design/08-testing.md` + `docs/design/09-decisions.md` + `features/README.md`。

## 5. 断点背景（本次为何选它）

审计发现：CLI 帮助里**早已列出** `mindmap <ref>`，但 `server/cli.mjs` 没有对应 dispatch case，
执行即报「未知命令」；同时 store / HTTP / render 三层半成品散落在工作区（未提交到任何分支），
MCP、UT、需求 / 设计文档全部缺失。即「文档承诺的能力实际不可用」——这是主链路上最实的一处断点，
且恰好落在 PM 点名要补的「思维导图」环节。本迭代把它补齐到端到端可交付。
