# 功能设计：分支合并追踪

## 模块位置

- `server/git.mjs`：`branchContains` / `commitTrack`（`merge-base --is-ancestor`，经 `gitTry` 以退出码表达结果；ref 解析链含 `refs/tags/<name>`，目标可为分支或 tag）
- `server/db.mjs`：`branch_configs` 表（标签级三分支）+ repos 新增 `tags` / `test_branch` / `pre_branch` / `release_branch`（`openDb` 里 `migrate()` 对旧库幂等补列）
- `server/store.mjs`：`listBranchConfigs / upsertBranchConfig / deleteBranchConfig`；`resolveBranchTargets(repo)` —— 仓库级（任一非空）优先；否则按 `repos.tags` 顺序取第一个有配置的标签；均无 → null
- `server/ops.mjs`：`getCommitTrack` / `getNodeTracks`（三入口共用）
- 前端：`SettingsView`（仓库分支配置表）、`NodeDrawer`（提交列表「合并」状态列）

## 设计要点

- 配置层级：**标签级为唯一配置入口**（仓库仅打 tags 继承，多标签取第一个有配置的；仓库级字段保留兼容但设置页不再提供入口）
- `branchContains` 返回 `{ branch, ref, contained, reason }`：三态 + 原因（not-configured / ref-not-found / git-error）
- 聚合复用既有去重逻辑（key = `repo@sha`），逐条 try/catch，失败项带 `error`；结果含 `targetSource`（repo / tag:名）便于排查
- 前端 tracks 异步加载（不阻塞抽屉主信息），`repo@sha` 映射后驱动 el-tag 状态（success=已包含 / warning=未包含 / info+plain=未配置或无 ref）
- 徽标悬停显示目标名（分支或 tag）与结果；设置页分「标签配置」与「仓库标签」两张表（仓库表不再配置分支）

## 注意事项

- 检测基于本地 git ref 快照；目标分支有更新时需先 `git fetch`（UI 提示）
- 后续可扩展：一键 fetch 后复检、提交列表「仅看未合入」过滤
