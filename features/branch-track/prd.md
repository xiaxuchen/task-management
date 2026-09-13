# 功能：分支合并追踪（测试 / 预发 / 上线）

## 所属计划

计划 4（Git 集成）。

## 需求

- **按标签配置追踪目标**：标签（如「前端」「后端」，可扩展更多）配置测试/预发/上线三个目标（值可为分支名或 tag 名）；仓库通过 `repos.tags` 继承（多标签取第一个有配置的）；**追踪目标一律以标签配置为准**
- 对任意已登记的 commit，检测其是否已合入 / 包含在上述目标中
- 展示：节点抽屉「提交」列表每行用 **el-tag** 显示 测试/预发/上线 状态（绿=已包含、橙=未包含、浅灰=未配置或本地无该 ref，悬停说明目标名与结果）；设置页配置标签与仓库

## 接口

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/commits/:cid/track` | 单 commit 三分支合并状态 |
| GET | `/api/nodes/:id/tracks?scope=self\|subtree` | 节点（含子树）聚合状态（按 repo+sha 去重） |
| GET/PUT/DELETE | `/api/branch-configs[/:tag]` | 标签级追踪目标 CRUD |
| PATCH | `/api/repos/:rid` | 仓库配置 tags（及可选的仓库级覆盖） |

CLI：`commit track <cid>`、`node tracks <ref> [--scope]`、`branch-config list/set/remove`、`repo update --tags ...`；
MCP：`commit_track`、`node_tracks`、`branch_config_list/set/remove`、`repo_update`。

## 检测口径

- ref 解析优先级：`origin/<name>` → `refs/heads/<name>` → `refs/tags/<name>` → `<name>`（原样交给 git）
- 判定：`git merge-base --is-ancestor <sha> <ref>`（exit 0 = 已合入/包含）
- `contained` 三态：`true` 已合入 / `false` 未合入 / `null`（`reason: not-configured` 未配置分支 | `ref-not-found` 本地无该 ref（先 fetch））
- 只读本地已有 ref，**不自动 fetch**（避免网络/权限副作用）

## 验收标准

- 配置分支后：已合入显示 ✓、未合入显示 ✗、未配置显示 -
- 分支本地不存在 → `ref-not-found`（悬停提示先 `git fetch`）
- 聚合模式按 (repo, sha) 去重、回填来源节点；单条失败带 error 不拖垮整体
