# 功能设计：图片上传

## 模块位置

- `server/uploads.mjs`：**共享核心**——校验 + 落盘（`decodeUpload` / `saveUpload`），三入口共用
- `server/http.mjs`：`POST /api/uploads` 路由 + `/uploads` 静态托管（挂在 `createApp` 内，
  保证测试与真实服务含 SPA 回退时行为一致）
- `server/cli.mjs`：`upload <路径>` / `upload --name x.png --data <base64>`
- `server/mcp.mjs`：`upload_image { name, data }`（纳入 `ops.mjs` 的 `TOOLS` 能力清单）
- `server/config.mjs`：`UPLOAD_DIR = ~/.taskboard/uploads`
- `web/src/components/DocPane.vue`：Vditor `upload.handler` 接入（粘贴 / 拖拽 / 工具栏按钮）

## 设计要点

- **用 base64 JSON 而非 multipart**：与 Vditor 自定义 `upload.handler` 配合最简单，
  且不需要引入 `multer` 等额外依赖。`express.json({ limit: '20mb' })` 已在 `http.mjs` 配好。
- **落盘命名**：`<时间戳>-<随机>.<ext>`，避免覆盖。
- **校验顺序**：扩展名白名单 → base64 解码 → 字节数（≤ 10 MB）→ **魔数识别真实类型** →
  与声明的扩展名 / data URL mime 交叉校验。任一不符即拒绝，**落盘扩展名以真实内容为准**。
- **静态访问**：`/uploads/:name` 由 `express.static` 提供，Markdown 预览直接引用。

## 关键规则

**R1 入口只做参数装配，校验落在共享核心**：HTTP / CLI / MCP 都调 `saveUpload`，
错误码（`UPLOAD_INVALID_TYPE` / `UPLOAD_TOO_LARGE` / `VALIDATION_FAILED`）在核心层单点产生，
避免三个入口各自实现一套校验后行为漂移。MCP 侧套 `mcpValidate`，把业务错误转成 `isError` 文本。

**R2 只信字节，不信文件名**：仅看扩展名会让「`evil.png` 里装脚本」通过，最终由静态路由原样回吐。
因此以 **magic number** 判定真实类型，并要求与声明类型一致；不一致时报出双方实际值便于自纠。
`jpeg` 作为扩展名别名收敛为真实扩展名 `jpg`。

**R3 大小上限判在解码后**：base64 有约 4/3 膨胀，按字符串长度判断会误杀或漏放；
统一在 `Buffer` 字节数上判 ≤ 10 MB。

**R4 上传不产生 revision**：产物是磁盘文件 + URL，不是业务数据（与
`acceptance_report` / `readiness` / `delivery_gate` 同一条「纯副作用最小化」原则）；
因此不接 store、不 bump revision，避免高频贴图制造变更噪声。

**R5 `handler` 的返回值是契约**：Vditor 约定返回 `string` 表示「失败并展示该文案」、
返回 `null` 表示已自行处理。因此 `handleUpload` 成功时自己 `insertValue` 并返回 `null`，
失败时聚合文案返回；成功落图后立即 `saveNow()`，保证 URL 随文档一起持久化。

## 踩坑 / 约束

- **`UPLOAD_DIR` 在模块 import 时就被 `TASKBOARD_HOME` 固定**（与 `config.mjs` 的既有约束一致）。
  共享核心的单测因此**显式传 `dir`**，入口测试则全程共用一个 HOME——否则第二个 `tempHome()`
  不会真的换目录，落盘会跑到上一个用例的临时目录里。
- **静态托管必须挂在 SPA 回退之前**：否则 `/uploads/*` 会被 `index.html` 兜底吞掉，
  表现为「图片能传不能看」。
- **入口测试各自新建 app / MCP 实例**：共用实例会让先跑完的用例把后跑用例的 server 和 MCP 连接一起关掉
  （表现为 `Not connected` / `ECONNREFUSED`）。

## 关联

- 设计文档 §7.7（文档的打开、渲染与编辑：图片粘贴 / 上传）、§6、§9（上传错误码）
- 决策 #13（附件图片存 `~/.taskboard/uploads/`）、#12（Vditor）
