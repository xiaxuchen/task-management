# 设计 · 重复检测与去重

## 设计要点

- `commits.patch_id` 列（懒计算 + 缓存）：`git show <sha> | git patch-id --stable`（spawn 管道，不经 shell）；
  merge 提交（parents≥2）标记 `__merge__` 不参与 patch-id 分组
- `getNodeDuplicates(store, nodeRef, {scope})`：对**全库同 repo** 建 sha / patch-id 索引（另一半可能在别的节点），
  范围内提交逐一比对；merge 覆盖 = `git rev-list <merge>^2 --not <merge>^1` ∩ 全库已登记
- `POST /api/commits/dedupe`（store.dedupeCommits）：安全校验——removeIds 必须与 keep 同 repo 且 sha 相同或
  （非 merge 的）patch_id 相同，否则拒绝；三入口：HTTP / CLI `commit duplicates|dedupe` / MCP
- `nodeTracks?branches=true`：附 `branches`（branchesContaining）、`subBranches`（过滤需求分支）、
  `demandBranch`（上溯 requirement 的父链取 attr）、`demandContained`（branchContains 任一需求分支）
- 网页 NodeDrawer 提交 tab：分支列（tag +N 折叠）、需求分支列（✓/✗/—）、SHA 列 ⇄ 重复标记（el-tooltip 列关联）；
  顶部「N 组重复提交」警告条 + 一键去重（ElMessageBox 确认，逐组保留最早、merge 关系跳过）
