# 功能设计：dsh-charge 需求同步导入

## 模块位置

`server/import-dsh.mjs`

## 设计思路

- 直接操作 SQLite 库（`node:sqlite`），不经过 store 层，避免引入 store 的 revision 递增和副作用
- 幂等写入：`ensurePath()` 按路径查找已有节点，存在则复用
- 文档内容不覆盖：已有内容且新内容为空时保留原内容
- 属性定义自动创建：`req_no`、`branch`、`slug` 等 attr_def 在首次导入时自动新增

## 关键规则

- 所有导入节点标记 `created_by = 'import'`、`updated_by = 'import'`
- 导入状态统一为 `done`（已完成）
- 数据类型映射：dsh-charge 的 `requirement_id` → task-board 的父子关系
- 关闭数据库前确保 WAL 模式已启用，避免并发读写问题