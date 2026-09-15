# 图片上传功能提交记录

> 状态：**已实现**（计划 5）。

- docs(uploads): 建立功能文档 —— prd（需求 + 接口表 + 验收标准）、design（base64 JSON / 落盘命名 / 校验顺序 / Vditor handler）
- feat(uploads): 图片上传闭环——新增 server/uploads.mjs 共享核心（扩展名白名单 + ≤10 MB + 魔数交叉校验，改名/伪装一律拦下，落盘 <时间戳>-<随机>.<真实扩展名> 不覆盖）；HTTP POST /api/uploads（201）+ /uploads 静态托管挂在 createApp 内（先于 SPA 回退）；CLI upload <路径> / --name+--data；MCP upload_image（纳入 TOOLS 能力清单）；DocPane 接入 Vditor upload.handler（粘贴/拖拽/工具栏）+ 立即落库；13 条 UT 覆盖核心校验、三入口 1:1 与四入口落盘语义一致；npm test 257/257，npm run build 通过
- fix(uploads): 按独立验收报告返工 D1–D6——① D1 `/uploads/*` 未命中追加**终结性 404**，不再回落 SPA（否则图片被删后 `<img>` 拿 200+index.html 静默裂图）② D4 SPA 回退改根相对 `sendFile('index.html', { root: dist })`，修掉「绝对路径含点号目录段被 send 拒绝」导致深链整体 404、并让原验收在失效环境里得出错误结论的坑；静态托管/SPA 优先级抽到 `server/static.mjs` 以便 UT ③ D3 新增 `mapFrameworkError`：`entity.too.large → 413 PAYLOAD_TOO_LARGE`、`entity.parse.failed → 400 VALIDATION_FAILED`，不再把客户端错误报成 500 ④ D2 上传返回体新增服务端转义的 `alt`，文件名含 `]` 不再截断 Markdown 图片语法 ⑤ D5 CLI 文件不可读归一成 `VALIDATION_FAILED`（`details.reason` 保留 ENOENT/EISDIR/EACCES）⑥ D6 `z.string().catch(undefined)`——对外 JSON schema 不退化（type:string + required），类型错误/缺字段改为 `isError + VALIDATION_FAILED` 不再泄漏 SDK `-32602`
- test(uploads): 补 D1–D6 回归 UT —— 新增 `test/static-spa.test.mjs`（5 条，含点号目录段布局下的静态托管/SPA 优先级与终结性 404）+ `test/uploads.test.mjs` 扩到 18 条（框架层错误归一、alt 转义、CLI 文件系统错误、MCP 类型错误 + schema 不退化）；每条缺陷 UT 已用旧实现验证必失败；`npm test` 266/266、`npm run build` 通过
