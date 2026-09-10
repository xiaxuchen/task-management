# 设计：文档（documents）

## 1. 数据结构

`documents(id, node_id, name, content, sort, created_at, updated_at, created_by, updated_by)`：

- `UNIQUE(node_id, name)` —— 名称在同节点内唯一；`name` 是自由文本（不做枚举），rename 会改变引用，故 AI 侧建议用 `upsert` 而非改名。
- `idx_documents_node(node_id, sort)` —— 列表按 `sort` 升序、稳定。
- 外键 `node_id → nodes(id) ON DELETE CASCADE`：删节点连带删文档（`deleteNode` 的计数里已包含 `documents`）。

## 2. 关键规则

- **预置时机**：在 `createNode` 内、写属性之后，按 `createStore(db, { docPresets })` 注入的映射（默认值与 `config.docPresets` 一致）逐名 `upsertDocument(nodeId, name, '')`。
- **upsert 语义**：按 `(node_id, name)` 查；不存在走 `createDocument`；存在则仅当 `content !== null` 才更新内容，返回 `{ id, created, name }`。
- **改名查重**：`updateDocument` 改 `name` 时用 `id <> ?` 排除自身，命中别的文档才报 `DOC_NAME_EXISTS`。
- **排序**：与节点同级排序同一套路（`sort` 步长 10，事务内批量 `UPDATE`）。
- **审计与可见性**：所有写函数都记录 `actor(by)` 到 `created_by` / `updated_by` 并 `bumpRevision()`。

## 3. 对外接口

```js
listDocuments(nodeId)                      // → DocVO[]（按 sort, id）
createDocument(nodeId, name, content, by)  // → DocVO（重名/空名报错）
updateDocument(docId, { name?, content? }, by) // → DocVO
upsertDocument(nodeId, name, content, by)  // → { id, created, name }
deleteDocument(docId)                      // → { id }
reorderDocuments(nodeId, orderedIds)       // → DocVO[]
```

## 4. 错误码

`DOC_NAME_EXISTS`（同节点重名，`details.name`）、`VALIDATION_FAILED`（空名）、`NOT_FOUND`（文档不存在）。

## 5. 与主设计文档的对应

§4.6 的表结构与 `UNIQUE(node_id, name)`；§7.7 的「表格点 📄 数量 → 抽屉文档区」由计划 3 的 UI 消费这里的读写接口；§5.2 约定的「长文本一律走文档」即本功能存在的理由（属性只放结构化短字段）。
