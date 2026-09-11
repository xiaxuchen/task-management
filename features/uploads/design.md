# 功能设计：图片上传

## 模块位置

- `server/http.mjs`（待建路由）：`POST /api/uploads`
- `server/index.mjs`：`/uploads` 静态托管（`express.static(UPLOAD_DIR)`）
- `server/config.mjs`：`UPLOAD_DIR = ~/.taskboard/uploads`（已定义）
- `web/src/components/DocPane.vue`：Vditor 的 `upload.handler` 接入

## 设计要点

- **用 base64 JSON 而非 multipart**：与 Vditor 自定义 `upload.handler` 配合最简单，
  且不需要引入 `multer` 等额外依赖。`express.json({ limit: '20mb' })` 已在 `http.mjs` 配好
- **落盘命名**：`<时间戳>-<随机>.<ext>`，避免覆盖；扩展名从 `name` 或 data URL 前缀取
- **校验顺序**：先扩展名白名单 → 再 base64 解码后的字节数（≤ 10 MB）→ 再落盘
- **静态访问**：`/uploads/:name` 由 `express.static` 提供，Markdown 预览直接引用

## 关联

- 设计文档 §7.7（文档的打开、渲染与编辑：图片粘贴 / 上传）、§6、§9（上传错误码）
- 决策 #13（附件图片存 `~/.taskboard/uploads/`）、#12（Vditor）

## 注意

`DocPane.vue` 当前的 Vditor 工具栏**未启用** `upload` 按钮（避免点了报错）；
本功能落地后接入 `upload.handler` 再把按钮加回去。