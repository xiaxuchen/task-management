# 功能：代码集成（显式合并）

## 所属计划

计划 4。

## 需求

- 工作单元（`group` / `task`）分支合并回**子需求集成分支**，由按钮 / CLI **显式触发**（不自动）
- 合并前用 `git merge-tree` 做**内存三方预检**（不碰工作区、不落分支）
- 预检有冲突 → 落 `merges` 行（`state = precheck_conflict` + 冲突文件）→ 进入冲突处理
- 预检无冲突 → 本机执行 `git merge --no-ff <source_branch>`（目标为集成分支，**不 push**）→ 落 `merges` 行（`merged` + `merge_sha`）
- 一个子需求下的多个工作单元可**按 `sort` 顺序批量合并**，遇冲突即停并返回已完成清单
- 全程只读 + 本地写；不 push、不动远端分支

## 接口（设计文档 §6）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/nodes/:id/merges/precheck` | 合并预检（merge-tree，不落库、不合并）|
| POST | `/api/nodes/:id/merges` | 显式合并：`{units?, repo?, dryRun?}` → `{merged[], conflicts[]}` |
| GET | `/api/merges?nodeId=&state=` | 合并记录列表（含待处理冲突）|
| POST | `/api/merges/:mid/confirm` | 确认合并完成 → 回填 `merge_sha`，`state = resolved` |
| POST | `/api/merges/:mid/abort` | 放弃本次合并 → `aborted`（不改任何分支）|

## 验收标准

- 预检发现冲突时**不修改工作区、不落分支**，返回 200 + 冲突清单
- 合并成功写 `merges` 行并回填 `merge_sha`
- 批量合并遇首个冲突即停，返回已完成清单
- 分支不存在 → 400 `BRANCH_NOT_FOUND`；未登记仓库 → 400 `REPO_NOT_REGISTERED`
- HTTP 侧破坏性调用需 `confirm: true`，CLI 侧需 `--confirm`