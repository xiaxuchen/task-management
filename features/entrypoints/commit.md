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