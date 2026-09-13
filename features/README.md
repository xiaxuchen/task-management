# 功能之家（features/）

约定（用户 2026-09-11 定）：**一个目录就是一个功能的家**。

- 每个功能目录只放文档：`prd.md`（功能需求）、`design.md`（功能设计）、`commit.md`（该功能的提交记录，一行一条 commit message）。
- 代码仍在 `server/`、`test/`、`web/` 中按分层组织，靠本表与目录名对应功能。
- 每次提交属于哪个功能，就在该功能目录的 `commit.md` 追加一行 commit message；跨功能的提交在每个被触碰的功能里各记一行。
- 功能粒度按主设计文档 §2.1 的 v1 功能清单；新增/拆分功能时要同步建目录与文档。

**状态口径**：`已完成` = 代码 + 测试 + 文档齐备；`需求已定` = prd/design 已就位、代码待实现。

## 一、已完成

| 功能 | 目录 | 计划 | 代码位置 |
|---|---|---|---|
| 工程基座与配置 | `foundation/` | 计划 1 | package.json、test/helpers.mjs、server/{errors,config,db}.mjs |
| 节点树与增删改（含 `defect` 类型） | `node-tree/` | 计划 1 | server/store.mjs（节点部分）|
| 属性系统 | `attributes/` | 计划 1 | server/store.mjs（属性部分）|
| 文档（Markdown 多份） | `documents/` | 计划 1 | server/store.mjs（文档部分）|
| 变更可见与审计（revision） | `revision/` | 计划 1 | server/store.mjs（revision / 审计）|
| commit 手工登记 | `commit-registry/` | 计划 1 建表 · 计划 2 入口 | server/store.mjs（commits 部分）|
| 三入口：HTTP API / CLI / MCP | `entrypoints/` | 计划 2 | server/{http,cli,mcp,index,ops}.mjs、bin/taskboard.js |
| 表格式展开树 + 右侧抽屉 + 文档区 | `tree-table-ui/` | 计划 3 | web/src/views/TreeView.vue、web/src/components/{NodeDrawer,DocPane}.vue |
| dsh-charge 需求同步导入 | `dsh-import/` | 计划 3 配套 | server/import-dsh.mjs |
| commit 在线预览（单 commit + 子树聚合，统一/分栏） | `diff-preview/` | 计划 4 | server/git.mjs、web/src/components/DiffPane.vue |
| 分支合并追踪（测试 / 预发 / 上线） | `branch-track/` | 计划 4 | server/git.mjs、SettingsView、NodeDrawer |

### 已实现但**不设独立目录**（语义并入上述目录，避免索引重复）

| 功能 | 并入 | 代码位置 |
|---|---|---|
| 缺陷登记 | `node-tree/`（类型与父子校验）| `nodes.type = 'defect'` |
| 属性定义管理页 | `tree-table-ui/` | web/src/views/AttrDefsView.vue |
| 设置页（GitLab / 端口 / 状态值域） | `tree-table-ui/` | web/src/views/SettingsView.vue |
| 仓库登记 | `tree-table-ui/` | server/store.mjs（repos 部分）+ 抽屉/设置页 |
| 给 AI 的用法 | `smoke-and-ai-docs/` | `AGENTS.md` |
| 接口示例 | `smoke-and-ai-docs/` | `docs/api.md` |
| 数据快照导出/导入 | `foundation/` | `scripts/{export,import}-snapshot.mjs`（`npm run snapshot:export/import`）|

## 二、需求已定，待实现（计划 4–5）

| 功能 | 目录 | 计划 | 代码位置（待建）|
|---|---|---|---|
| 代码集成（显式合并） | `merge-integration/` | 计划 4 | server/git.mjs、merges 表 |
| 冲突检测与处理 | `conflict-resolution/` | 计划 4 | server/git.mjs、web ConflictPane |
| 工作区准备（分支 / worktree / 开发提示词） | `workspace-setup/` | 计划 4 | server/git.mjs、unit_repos 表 |
| MR 自动拉取 | `mr-sync/` | 计划 5 | server/gitlab.mjs、mrs 表 |
| 图片上传 | `uploads/` | 计划 5 | server/http.mjs、`/uploads` 静态 |
| 冒烟脚本 | `smoke-and-ai-docs/` | 计划 5 | scripts/smoke.mjs |

> 计划 4–5 的功能目录里已有 `prd.md`（需求 + 验收标准）与 `design.md`（设计要点 + 关联章节 + 注意事项），
> 代码实现前请先读该目录，并按 [`AGENTS.md`](../AGENTS.md) 的「文档维护规范」同步更新。