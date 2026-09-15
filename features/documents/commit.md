# 提交记录（documents）

- feat(store): 文档 CRUD（重名 409、按名 upsert 幂等、排序与级联）
- fix(documents): 修正预览留白选择器（vditor-reset 与容器同元素）并加大 padding 至 16px 24px
- feat(uploads): 文档图片上传接入——DocPane 启用 Vditor `upload.handler`（粘贴 / 拖拽 / 工具栏按钮），逐张转 data URL 调 `/api/uploads` 并把返回地址写进 Markdown，成功后立即落库
