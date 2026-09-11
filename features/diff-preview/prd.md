# 功能：commit 在线预览（含子树聚合）

## 所属计划

计划 4。

## 需求

- 节点抽屉「提交」区列出该节点**与子树**的 commits（按 commit 分组、标注来源节点与仓库）
- 点某个 commit 或文件 → 文件列表 + 每文件 diff
- 视图：统一 / 分栏 / 全文；行级高亮 + 未变行折叠
- **仓库解析优先级**：`repos.local_path` → 本机 git；否则 `repos.gitlab_project` → GitLab API；两者都无 → 400 `REPO_NOT_REGISTERED`

## 接口（设计文档 §6）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/commits/:cid/diff` | 单 commit 预览：文件列表 + 每文件 old / new 与 patch |
| GET | `/api/nodes/:id/diffs?scope=self\|subtree` | 节点（含子树）聚合预览，按 commit / 仓库分组 |

## 验收标准

- 给定已登记的 `repo` + `sha`，能列出变更文件与 unified patch
- 仓库未登记 → 400 `REPO_NOT_REGISTERED`；本地路径存在但不是 git 仓库 / 不存在 → 400 `REPO_PATH_MISSING`
- 本机 git 不可用或命令失败 → 500 `GIT_UNAVAILABLE` / `GIT_FAILED`（`details` 带 stderr）
- `scope=subtree` 时每个 commit 能标注**来源节点**（是哪个子节点登记的）
- 未变行可折叠；统一 / 分栏 / 全文三种视图切换正常