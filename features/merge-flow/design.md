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

## 分支组层（已交付）

按 dsh-charge 三层架构对齐：**分支组 → 子需求 → 子任务**。

```
【平台】立项工程&资产管理26Q3迭代（requirement）
 ├── feature-send-receive 🌿（group + attrs.branch）→ 1 / 2 / 3 子需求
 ├── feature-transfer 🌿                              → 4 / 5 / 6 子需求
 └── feature-station-operation 🌿                     → 7 子需求
```

- **双击分支组** → 该分支视角的提交列表（子树全部提交 + `mergedToReq` 标记 + 状态栏「⚠ 未合并 N」）
- 需求分支取值优先级：**① 节点自身 `branch`（分支组）② `subreq.reqBranch` ③ `requirement.demandBranch`**
- CHILD_TYPES 放开：`requirement → [group, subreq]`、`group → [group, subreq, task, defect]`
- 实测：分支组 158（feature-send-receive）→ 64 条提交 / 未合并 15

## 性能优化（分支组视图 20.7s → 0.6s，33 倍）

- **问题**：64 条提交 × (is-ancestor × 1 + commitTrack × 3) ≈ 256 次 git 进程
- **修复**：
  1. **分支标注批量化**：每仓库一次 `git log <需求分支> --format=%H` → Set(sha)，
     提交用**前缀匹配**（登记可能是短 sha）——替代逐条 `merge-base --is-ancestor`
  2. **light 模式**：`?light=true` 跳过逐条 `commitTrack`（测试/预发/上线追踪，插件 Review 不需要），
     插件 `nodeTracks` 默认带 light；网页保持全量
  3. **bug 修复**：短 sha 直接 `Set.has(40位sha)` 永不命中 → 改为前缀匹配
- 实测：分支组 158 → 20.7s → **0.62s**（48 已合入 / 16 未合并）

## 合并变更（combined diff）性能优化

- **问题**：64 条 × 3 次 git（stat/time/meta）≈192 次 + 53 文件 × 2 次（old/new）≈106 次 ≈ **300 次 git 进程**
- **修复**：
  1. `commitMetasBatch`：一次 `git log --no-walk=unsorted --numstat --format=...` 拿全部提交的 stat/作者/时间
  2. 文件 old/new 串行 → **并发 8**
- 实测：64 条合并变更 → **≈1.5s**

### 单提交 diff 优化

- **问题**：每文件 3 次 git（patch / 父版本 / 本版本）——10 文件提交 = 30 次进程
- **修复**：
  1. 一次 `git show <sha> --format= --no-renames` 拿全量 patch，按 `diff --git` 拆分
  2. `git cat-file --batch`（spawn + stdin）一次取全部 `sha^:path` / `sha:path` 内容
- 实测：300-600ms（与文件数基本无关）

## Review 交互增强（单击/全选/着色）

- **单击提交 → 只看这一个**：自动清空勾选，右侧切到单提交详情（回勾选模式即回到合并视图）
- **顶栏「全选⇄全不选」**：已全选时点一下变全不选（toggle）
- **顶栏「反选」**：已勾选与未勾选互换
- **提着色**（`mergedToReq` 驱动）：
  - 已合入需求分支 → **绿色**（#2E7D32）
  - 未合并 → **黄橙色**（#B8860B）
  - 未知 → 默认色

## 边界与候选

- merge 在主仓库执行（会改本地分支状态；**不 push**——推送仍由人工/GitLab 流程）
- 冲突解决：用户在终端解决后重新点「标记通过」（此时工作区有冲突会先被拒；解决并 commit 后可合并）
- 候选：合并结果回写 commit（mergeSha 关联）、失败自动回滚（merge --abort）
