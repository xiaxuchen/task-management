# 功能设计：三入口（HTTP API / CLI / MCP）

## 模块职责

- `server/ops.mjs`：共享能力层，不绑定任何入口
  - `buildSchema`：组装 /api/schema 的响应
  - `renderTreeMd`：树 → markdown 大纲（与 import 格式一致，可往返）
  - `parseOutline` / `importOutline`：markdown 大纲 ↔ 节点树
  - `upsertByPath`：按路径 get-or-create（幂等）
  - `applyBatch`：多步操作一次执行，单步失败不影响其余
- `server/http.mjs`：express 应用
  - 路由见设计文档 §6
  - Express 5 的异步错误自动转发到 error handler
  - `x-taskboard-actor` 头部可选覆盖操作者
- `server/cli.mjs`：CLI 命令
  - `node:util.parseArgs` 解析参数
  - 所有写入默认 `actor=cli`，可用 `--actor ai` 覆盖
- `server/mcp.mjs`：MCP server
  - `@modelcontextprotocol/sdk` 的 `McpServer + StdioServerTransport`
  - 所有工具的 input 用 zod schema 描述
- `server/index.mjs`：服务启动
  - 端口被占用时自动 +1（最多试到 basePort + 10）
  - macOS 自动 `open` 浏览器

## 关键规则

- 所有入口共用 `createStore(db)`，不创建各自的 store 实例
- 错误格式统一 `{ error: { code, message, details? } }`
- 删除/移动 `confirm: true` 是硬性校验，不由配置控制