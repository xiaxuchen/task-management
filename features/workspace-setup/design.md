# 功能设计：工作区准备

## 模块位置

- `server/git.mjs`：`revParse` / `localBranchSha` / `listWorktrees` / `worktreeOccupancy` /
  `addWorktree` / `removeWorktree` / `deleteLocalBranch`
- `server/store.mjs`：`unit_repos` CRUD（`listUnitRepos` / `addUnitRepo` / `updateUnitRepo` / `deleteUnitRepo`）
- `server/ops.mjs`：`setupWorkspace`（编排）/ `getWorkspacePrompt`（纯读）/ `cleanupWorkspace` +
  纯函数 `renderBranchName` / `renderWorktreePath` / `composeWorkspacePrompt`
- `server/{http,cli,mcp}.mjs`：三入口 1:1（MCP 工具 `unit_repo_*` / `unit_setup` / `unit_prompt` / `unit_cleanup`）

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

## 关键规则（实现后回填）

**R1 基线的判定用「tip 相等」，不是「包含」**：`addWorktree` 若发现同名分支已存在，
只认它的 tip **恰好等于**基线当前 tip。分支是基线的祖先（更旧）同样属于基线不一致——
复用会让开发者从过期代码开工；分支领先基线则代表有未合并成果。两者都抛
`BRANCH_EXISTS_DIFFERENT_BASE`，交由人工显式确认，不静默复用。
（幂等场景不走这条：创建过工作区后路径已存在且同分支，会直接 `alreadyExists` 跳过。）

**R2 路径比较必须 realpath 归一**：`git worktree list --porcelain` 回报的是**符号链接解析后**的路径
（macOS 上 `/tmp/...` → `/private/tmp/...`），直接比字符串会把「已存在的同一 worktree」
判成「路径被占用」，于是幂等复用变成 409、清理又找不到目标。`samePath()` 两侧都做
`realpathSync`，失败才退回 `path.resolve`。

**R3 `dryRun` 是纯规划**：只渲染分支名与路径、检查仓库是否可解析，**不碰本机 git、不落库、不动 revision**——
与 `readiness` / `acceptance_report` 同一条「让 AI 可以放心预演」的纪律。

**R4 组合写入 = 一次 revision**：回填 `unit_repos`（分支 / 路径）与节点属性（`branch` / `base_branch`）
用 `store.withoutBump` 包起来再统一 `bumpRevision()`，避免一次操作把 revision 推高多次。

**R5 清理默认保留、未并入不删**：`cleanupWorkspace` 需 `confirm`（与删除/移动同口径）。
删分支走 `git branch -d`，让 git 自带的合并检查兜底——未并入基线的分支**不会被删**，
回报 `branchNote: 'branch-not-merged'` 供人工决定，避免清理动作悄悄丢掉开发成果。
重复调用幂等（worktree 已移除 / `worktree_path` 已清空都按「已移除」处理）。

**R6 MCP 的 `confirm` 用 `.catch(undefined)` 兜底**：`z.boolean()` 会把「没传 confirm」
拦成 SDK `-32602`，泄漏协议错误。改用 `z.boolean().catch(undefined)`——
对外 schema 仍是 required boolean，但缺失值下沉到 handler，由 `mcpValidate` 归一成
`isError + CONFIRM_REQUIRED`，与 HTTP / CLI 的拒绝语义一致。

**R7 只有 `group` / `task` 是工作单元**：项目 / 需求 / 子需求有自己的分支语义（分支组、需求分支），
不参与工作区派生。`addUnitRepo` 与 `setupWorkspace` 都做类型校验，给出 `details.allowed`。
