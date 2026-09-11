# 功能：工作区准备（分支 / worktree / 开发提示词）

## 所属计划

计划 4。

## 需求

- 工作单元（`group` / `task`）可登记**涉及仓库**（多选，写入 `unit_repos`），并有 `slug` / `branch` / `base_branch`
- 「创建工作区」：按 `config.branchTemplate`（默认 `{base_branch}-{slug}`）逐仓库执行
  `git worktree add <path> -b <branch> <base_branch>`，**分支从当前子需求分支派生**（以创建时刻的最新提交为基）
- worktree 路径：`config.worktreeRoot`（默认与主仓库同级）下 `<仓库目录名>-wt-<slug>`
- **幂等**：路径已存在且是同一分支 → 跳过；已占用且非本分支 → 409 `WORKTREE_PATH_EXISTS`
- 分支已存在但基线不同 → 400 `BRANCH_EXISTS_DIFFERENT_BASE`
- 回填 `branch` 属性与 `unit_repos.branch` / `worktree_path`
- 返回**开发提示词**（可直接投喂 AI）：节点路径与 id、涉及仓库与工作区路径、工作分支与基线、文档清单、常用命令、提交与合并约定
- 清理：`unit cleanup` 移除 worktree / 删除已并入的分支；**合并后默认保留**；需 `confirm`

## 接口（设计文档 §6）

| Method | Path | 说明 |
|---|---|---|
| GET / POST | `/api/nodes/:id/unit-repos` | 工作单元涉及的仓库（branch / worktree_path）|
| DELETE | `/api/unit-repos/:urid` | 移除工作单元仓库 |
| POST | `/api/nodes/:id/setup` | 创建工作区：`{repoIds?, dryRun?}` → `{branch, repos:[{repo, worktreePath}], prompt}` |
| GET | `/api/nodes/:id/prompt` | 生成 / 刷新开发提示词 |
| POST | `/api/nodes/:id/cleanup` | 清理工作区（需 `confirm`）|

## 验收标准

- 多仓库能一次建出**同名分支 + 各自 worktree**
- 重复调用幂等（同分支同路径跳过，不报错）
- 生成的提示词包含：节点路径与 id、各仓库 worktree 路径、分支与基线、文档清单、常用命令
- 清理需 `confirm`；默认策略是**合并后保留**工作区与分支（避免 Diff 入口消失）
- 分支命名可由 `config.branchTemplate` 覆盖；`slug` 为空时退回 `n{id}`