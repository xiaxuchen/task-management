# 功能：属性系统（attributes）

- 计划：计划 1 · Task 7
- 代码：`server/store.mjs`（属性部分：`listAttrDefs` / `addAttrDef` / `updateAttrDef` / `deleteAttrDef` / `setAttrs` / `getAttrs`）、`test/store-attrs.test.mjs`
- 主设计文档：`../../docs/design.md` §4.2（attr_defs）、§4.3（attr_values）、§4.9（预置属性定义）、§7.2（属性编辑）

## 1. 目标

让「每种节点类型的专属属性」可扩展：新增属性只插一行定义，表结构与前端都不用改；同时保证值可被 AI 与人安全写入（类型/必填校验、停用定义不参与校验）。

## 2. 需求点

- R1 属性定义 CRUD：新增（nodeType / key / label / dataType / options / required / defaultValue / sort）、编辑（label / dataType / options / required / defaultValue / sort / enabled）、删除（连带删除其值）。
- R2 数据类型：`text` / `textarea` / `number` / `date` / `select` / `url`；`select` 的选项为 `[{value,label}]`。
- R3 值读写：`setAttrs(nodeId, attrs, by)` 按 key 局部更新（幂等 upsert）；`getAttrs(nodeId)` 返回 `{key: value}`。
- R4 值校验：`number` 必须可解析为数字；`date` 必须是 `YYYY-MM-DD`；`select` 必须命中 options；`required` 不能为空。
- R5 停用语义：`enabled=0` 的定义不再出现在可用集合里，也不再参与校验；历史值保留可读。
- R6 未知 key / 停用 key / 类型不符 → `VALIDATION_FAILED`，`details` 带 `key`。
- R7 写值的副作用：同时刷新节点 `updated_at` / `updated_by`，并让 `revision` +1（供 AI 变更可见）。

## 3. 验收标准

- `test/store-attrs.test.mjs`：预置定义可列出 + 新增自定义属性、值校验四类拒绝、停用后不校验但历史值保留、删除定义连带删值
