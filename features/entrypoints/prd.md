# 功能：三入口（HTTP API / CLI / MCP）

## 所属计划

计划 2。

## 需求

- HTTP REST API：基于 express 提供所有节点/文档/属性/仓库/配置 CRUD，以及 upsert/batch/import
- CLI：`taskboard <命令>` 方式操作，支持 `--format md`、`--dry-run`、`--confirm`
- MCP server：通过 stdio 暴露所有工具，AI 可直接调用
- 三个入口共用同一核心 store，不复制业务逻辑
- 删除/移动操作必须显式 `confirm`

## 验收标准

- `npm start` 起服务，打开浏览器，健康检查可达
- `taskboard tree --format md` 输出 markdown 树
- MCP server 连接后 `schema`、`tree`、`node_get` 等工具正常返回
- `POST /api/nodes/upsert` 幂等创建
- 删除无 `confirm` 返回 400 CONFIRM_REQUIRED