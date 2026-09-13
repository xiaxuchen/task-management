# 功能：分支合并追踪（测试 / 预发 / 上线）

## 所属计划

计划 4（Git 集成）。

## 需求

- 仓库级配置三个分支：测试分支（`testBranch`）、预发分支（`preBranch`）、上线分支（`releaseBranch`）
- 对任意已登记的 commit，检测其是否已合入上述三个分支
- 展示：节点抽屉「提交」列表每行显示 测 / 预 / 上 合入状态徽标（悬停说明分支与结果）；设置页配置分支

## 接口

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/commits/:cid/track` | 单 commit 三分支合并状态 |
| GET | `/api/nodes/:id/tracks?scope=self\|subtree` | 节点（含子树）聚合状态（按 repo+sha 去重） |
| PATCH | `/api/repos/:rid` | 仓库配置 testBranch / preBranch / releaseBranch |

CLI：`commit track <cid>`、`node tracks <ref> [--scope]`、`repo update <名|id> --test-branch b --pre-branch b --release-branch b`；
MCP：`commit_track`、`node_tracks`（`repo_update` 支持分支字段）。

## 检测口径

- ref 解析优先级：`origin/<branch>` → `refs/heads/<branch>` → `<branch>`（原样交给 git）
- 判定：`git merge-base --is-ancestor <sha> <ref>`（exit 0 = 已合入）
- `contained` 三态：`true` 已合入 / `false` 未合入 / `null`（`reason: not-configured` 未配置分支 | `ref-not-found` 本地无该 ref（先 fetch））
- 只读本地已有 ref，**不自动 fetch**（避免网络/权限副作用）

## 验收标准

- 配置分支后：已合入显示 ✓、未合入显示 ✗、未配置显示 -
- 分支本地不存在 → `ref-not-found`（悬停提示先 `git fetch`）
- 聚合模式按 (repo, sha) 去重、回填来源节点；单条失败带 error 不拖垮整体
