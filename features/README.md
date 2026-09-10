# 功能之家（features/）

约定（用户 2026-09-11 定）：**一个目录就是一个功能的家**。

- 每个功能目录只放文档：`prd.md`（功能需求）、`design.md`（功能设计）、`commit.md`（该功能的提交记录，一行一条 commit message）。
- 代码仍在 `server/`、`test/` 中按分层组织，靠本表与目录名对应功能。
- 每次提交属于哪个功能，就在该功能目录的 `commit.md` 追加一行 commit message；跨功能的提交在每个被触碰的功能里各记一行。
- 功能粒度按主设计文档 §2.1 的 v1 功能清单；新增/拆分功能时要同步建目录与文档。

## v1 功能索引

| 功能 | 目录 | 计划 | 状态 | 代码位置 |
|---|---|---|---|---|
| 工程基座与配置 | `foundation/` | 计划 1 · Task 1–4 | 已完成 | package.json、test/helpers.mjs、server/{errors,config,db}.mjs |
| 节点树与增删改 | `node-tree/` | 计划 1 · Task 5–6 | 已完成 | server/store.mjs（节点部分） |
| 属性系统 | `attributes/` | 计划 1 · Task 7 | 已完成 | server/store.mjs（属性部分） |
| 文档（Markdown 多份） | `documents/` | 计划 1 · Task 8 | 已完成 | server/store.mjs（文档部分） |
| 变更可见与审计 | `revision/` | 计划 1 · Task 9 | 待开始 | server/store.mjs（revision / 审计） |
| 缺陷登记 | `node-tree/`（类型与校验在节点树里） | 计划 1 · Task 5 | 已完成 | nodes.type = defect |
| commit 手工登记 | `commit-registry/`（随计划 2 建） | 计划 1 建表 · 计划 2 入口 | 表已完成 | commits 表 |
| 三入口：HTTP API / CLI / MCP | `entrypoints/`（随计划 2 建） | 计划 2 | 待开始 | server/{api,cli,mcp}.mjs、bin/ |
| 表格式展开树 | `tree-table-ui/`（随计划 3 建） | 计划 3 | 待开始 | web/src/views/TreeView.vue |
| 属性定义管理页 | `attr-defs-ui/`（随计划 3 建） | 计划 3 | 待开始 | web/src/views/AttrDefsView.vue |
| 设置页 | `settings-ui/`（随计划 3 建） | 计划 3 | 待开始 | web/src/views/SettingsView.vue |
| 仓库登记 | `repo-registry/`（随计划 3 建） | 计划 3 | 待开始 | server/store.mjs（repos）+ web 页面 |
| commit 在线预览（含子树聚合） | `diff-preview/`（随计划 4 建） | 计划 4 | 待开始 | server/git.mjs、web DiffPane |
| 代码集成（显式合并） | `merge-integration/`（随计划 4 建） | 计划 4 | 待开始 | server/git.mjs、merges 表 |
| 冲突检测与处理 | `conflict-resolution/`（随计划 4 建） | 计划 4 | 待开始 | server/git.mjs、web ConflictPane |
| 工作区准备（分支 / worktree / 开发提示词） | `workspace-setup/`（随计划 4 建） | 计划 4 | 待开始 | server/git.mjs、unit_repos 表 |
| MR 自动拉取 | `mr-sync/`（随计划 5 建） | 计划 5 | 待开始 | server/gitlab.mjs、mrs 表 |
| 图片上传 | `uploads/`（随计划 5 建） | 计划 5 | 待开始 | server/api.mjs、/uploads 静态 |
| 冒烟与给 AI 的用法 | `smoke-and-ai-docs/`（随计划 5 建） | 计划 5 | 待开始 | scripts/smoke.mjs、README |
