# 功能设计：commit 在线预览

## 模块位置

- `server/git.mjs`（已建）：本机 git 操作 —— 用 `child_process.execFile` 直调 git（参数数组、不经 shell），替代原计划的 simple-git（零新增后端依赖）
- `web/src/components/DiffPane.vue`（已建）：CodeMirror 6 + `@codemirror/merge` 渲染（统一 / 分栏、未变行折叠）
- 依赖已有：`commits` 表（§4.4）、`repos` 表（§4.7）、`store.getCommit / listCommits({subtree})`

## 实现说明（2026-09-13 落地）

- 取数：`git show <sha> --numstat` 文件列表；每文件 `git show <sha> --format= -- path` 取 patch、`<sha>^:path` / `<sha>:path` 取 old/new（单文件 512KB 截断）
- 接口：`GET /api/commits/:cid/diff`（单 commit 全量）；`GET /api/nodes/:id/diffs?scope=self|subtree`（聚合：按 (repo,sha) 去重、回填 sourceNodes、单条失败带 error 不拖垮整体）
- 三入口 1:1：CLI `commit diff <cid>` / `node diffs <ref> [--scope]`；MCP `commit_diff` / `node_diffs`
- 前端：提交 tab 每行「查看」→ DiffPane 弹窗（左侧文件列表 + 右侧 MergeView；切换文件/视图重建实例）
- 未做（后续增强）：GitLab API 兜底（计划 5）、语言语法高亮、F7/Shift+F7 跳变更快捷键

## 设计要点

- **取 diff**：`simple-git` 调本机 git —— `git show <sha> --stat` 取文件列表、`git show <sha> --format= -- <path>` 取单文件 patch
- **仓库定位**（决定性逻辑）：
  1. `repos.local_path` 存在且是 git 仓库 → 本机 git
  2. 否则用 `repos.gitlab_project` 调 GitLab API 取 diff（兜底，需要 token）
  3. 都没有 → 400 `REPO_NOT_REGISTERED`
- **子树聚合**：`store.subtreeIds(nodeId)` → 各节点的 `commits` → 按 `(repo, sha)` 去重 → 逐个取 diff，并在结果里回填 `sourceNodePath`
- **前端渲染**：CodeMirror 6 + `@codemirror/merge`（决策 #18），支持统一 / 分栏 / 全文、行号、语法高亮、未变行折叠、F7 / Shift+F7 跳变更

## 关联

- 设计文档 §7.13（commit 预览）、§8.6（DiffPane）、§4.4 / §4.7、§6
- 决策 #18（CodeMirror + MergeView）、#19（git 走本机 `simple-git`）

## 对 AI 的暴露

- 现有 `commit_list` 只读登记；本功能落地后新增 `diff` 工具（MCP / CLI / REST 1:1），
  AI 可读单 commit 或子树聚合的 diff 内容
## commit 元信息增强（2026-09-13）

- diff 响应补充：`authorEmail`（作者邮箱）与 `branches`（包含该提交的分支列表——`git branch -a --contains`，
  去 origin/ 前缀、限 8 个）；元信息抽取为轻量 `commitMeta(dir, sha)` 供 commitDiff / combinedDiff 复用
