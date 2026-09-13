# 提交记录 · 审批合并

- feat(commits): 登记 commit 自动带「分支」——commits 表加 branch 字段（迁移幂等）；addCommit 支持 branch 并在已存在时补齐；HTTP/MCP 登记未提供分支时自动从本机 git 推断（pickBranchForCommit：排除 feature-merge、优先最具体 feature-*）；已回填 89 条历史提交
- feat(merge): 审批合并闭环——「标记通过」自动把子任务开发分支合入所属子需求的需求分支（主仓库执行）；服务端安全判定（已合入跳过/未解决冲突拒绝/冲突回执）；新 API POST /api/nodes/:id/merge；fix http.mjs 重复 comments 段
- feat(merge-status): 组级「合入状态」——getMergeStatus（子树子任务 × 开发分支 → 是否已合入需求分支）+ GET /api/nodes/:id/merge-status + 插件「合入状态」按钮（✓/✗ + 逐分支明细）
