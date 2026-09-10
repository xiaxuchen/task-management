# 设计：属性系统（attributes）

## 1. 数据结构

- `attr_defs(id, node_type, key, label, data_type, options, required, default_value, sort, enabled, created_at, updated_at)`，`UNIQUE(node_type, key)`；`key` 是数据引用锚点（改 label 不影响数据，改 key 等价于新建属性）。
- `attr_values(id, node_id, attr_def_id, value, updated_at, updated_by)`，`UNIQUE(node_id, attr_def_id)`；值统一 TEXT 存储，读取时按 `data_type` 解析（数字排序用 `CAST(value AS REAL)`，日期按 ISO 文本排序）。

## 2. 关键规则

- `DATA_TYPES = { text, textarea, number, date, select, url }`：`markdown` 已被主设计文档移除（长文本走「文档」功能）。
- `listAttrDefs(nodeType?, { includeDisabled })`：默认只返回 `enabled=1`（前端表单与校验都用这个集合）。
- `setAttrs` 在**事务**里执行：`BEGIN` → 逐 key 找启用定义（找不到即 `VALIDATION_FAILED`）→ `validateValue` → upsert `attr_values` → 刷新节点 `updated_at`/`updated_by` → `COMMIT`（异常 `ROLLBACK`）→ `bumpRevision()`。
- `getAttrs` 返回扁平 `{key: value}`；额外挂一个**不可枚举**的 `__meta`（`label` / `dataType` / `updatedAt` / `updatedBy`），方便 UI 与 AI 判断来源而不污染数据遍历。
- 删除定义走外键级联清值；停用只影响「可用集合与校验」，不动历史值。

## 3. 对外接口

```js
listAttrDefs(nodeType?, { includeDisabled = false })  // → AttrDefVO[]
addAttrDef({ nodeType, key, label, dataType, options, required, defaultValue, sort }) // → AttrDefVO
updateAttrDef(id, { label?, dataType?, options?, required?, defaultValue?, sort?, enabled? }) // → AttrDefVO
deleteAttrDef(id)                                     // → { id }
setAttrs(nodeId, attrs, by)                           // → getAttrs(nodeId)
getAttrs(nodeId)                                      // → { [key]: value }（含不可枚举 __meta）
```

## 4. 错误码

`VALIDATION_FAILED`（未知/停用 key、数字不可解析、日期格式错、select 未命中、必填为空；`details.key` 指明字段）、`NOT_FOUND`（定义不存在）。
