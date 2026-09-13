# 设计 · 审批合并

## 数据

- `commits.branch`：开发分支（登记时自动推断或显式传入）
- `subreq.attrs.reqBranch`：需求分支（必填，如 feature-send-receive）

## 后端

**git.mjs**
- `pickBranchForCommit(dir, sha)`：`branch -a --contains` → 排除 feature-merge → 最具体 feature-*
- `mergeBranch(dir, source, target, message)`：
  1. `status --porcelain` 检查未解决冲突（UU|AA|DD|AU|UA|DU|UD）→ 有则 `{conflict:true, reason:'unresolved_conflicts'}`
  2. `merge-base --is-ancestor source target` → 是则 `{alreadyMerged:true}`
  3. `checkout target` → 失败 `{reason:'checkout_failed'}`
  4. `merge --no-ff source -m msg` → 成功 `{ok, mergeSha}`；失败按 CONFLICT 判别 `merge_conflict` / `merge_failed`

**ops.mjs**
- `approveAndMerge(store, nodeRef)`：`findAncestorOfType(task,'subreq')` → `reqBranch` →
  `listCommits(node,{subtree})` 按 (repo,branch) 去重 → 逐仓库 `mergeBranch` → 汇总 results
- `getMergeStatus(store, nodeRef)`：子树各 task 的 (repo,branch) → `branchContains(dir, branch, reqBranch)`
  → `{items:[{nodeId,name,allMerged,details}], mergedCount, total, reqBranch}`

**http.mjs**
- `POST /api/nodes/:id/merge` → approveAndMerge
- `GET /api/nodes/:id/merge-status` → getMergeStatus

## 插件

- `TaskBoardApi.mergeNode/mergeStatus`
- `markApproved()`：issue 拦截 → 后台 merge → 成功才 `markChecked("approved", null)`；
  失败/冲突弹「无法标记通过」+ 明细
- 「合入状态」按钮：弹窗（需求分支 / 已合入 N/M / 逐任务 ✓✗ 逐分支明细）

## 边界与候选

- merge 在主仓库执行（会改本地分支状态；**不 push**——推送仍由人工/GitLab 流程）
- 冲突解决：用户在终端解决后重新点「标记通过」（此时工作区有冲突会先被拒；解决并 commit 后可合并）
- 候选：合并结果回写 commit（mergeSha 关联）、失败自动回滚（merge --abort）
