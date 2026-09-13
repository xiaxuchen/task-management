# 设计 · Qoder 联动

## 架构（三块 + 三条数据流）

```
task-board（事实源：节点/文档/提交/运行记录）
   ▲                        ▲
   │ MCP（stdio）            │ 文件桥（~/.taskboard/*.json|md）
   │                        │
Qoder IDE 插件          TaskBoard IDEA 插件（hook 桥脚本 / 派单 / 选区捕获）
   ▲                        │
   └─ Hook（UserPromptSubmit / Stop，Claude Code 规范）
```

## 组成

| 组件 | 位置 | 职责 |
|---|---|---|
| Hook 桥 | `hooks/qoder-bridge.mjs`（+ `qoder-bridge.sh` node 路径兜底包装） | 读 stdin 事件 → 查库/读上下文文件 → `hookSpecificOutput.additionalContext` 注入 |
| Hook 配置 | `~/.qoder/settings.json` 的 `hooks` 段 | `UserPromptSubmit` / `Stop` → 桥脚本（备份 `.bak-*`） |
| MCP | `qodercli mcp add task-board -s user node <repo>/server/mcp.mjs` | Qoder 直接调用任务工具（含 `agent_run_get/update`） |
| 派单 | `QoderOpener.java`（插件） | 激活 Qoder 面板 + 尝试新会话（`QoderOpenNewSessionTabAction`）+ 提示词进剪贴板 |
| 上下文文件 | `~/.taskboard/current-review.json`、`last-selection.md`、`selected-snippets.md` | 插件写 / hook 读 |
| ideMode | `server/agent.mjs startAgentRun(..., { ideMode })` | 只建 run 记录不 spawn（Qoder IDE 前台执行） |
| 选区捕获 | `TaskBoardPanel.startSelectionCapture()` | 全局 `SelectionListener` → 防抖 700ms → ≥10 字符 → 覆盖写 `last-selection.md` |

## Hook 注入规则（触发词 → 数据）

| 数据 | 触发条件 | 来源与规则 |
|---|---|---|
| 任务上下文 | 提示词含编号（`3.1.1` / `26Q3` / `XPD-…`）或 `@` / 引号名 | 查 nodes 模糊匹配（命中 1~2 个）；显式提及摘要加长（1200 字 vs 500 字） |
| 当前 review（完整段） | 含 `当前review/这次变更/@review/变更文件` 等；或编号与 review 节点同源 | 读 `current-review.json`（节点 + 勾选提交 + 变更文件；2 小时新鲜） |
| **最近选中（自动捕获）** | **无触发词：mtime ≤ 5 分钟即无条件注入**（体量 <1KB，静默失败代价大） | `last-selection.md`（选区监听写入） |
| 任务简报（选中随行） | 触发词（`这段/选中/片段`…）或 review 类词 | `renderReviewBrief`（任务 id/名称 + 代码项目 + commit + 文件） |
| 片段池 | **新鲜 ≤30 分钟无条件注入；触发词时放宽到 2h** | `selected-snippets.md`（快捷键「加入上下文」追加；体量可能大，截断 3000 字） |

## 选中来源解析（如何拿到"真实文件路径"）

选区捕获时按优先级取"来自哪个文件"：

| 选中的位置 | 虚拟文件类型 | 取值方式 |
|---|---|---|
| **链式 diff 的 tab 自身** | `ChainDiffVirtualFile` | `currentDiffFilePath(vf)`：chain → `getListSelection().getSelectedIndex()` → 当前 request 的 title（格式 `<链标题> · <文件路径>`，取 `· ` 之后） |
| **diff 的左右编辑器**（变更前/后） | `LightVirtualFile`（diff 内容 vf） | **回退到 `DiffOpener.currentFile()`**（当前链式 diff）再取真实路径 |
| 普通文本编辑器 | 真实文件 | `vf.getName()` |
| 兜底 | — | `（当前 review diff）` |

**踩坑**：diff 视图里用户实际选中的是"左右编辑器"（挂 diff 内容 vf，**不是** ChainDiff），首版只认 `ChainDiffVirtualFile` 类型 → 落入兜底标签"（虚拟文件）"，用户看起来像"没拿到文件"。教训：**同一个 diff 视图存在两种虚拟文件层级（tab 层 / 内容层），取值要做回退链**。

## 手动加入上下文（实验性，已回退）

> 用户实际使用后觉得"快捷键+高亮+解除"链路太重，已全部回退：**回到"选中即自动捕获"（零操作）**。本小节仅保留设计经验。

**曾经实现**（已删除）：`AddToContextAction`（快捷键 Ctrl+Shift+Alt+C + 右键菜单）；编辑器选中加入后 `MarkupModel.addRangeHighlighter` 高亮（直构 TextAttributes 淡黄底+橙框）；再按同选区 toggle 解除；JCEF 云文档选中经 `JBCefJSQuery + window.getSelection()` 读取；池 `selected-snippets.md`（30 分钟新鲜无条件注入）。

**回退理由与经验**：
- 快捷键与高亮引入的交互重量（记快捷键、看高亮、toggle 解除）超过收益；**自动捕获（选区监听 + 新鲜度注入）已经覆盖主场景**
- 高亮在 diff 编辑器里渲染不可靠（scheme 键不渲染→直构 TextAttributes 也未能稳定可见），反复调试成本高
- **经验：小体量、高价值的上下文捕获优先做"零操作"；需要用户主动管理的（多选/累积/解除）仅在明确高频需求下再加**

## 数据流

1. **提问链**：Qoder prompt → hook 桥 → SQLite/文件 → `additionalContext`（≤6000 字符，超长截断）
   - **注入分层原则**：小体量高价值数据（最近选中 <1KB）**按新鲜度无条件注入**；大体量数据（片段池/完整 review）**触发词门控**——避免"触发词没写对 → 静默零注入"的设计缺陷
   - 选中片段场景自动附**任务简报**（`renderReviewBrief`：任务 id/名称 + 代码项目 + commit + 文件）——只给选中代码也能定位到任务/仓库/变更
2. **派单链**：插件 → `POST /api/nodes/:id/agent-runs {ideMode:true}` 建 run#id → 提示词（含 run id + 回写指令）→ Qoder 面板 → **人工 ⌘V+回车** → Agent 执行 → MCP `agent_run_update` 回写 → 插件历史可见
3. **自动捕获链**：编辑器选区变化 → `EditorFactory.getEventMulticaster().addSelectionListener` → 防抖 700ms → 写入

## 维护要点

- **日志**：`/tmp/taskboard-qoder-bridge.log`（每次 hook 调用一行：事件/提示词摘要/注入字节数）
- **快速自测**：
  ```bash
  echo '{"hook_event_name":"UserPromptSubmit","prompt":"这段代码有什么问题"}' | node hooks/qoder-bridge.mjs
  ```
- **失效排查**：① 日志无新行 → hook 未触发（检查 `~/.qoder/settings.json` hooks 段 / 重启 IDE）；
  ② 有行无注入 → 触发词未命中或数据文件过期（2h）；③ 片段不带 → `~/.taskboard/last-selection.md` 是否新鲜
- **配置备份**：`~/.qoder/settings.json.bak-*`
