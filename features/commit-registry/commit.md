# commit 登记功能提交记录

- feat(store): commits CRUD（list/add/remove，子树聚合，幂等）
- feat(http): commits 路由（GET/POST/DELETE）
- feat(cli): commit list / commit add 命令
- feat(mcp): commit_list / commit_add / commit_remove 工具- feat(commit-registry): commit 审查状态（pending/approved/issue + 意见）与三入口，支撑 IDEA 插件 review
- feat(commit-review): 多 commit 合并 diff（按仓库分组/文件并集/净 old-new；HTTP+CLI+MCP 三入口 + 测试）
- feat(combined-diff): 响应补充 commit 明细（作者/时间/分支，供 UI 展示；commitMeta 轻量元信息）
