# 功能设计：工作区准备

## 模块位置

- `server/git.mjs`（待建）：`worktree add` / 分支存在性检查 / 清理
- `unit_repos` 表（§4.12）：node × repo（branch + worktree_path）
- `server/ops.mjs` 或独立模块：开发提示词生成
- `web/src/components/NodeDrawer.vue` 的「工作区 + 合并」区

## 设计要点

- **分支命名**：`config.branchTemplate` 渲染，变量 `{base_branch}` 与 `{slug}`；`slug` 为空用 `n{id}`
- **派生基线**：创建时取**当前子需求分支的最新提交**（不是登记时刻的快照），避免与集成分支脱节
- **多仓库**：一条分支名覆盖所有登记仓库，`unit_repos` 每仓库一行记录各自的 `worktree_path`
- **提示词即开工包**：把 AI 开工所需上下文一次给全（节点上下文 + 工作区路径 + 分支基线 +
  文档清单 + 命令清单 + 提交/合并约定），减少反复询问
- **清理策略**：默认保留（合并后 Diff 入口仍可用）；清理时先判断分支是否已并入集成分支再删

## 关联

- 设计文档 §7.10（工作区准备）、§4.12（unit_repos）、§6
- 决策 #23（工作区由工具创建）、#24（工作单元支持多仓库）

## 注意

所有 git 命令失败都要把 stderr 放进错误 `details`（§9 的 `GIT_FAILED`）。
`worktree add` 有副作用但可逆（`worktree remove`），是否算破坏性操作以 `cleanup` 为准（需 `confirm`）。