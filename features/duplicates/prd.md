# 重复提交检测与一键去重（含需求分支标注）

## 需求

- 检测 worktree 分支与需求分支等**重复登记的提交**，三类关系：
  - `same-sha`：同仓库同 sha 跨节点重复登记
  - `patch-id`：同内容不同 sha（rebase / cherry-pick）
  - `merge-covers`：merge 提交（"合并子任务"）覆盖了库中已登记的 worktree 提交
- 重复提交**互相链接**（related 列表带对端 sha / 所在节点路径 / 关系类型）
- **一键去重**：同 sha / patch-id 组保留最早一条，删除其余；merge 覆盖关系仅展示不删
- 网页端提交列表展示：**分支标注**（worktree/子分支 tag）、**需求分支**（✓已合入/✗未合入——
  数据来自需求节点属性 `demandBranch`，支持逗号分隔多分支）、**⇄ 重复标记**（悬停显示关联详情）
- 需求节点新增属性「需求分支」（`demandBranch`，requirement 类型）

## 非目标

- 行级重复检测；跨仓库内容比对
