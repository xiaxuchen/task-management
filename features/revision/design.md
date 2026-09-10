# 设计：变更可见与审计（revision）

## 1. 存储

`meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`，其中 `key='revision'` 存放版本号（TEXT 存整数）——不复用业务表，避免与节点数据耦合；`db.mjs` 的 `seed()` 里 `INSERT OR IGNORE` 初始化为 `0`。

## 2. 关键设计

- `bumpRevision()`：`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key='revision'`；`getRevision()` 一次 SELECT 读回（成本极低，适合前端 10s 轮询）。
- `actor(by)`：`ACTORS = {user, ai, cli, import}` 白名单；非白名单值落回 `user`，**不报错**（审计不该阻塞业务写入）。
- 每个写函数的收尾固定两件事：写 `updated_by`（及首次写入的 `created_by`）+ `bumpRevision()`。当前覆盖：`createNode` / `updateNode` / `deleteNode` / `reorderSiblings` / `setAttrs` / `createDocument` / `updateDocument` / `upsertDocument` / `deleteDocument` / `reorderDocuments` / `addAttrDef` / `updateAttrDef` / `deleteAttrDef`。
- 事务型写函数（`setAttrs` / `reorder*`）把 `bumpRevision()` 放在 `COMMIT` 之后，避免回滚时把版本号也推进。
- **一次操作 = 一次递增**：`createNode` 内部会写属性与预置文档，若各自 bump 会让「建一个节点」涨 2；因此用 `withoutBump(fn)` 把组合写入括起来（内部 `bumpRevision()` 直接返回），只在最外层收尾调一次。
- `created_by` 只在创建时写一次，后续更新不动它（测试里显式验证）。

## 3. 对外接口

```js
getRevision()      // → number
bumpRevision()     // 内部使用；写操作后调用
actor(by)          // → 'user' | 'ai' | 'cli' | 'import'
```

## 4. 与主设计文档的对应

§5.1「变更可见：任何写入使 `GET /api/revision` 递增；前端每 10 秒轮询」——本功能提供数据侧的递增契约，HTTP 暴露与前端轮询分别在计划 2、计划 3；§4.11 的「操作者审计」即 `created_by` / `updated_by` 的取值约定。
