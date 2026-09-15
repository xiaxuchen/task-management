# 提交记录（documents）

- feat(store): 文档 CRUD（重名 409、按名 upsert 幂等、排序与级联）
- fix(documents): 修正预览留白选择器（vditor-reset 与容器同元素）并加大 padding 至 16px 24px
- feat(documents): 文档管理垂直切片——需求文档集中检索 / 查看编辑定位 / 核心文档关联与缺口对账；store.documentOverview 纯读聚合（项目、状态、关键词、文档名、filled/empty 筛选），HTTP / CLI / MCP 1:1；新增 DocumentsView 复用 DocPane；补聚合与三入口回归
