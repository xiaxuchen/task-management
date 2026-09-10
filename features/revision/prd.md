# 功能：变更可见与审计（revision）

- 计划：计划 1 · Task 9
- 代码：`server/store.mjs`（`getRevision` / `bumpRevision` / `actor`，以及各写函数的审计字段与 bump）、`server/db.mjs`（`meta` 表）、`test/store-revision.test.mjs`
- 主设计文档：`../../docs/design.md` §4.1（nodes 的 created_by/updated_by）、§4.11（写入即递增 revision 的约定）、§5.1（AI 友好约定：变更可见）

## 1. 目标

让「谁在什么时候改了什么」可查、可轮询：AI 是主要操作者，UI 必须在 AI 改完后自动刷新；同时为后续的审计与 IDE 插件提供单调递增的版本号。

## 2. 需求点

- R1 版本号：`meta.revision` 初始 0；**任何写操作**（建/改/删节点、写属性、增删改文档、排序）都 +1；`getRevision()` 读当前值。
- R2 审计字段：`nodes.created_by` / `nodes.updated_by`、`documents.created_by` / `updated_by`、`attr_values.updated_by` 记录操作者。
- R3 操作者白名单：`user` / `ai` / `cli` / `import`；传入非法值（含 undefined）统一落回 `user`，避免脏数据。
- R4 副作用一致性：写属性时同时刷新所属节点的 `updated_at` / `updated_by`（属性变更也是节点变更）。
- R5 消费方（计划 2 / 3）：`GET /api/revision` 暴露该值；前端每 10 秒轮询，值变化即重载树与当前抽屉，无需人工刷新。

## 3. 验收标准

- `test/store-revision.test.mjs`：任何写入都让 revision +1（建节点 → 改状态 → 写文档 → 删节点依次 1/2/3/4）；`created_by` / `updated_by` 正确记录 `ai` / `cli`，且后续写入不覆盖 `created_by`
