# 功能设计：commit 在线预览

## 模块位置

- `server/git.mjs`（待建）：本机 git 操作（show / diff / log）
- `web/src/components/DiffPane.vue`（待建）：diff 渲染
- 依赖已有：`commits` 表（§4.4）、`repos` 表（§4.7）、`store.listCommits({subtree:true})`

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