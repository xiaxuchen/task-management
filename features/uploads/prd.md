# 功能：图片上传

## 所属计划

计划 5。

## 需求

- 文档编辑器**粘贴 / 选择图片** → 上传 → 编辑器把地址写入 markdown
- 上传走 `POST /api/uploads`：请求体 **JSON** `{ name, data }`（`data` 为 base64；`express.json` 限额 20 MB）
- 落盘 `~/.taskboard/uploads/<时间戳>-<随机>.<ext>`，返回 `{ url: "/uploads/<name>" }`
- `GET /uploads/:name` 静态访问（Markdown 预览使用）
- **限制**：仅 `png / jpg / jpeg / gif / webp`；单文件 ≤ 10 MB

## 接口（设计文档 §6）

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/uploads` | 上传图片（base64 JSON）→ `{ url }` |
| GET | `/uploads/:name` | 图片静态访问 |

## 验收标准

- 合法图片落盘并返回可访问 URL（`GET` 该 URL 能取回图片）
- 类型不符 → 400 `UPLOAD_INVALID_TYPE`（提示允许的格式）
- 超过 10 MB → 400 `UPLOAD_TOO_LARGE`（提示上限）
- 落盘文件名带时间戳 + 随机串，**不会覆盖**同名旧文件
- 编辑器粘贴图片后 markdown 中出现正确的 `/uploads/...` 地址并可预览