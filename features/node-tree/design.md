# 设计：节点树与增删改（node-tree）

## 1. 数据结构

`nodes(id, type, parent_id, name, status, sort, created_at, updated_at, created_by, updated_by)`：`type` 带 CHECK 约束；`parent_id` 自引用 + `ON DELETE CASCADE`；索引 `idx_nodes_parent(parent_id, sort)`。树形靠自引用表达，任务组的任意嵌套天然支持。

## 2. 关键规则

- 类型白名单来自 `db.mjs` 的 `CHILD_TYPES`（父 → 允许子数组），store 不重复定义。
- `createNode`：校验 type / parent / name → 取 `同父 MAX(sort)+10` → 写审计字段（`created_by`/`updated_by` = `actor(by)`）→ 可选写属性 → 按 `docPresets` 预置空文档 → `bumpRevision()`。
- `updateNode`：可改 `name` / `status` / `parentId` / `attrs`；改父时用递归 CTE 取自身子树 id 集合，若目标父在其中则报 `CYCLE_DETECTED`。
- `deleteNode`：先按子树 id 集合统计关联行数，再删根节点（依赖外键级联），返回计数对象。
- `resolveRef`：纯数字视为 id；否则按 `/` 逐级过滤同名节点，命中多个即 `PATH_AMBIGUOUS`（`details.matchedIds`）。
- 节点 VO 的 `path` 由 `buildPath()` 逐级回溯拼接名称，不落库。

## 3. 对外接口

```js
createNode({ parentId, type, name, status, attrs, actor })   // → NodeVO
updateNode(id, { name?, status?, parentId?, attrs? }, by)     // → NodeVO
deleteNode(id)                                               // → { nodes, documents, attrValues, commits, mrs, merges }
getNode(id) / resolveRef(ref)                                 // → NodeVO
listChildren(parentId)                                        // → NodeVO[]（带 childCount）
listTree()                                                    // → 树根数组（children 嵌套）
reorderSiblings(parentId, orderedIds)                         // → NodeVO[]
subtreeIds(id)                                                // → number[]
```

## 4. 错误码

`PARENT_TYPE_INVALID`（含 `details.allowedChildren`）、`LEAF_NODE`、`CYCLE_DETECTED`、`VALIDATION_FAILED`、`NOT_FOUND`、`PATH_NOT_FOUND`、`PATH_AMBIGUOUS`。

## 5. 与主设计文档的对应

§3 的父子矩阵即 `CHILD_TYPES`；§7.1 建树的 UI 入口、§7.5 的拖拽排序与「移动到…」分别落到 `reorderSiblings` / `updateNode({parentId})`（UI 在计划 3）。
