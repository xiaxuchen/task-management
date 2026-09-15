# 提交记录（documents）

- feat(store): 文档 CRUD（重名 409、按名 upsert 幂等、排序与级联）
- fix(documents): 修正预览留白选择器（vditor-reset 与容器同元素）并加大 padding 至 16px 24px
- feat(documents): 文档版本历史与恢复——快照表 + 老库迁移 + 三入口 + 抽屉历史弹窗
- fix(documents): 收口 D1/D2/D3——快照表重映射、恢复冲突提示、无差异不留痕与恢复名 trim
- feat(uploads): 文档图片上传接入——DocPane 启用 Vditor `upload.handler`（粘贴 / 拖拽 / 工具栏按钮），逐张转 data URL 调 `/api/uploads` 并把返回地址写进 Markdown，成功后立即落库
- fix(uploads): 插入 Markdown 改用服务端转义的 `alt`——原先直接拼 `file.name`，文件名含 `]` 时会截断 `![alt](url)` 语法，出现「落库看着正常、预览却是裂图」的静默失败；同时修掉 SPA 回退在含点号目录段部署布局下失效（`sendFile` 绝对路径被 `send` 拒绝）导致深链 404 的问题，保证文档预览引用的 `/uploads/*` 能稳定取图
