# 功能：dsh-charge 需求同步导入

## 所属计划

计划 3（Web UI 配套功能）。

## 需求

- 将 dsh-charge 的 `requirements.db` 中的数据导入 task-board
- 导入层级：project → requirement → subreq → task
- 保留需求编号（req_no）、分支信息（branch）、SQL 脚本作为文档
- 支持 `--dry-run` 预演模式

## 映射关系

| dsh-charge | task-board | 说明 |
|---|---|---|
| requirements 表 | requirement 节点 | 属性：req_no、branch；文档：需求说明、SQL 脚本 |
| subreqs 表 | subreq 节点 | 属性：slug、branch；文档：需求描述、验证说明 |
| subtasks 表 | task 节点 | 文档：任务描述、验证说明 |
| sql_items 表 | 需求节点的 SQL 文档 | 文档名：`SQL: {feature}` |

## 验收标准

- `node server/import-dsh.mjs --dry-run` 预演输出统计
- `node server/import-dsh.mjs` 实际写入 task-board 数据库
- 启动 Web 后能在树中看到导入的数据