# 功能：文档（documents）

- 计划：计划 1 · Task 8
- 代码：`server/store.mjs`（文档部分：`listDocuments` / `createDocument` / `updateDocument` / `upsertDocument` / `deleteDocument` / `reorderDocuments`）、`test/store-docs.test.mjs`
- 主设计文档：`../../docs/design.md` §4.6（documents）、§7.7（文档的打开、渲染与编辑）、§4.10（config.docPresets）

## 1. 目标

每个节点可挂**多份命名 markdown 文档**（长文本的唯一载体）：点开即在右侧渲染 / 编辑；文档名自由文本（不做枚举约束），同节点内唯一。

## 2. 需求点

- R1 预置：新建节点时按 `docPresets` 自动建空文档 —— 项目「描述」；需求 / 子需求「需求内容」；缺陷「描述」「复现步骤」；任务组 / 子任务无预置。
- R2 列表：`listDocuments(nodeId)` 按 `sort` 升序返回（含 content 与审计字段）。
- R3 新增 / 更新：`createDocument` 追加到末尾；`updateDocument` 可改 `name` / `content`；改名撞名同样拒绝。
- R4 名称唯一：同节点内重名 → `DOC_NAME_EXISTS`；空名 → `VALIDATION_FAILED`（UI 新增时自动加序号规避）。
- R5 AI 友好 upsert：`upsertDocument(nodeId, name, content)` 按名 get-or-create —— 已存在则更新内容并返回 `{created:false}`，重复调用安全。
- R6 排序 / 删除：`reorderDocuments(nodeId, orderedIds)` 一次性重排；`deleteDocument(docId)` 删除单篇（删节点时随外键级联全删）。
- R7 副作用：每次写入 `revision` +1，并记录 `created_by` / `updated_by`（user / ai / cli / import）。
- R8 版本留痕：文档创建、改名或改正文时自动保存不可变快照（名称 / 正文 / 变更原因 / 操作者 / 时间）。
- R9 历史查询：按文档 id 倒序列出历史版本，供 Web 与 AI 判断之前发生了什么。
- R10 版本恢复：可恢复历史版本并追加一条 `restore` 快照，不改写既有历史；恢复旧名称撞到现存文档时返回 `DOC_NAME_EXISTS`。
- R11 老库迁移：老库首次打开时为已有文档回填一条 `migrated` 基线快照，重复打开不重复回填。

## 3. 验收标准

- `test/store-docs.test.mjs`：按类型预置文档、按名 upsert 幂等且覆盖内容、重名新建与改名撞名报 `DOC_NAME_EXISTS`、排序与删除
- `test/document-history.test.mjs`：创建 / 更新留痕、恢复追加新版本、重名恢复拒绝、HTTP / CLI / MCP 一致性、老库迁移幂等
