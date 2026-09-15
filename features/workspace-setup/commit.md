# 工作区准备功能提交记录

> 状态：**已实现**（计划 4）。

- docs(workspace-setup): 建立功能文档 —— prd（需求 + 接口表 + 验收标准）、design（分支命名 / 派生基线 / 多仓库 / 提示词）
- feat(workspace-setup): 工作区准备闭环——store 新增 unit_repos CRUD（按 node × repo 幂等、只更新显式字段、级联删除、仅 group/task 可登记）；git.mjs 新增 revParse / localBranchSha / listWorktrees / worktreeOccupancy / addWorktree / removeWorktree / deleteLocalBranch（含 macOS `/tmp`→`/private/tmp` 符号链接的 realpath 归一，否则幂等复用会误报 409）；ops 新增 setupWorkspace（逐仓库建分支 + worktree、分支从子需求分支当前 tip 派生、dryRun 只规划、分支基线不一致报 BRANCH_EXISTS_DIFFERENT_BASE、路径占用报 WORKTREE_PATH_EXISTS）+ getWorkspacePrompt（纯读开发提示词）+ cleanupWorkspace（需 confirm；未并入基线的分支保留）；三入口 1:1（HTTP 5 条路由 / CLI `unit repo|setup|prompt|cleanup` / MCP 6 个工具并登记能力清单）
- test(workspace-setup): 24 条 UT——store CRUD 与类型约束、分支名/路径渲染纯函数、真 git 下的建/幂等/dryRun/基线不符/路径占用/清理（含「未合并分支必须保留」）、三入口 1:1 与逐字段一致；`npm test` 376/376、`npm run build` 通过
