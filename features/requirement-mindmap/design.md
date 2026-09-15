# 功能设计：需求思维导图

## 1. 模块职责

- `server/store.mjs`：唯一读写核心，新增 `buildMindmap(nodeId, { scope, maxDepth })`——
  读节点树 → 递归投影 → 产出 mermaid 文本 + `nodes` / `edges` / `totals`。**纯读，不 bump revision**。
- `server/ops.mjs`：`renderMindmapMd(mindmap)` 渲染成可粘贴 markdown；并把 `mindmap` 登记进 `TOOLS`
  （AI 能力发现 / `schema` 自描述）。
- `server/http.mjs`：`GET /api/nodes/:id/mindmap`（`?scope=&maxDepth=&format=`）。
- `server/cli.mjs`：`mindmap <ref>`（**单层命令**，见 R2 踩坑）。
- `server/mcp.mjs`：MCP 工具 `mindmap`。
- `web/src/api.js` + `web/src/components/MindmapPane.vue`：抽屉「导图」页签，复用 Vditor mermaid 渲染。

三入口只做参数装配 + 错误映射，业务逻辑全部在 `store.buildMindmap`（铁律：不得各写一套）。

## 2. 关键规则

**R1 只读投影，不落库**：导图是节点树的**投影**，真相只有一份。落表会产生第二份真相并需要同步维护，
与 `acceptance_report` / `readiness` / `delivery_gate` 同一条原则（决策 25 / 29 / 33）。
因此 `buildMindmap` 不写任何表、不动 revision——AI 可以高频轮询它做看板而不制造变更噪声。

**R2 mermaid mindmap 语法与标签转义**：mermaid 的 `mindmap` 用**缩进**表达父子关系，顶层节点必须唯一。
本项目统一用矩形节点 `["文本"]`（实测 mermaid 11.16 接受 `["x"]` 形式，且允许首行无根标签）。
文本里的裸 `"` 会提前闭合节点串，因此做 HTML 实体转义：先 `&` → `&amp;`，再 `"` → `&quot;`
（顺序不能反，否则会把转义出来的 `&` 再转成 `&amp;`，形成二次转义）。

已验证（对真实 mermaid 11.16 调用 `mermaid.parse`）：当前输出的 `mindmap\n["R"]\n  ["S"]` 形式可解析；
重复兄弟名、冒号、括号、方括号、花括号、`#`、`|`、中文、反斜杠、换行在引号内均通过；
空标签 `[""]` 会解析失败，故空名必须替换成占位符 `（未命名）`。

**R3 深度保护与截断计数**：整棵大树直接渲染会糊成一团，因此提供 `maxDepth`（`0..50`）。
注意语义：`maxDepth=N` 表示**保留到第 N 层**，当某个第 N 层节点还有子节点时，这些子节点被截断，
`totals.truncated` 累加被截断的子节点数。`maxDepth=0` 即只保留根节点。截断计数是必要的——
否则调用方会把截断后的图误当成完整树，据此判断「需求拆解完整」。

**R4 非法参数不静默降级**：`maxDepth` 用 `Number()` 解析时，`''` 会得到 `0`——静默把导图截成只剩根节点，
比报错更难排查。因此把 `''` / 数组 / 越界 / 非整数一律判为非法并抛 `VALIDATION_FAILED`
（与 `scope` 的「不静默降级」同一条纪律，见决策 31）。`scope` / `format` 直接复用
`store.normalizeScope` / `normalizeFormat`，入口透传原始值。

**R5 为什么用缩进而非显式 id 引用**：mermaid mindmap 的父子关系由缩进决定，不写 `A --> B` 这类边。
因此 `edges` 是**派生数据**（给结构化调用方 / 测试用），而不是渲染输入。树的性质保证
`edges = nodes - 1`（有子树时），这条恒等式被单测钉死。

**R6 CLI 为什么是「单层命令」**：`server/cli.mjs` 的 switch key 是 `` `${group} ${action}`.trim() ``。
`readiness check <ref>` / `delivery gate <ref>` 是两层结构（group=readiness, action=check, ref=第 3 个位置），
但帮助与产品口径里 `mindmap <ref>` 是**单层**命令——此时 ref 会落在 `action` 位置，
switch key 变成 `mindmap <ref>` 而永远匹配不到 `case 'mindmap'`（这正是原断点的根因：报「未知命令」）。
修法是在 switch 之前对 `group === 'mindmap'` 做一次位置归一化（把 `action` 挪回 `ref`），
而不是把 case 写成动态拼接——后者会让命令解析对节点名 / id 的取值敏感。

## 3. 踩坑 / 约束

- **别把空标签原样输出**：`[""]` 实测 mermaid 解析失败，必须用占位符（R2）。
- **转义顺序**：先 `&` 后 `"`；反过来会把 `&quot;` 再转义（有单测钉死 `&amp;` 不二次转义）。
- **`maxDepth` 的 `''` 陷阱**：`Number('') === 0`，必须显式判非法（R4）。
- **顶层节点唯一**：mermaid mindmap 只允许一个根；传入节点即为根，不要同时输出它的祖先。
- **不要用 `scope` 三元再传给 store**：非法值到不了校验点（同 readiness 决策 31）。
- **UI 默认 `subtree`**：导图的用途就是俯瞰子树；与「交付」页签默认 `self` 不同，这是刻意的
  （交付结论默认只看本节点证据，导图默认看整棵拆解）。
- 渲染走 `Vditor.preview` + `markdown.mermaid=true`（与 `DocPane` 同一条自托管链路，不引入 npm mermaid 依赖）。

## 4. 关联章节

- 接口表：`docs/design/04-api.md`「思维导图」段
- 接口示例：`docs/api.md`「思维导图」
- UI：`docs/design/06-ui.md` 抽屉页签清单
- 测试策略：`docs/design/08-testing.md`（`test/mindmap.test.mjs` / `test/mindmap-entrypoints.test.mjs`）
- 技术决策：`docs/design/09-decisions.md` 决策 36 / 37
- 相邻功能：`../node-tree/`（真相）、`../requirement-readiness/`（需求拆解是否够格进测试）、
  `../delivery-gate/`（交付结论）
