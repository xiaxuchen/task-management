# 提交记录 · 审批合并

- feat(commits): 登记 commit 自动带「分支」——commits 表加 branch 字段（迁移幂等）；addCommit 支持 branch 并在已存在时补齐；HTTP/MCP 登记未提供分支时自动从本机 git 推断（pickBranchForCommit：排除 feature-merge、优先最具体 feature-*）；已回填 89 条历史提交
- feat(merge): 审批合并闭环——「标记通过」自动把子任务开发分支合入所属子需求的需求分支（主仓库执行）；服务端安全判定（已合入跳过/未解决冲突拒绝/冲突回执）；新 API POST /api/nodes/:id/merge；fix http.mjs 重复 comments 段
- feat(merge-status): 组级「合入状态」——getMergeStatus（子树子任务 × 开发分支 → 是否已合入需求分支）+ GET /api/nodes/:id/merge-status + 插件「合入状态」按钮（✓/✗ + 逐分支明细）
- feat(merge-mr): ① 进节点状态栏展示「🌿 需求分支」（沿父链取 subreq.reqBranch）② MR 式「合并预览」——previewMerge（diff --stat 变更统计 + merge-tree 冲突预判）+ POST /nodes/:id/merge-preview + 插件「合并预览」按钮（将引入变更/冲突文件/已合入跳过）
- feat(merge-upstream): 子需求上跳合并——「合并到 feature-merge」把需求分支合入集成分支（POST /nodes/:id/merge-upstream；已合入跳过/有新内容再合/冲突拒绝）
- feat(subreq-view): 子需求 Review 以需求分支视角呈现——branches 标注优先取 subreq.reqBranch（回退 demandBranch）、新增 mergedToReq；插件状态栏显示「🌿 需求分支 + ⚠ 未合并 N / ✓ 全部已合入」、列表未合并项标「⚠未合并」
