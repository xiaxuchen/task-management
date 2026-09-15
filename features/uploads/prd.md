# 功能：图片上传

## 所属计划

计划 5。

## 需求

- 文档编辑器**粘贴 / 选择图片** → 上传 → 编辑器把地址写入 markdown
- 上传走 `POST /api/uploads`：请求体 **JSON** `{ name, data }`（`data` 为 base64 或 data URL；`express.json` 限额 20 MB）
- 落盘 `~/.taskboard/uploads/<时间戳>-<随机>.<真实扩展名>`，返回 `{ url, name, size, mime, alt }`
  （`alt` 是服务端转义好的文件名，供前端直接拼 Markdown）
- `GET /uploads/:name` 静态访问（Markdown 预览使用）
- **限制**：仅 `png / jpg / jpeg / gif / webp`；单文件 ≤ 10 MB
- 校验以**文件字节（魔数）**为准，不只看扩展名：改名 / 伪装一律拒绝

## 接口（设计文档 §6）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/uploads` | 上传图片（base64 / data URL JSON）→ `{ url, name, size, mime, alt }` |
| GET | `/uploads/:name` | 图片静态访问 |

## 验收标准

- 合法图片落盘并返回可访问 URL（`GET` 该 URL 能取回图片）
- 类型不符 → 400 `UPLOAD_INVALID_TYPE`（提示允许的格式）
- 超过 10 MB → 400 `UPLOAD_TOO_LARGE`（提示上限）
- 落盘文件名带时间戳 + 随机串，**不会覆盖**同名旧文件
- 编辑器粘贴图片后 markdown 中出现正确的 `/uploads/...` 地址并可预览
- **不存在的 `/uploads/:name` 返回 404**，不得回落 SPA 返回 200 HTML（否则前端 `<img>` 静默裂图）
- 请求体超 20 MB JSON 限额 → 413 `PAYLOAD_TOO_LARGE`；非法 JSON → 400 `VALIDATION_FAILED`（都不落 500）
- 文件名的 `]` / `[` / `\` 由服务端在 `alt` 中转义，Markdown 图片语法不被截断
- CLI 上传本地文件不可读（不存在 / 目录 / 无权限）→ 400 `VALIDATION_FAILED`
- MCP `upload_image` 的类型错误 / 缺字段 → `isError + VALIDATION_FAILED`，不泄漏 SDK `-32602`
