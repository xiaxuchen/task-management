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

## MR 式合并预览与分支展示（已交付）

- **需求分支展示**：进节点时状态栏显示 `【4.1】xxx　🌿 需求分支：feature-transfer`
  （`findReqBranch`：沿父链找 subreq.attrs.reqBranch）
- **合并预览**（「合并预览」按钮）：对每个待合并 (repo, source→target)：
  - 已合入 → `✓ …（已合入，无需合并）`
  - `git diff --stat <target>...<source>` → 将引入的变更文件与 +/- 统计
  - `git merge-tree --write-tree <target> <source>` → **冲突预判**（⚠ 冲突文件清单）
  - 越权/无本地路径 → ✗ 原因
  - API：`POST /api/nodes/:id/merge-preview`（ops.previewMerges / git.previewMerge）

## 上跳合并：子需求 → feature-merge（已交付）

两跳合并链：**子任务 → 子需求分支（reqBranch）→ feature-merge**。

- **入口**：子需求节点 Review →「**合并到 feature-merge**」按钮
- **行为**（`ops.mergeUpstream`）：source = subreq.reqBranch，target = feature-merge（可传参覆盖）
  - 收集子树提交涉及的仓库 → 逐仓库 `mergeBranch(source, target)`
  - **已合入 → 跳过**；**有新内容 → 再 merge**（增量重复合）
  - 冲突/失败 → 弹窗报明细
- **API**：`POST /api/nodes/:id/merge-upstream { targetBranch? }`（默认 feature-merge）
- **实测**（子需求 119）：2 仓库"已合入跳过"（xp-thor-project/xp-thor-par-construction）+
  1 仓库有新内容实合并（xp-thor-mgnt，mergeSha f4afa21c）——正是"增量再合"行为

## 子需求 Review 的需求分支视角（已交付）

- 进子需求节点 → 提交列表带 **`mergedToReq`**（是否已合入需求分支；优先 subreq.reqBranch，回退 demandBranch）
- **状态栏**：`【3】… 🌿 需求分支：feature-send-receive　⚠ 未合并 3`（或 `✓ 全部已合入`）
- **列表项**：未合并的提交前缀 **`⚠未合并`**（`CommitItem.display()`）
- API：`GET /api/nodes/:id/tracks?scope=subtree&branches=true` → commit 级 `mergedToReq`

## 边界与候选

- merge 在主仓库执行（会改本地分支状态；**不 push**——推送仍由人工/GitLab 流程）
- 冲突解决：用户在终端解决后重新点「标记通过」（此时工作区有冲突会先被拒；解决并 commit 后可合并）
- 候选：合并结果回写 commit（mergeSha 关联）、失败自动回滚（merge --abort）
