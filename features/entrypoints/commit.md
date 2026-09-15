# 三入口功能提交记录

- feat(ops): 共享能力层 —— buildSchema、renderTreeMd、upsertByPath、parseOutline、importOutline、applyBatch
- feat(http): express REST API（nodes/attrs/docs/commits/repos/config CRUD + upsert/batch/import）
- feat(cli): taskboard CLI 命令（tree/node/attr/doc/commit/repo/import/batch/config）
- feat(mcp): MCP server（StdioServerTransport，29 个工具用 zod schema 描述）
- feat(index): 启动服务（端口自动回退 + open 浏览器）
- test(ops): ops 共享能力层 13 个单测
- test(http): HTTP 集成测试 17 个（含 confirm 语义、CRUD、文档 upsert、import、错误码）
- docs(features): features/{entrypoints,commit-registry} 功能目录（prd/design/commit.md）
- chore(package): 加 start/smoke scripts，更新 README 计划进度
- fix(server): index.html（含 SPA 回退路由）设 `Cache-Control: no-cache` + ETag，
  避免前端重新构建后浏览器仍用启发式缓存的旧版本（带 content-hash 的 assets 不受影响）
- feat(uploads): 图片上传纳入三入口 1:1——HTTP `POST /api/uploads`（201）+ `/uploads` 静态托管；CLI `upload <路径>` / `--name`+`--data`；MCP `upload_image`；三者共用 `server/uploads.mjs` 校验核心，能力清单登记 `upload_image`
- fix(entrypoints): 框架层错误归一（`mapFrameworkError`）——body-parser / send 的错误无业务码，原先经 `STATUS_BY_CODE` 兜底成 500，把「请求体过大」「JSON 格式错」这类客户端错误报成服务端故障；现映射 413 `PAYLOAD_TOO_LARGE` / 400 `VALIDATION_FAILED` / 415，其余 4xx 保留状态码并补稳定 code；CLI 本地文件错误归一成 `VALIDATION_FAILED`；MCP `upload_image` 改 `z.string().catch(undefined)` 让类型错误走 `isError` 而非 SDK `-32602`（对外 schema 不退化）
