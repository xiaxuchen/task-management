# 功能设计：dsh-charge 需求同步导入

## 模块位置

`server/import-dsh.mjs`

## 为什么不用 store 层

直接以 `node:sqlite` 操作 task-board 库，不走 `server/store.mjs`：

- store 的每个写方法都会 `bumpRevision()`，批量导入会产生上百次 revision 递增，污染前端的变更感知
- 导入需要精确控制「按 docPresets 预置文档」的时机与内容（含原始名追溯行），store 的 `createNode` 签名不覆盖
- 导入结束后手动把 `meta.revision` +1 一次，前端轮询即可感知

代价：需自行保证与 store 一致的数据约束（父子类型、文档预置），已在 `ensureNode` 内对齐。

## 三个核心判定

| 判定 | 规则 | 依据 |
|---|---|---|
| 名称清洗 | 循环剥离 `\s*[-–—]\s*(概要设计\|详细设计\|详设\|细设)\s*$` 与 `\s*[-–—]\s*(小优化\|小改造\|小调整)\s*$`，直到稳定 | 递归处理「`X-小优化 - 概要设计` → `X`」这类叠加后缀；不剥离裸「设计」以免误伤 |
| 冗余剔除 | `同内容`（task_desc 非空且与 subreq 逐字相同）**或** `同名且双方正文皆空` | 判定依据是**内容**而非数量：多子任务的 subreq 里同样可能存在同名同内容的登记单元 |
| 状态映射 | `planned→todo`、`reviewing/developing→doing`、`merged/done→done`，未知值兜底 `todo` | 结果必须落在 §4.8 每类节点的可用集合内 |

## 扩展属性清单（及理由）

| 节点类型 | key | label | 类型 | 理由 |
|---|---|---|---|---|
| requirement | `req_no` | 需求编号 | text | 业务主键（如 `XPD-1141544` / `26Q3`），是跨系统引用与 commit message 的锚点 |
| requirement | `feishu_url` | 飞书文档 | url | PRD 原文入口；结构化短字段，适合属性而非文档正文 |
| requirement | `branch` | 分支 | text | 需求主分支，缺失则无法回溯集成分支（§4.9 仅 subreq 有 branch） |
| task | `test_report_url` | 测试报告 | url | 测试报告入口；结构化短字段 |

**未导入**的 dsh-charge 字段及原因：`branch_group_id` / `feature_row_id` / `approval_external_id` / `approval_url`
属 dsh-charge 内部工作流标识，task-board 无对应概念；`review_note` 源库 0 条非空；`subreq.slug`
是分支命名的中间产物，其信息已完整包含在 `subreq.branch` 中（`feature-x-0-dianfu-kaipiao`）。

## 幂等与重建

- 默认**幂等**：`ensureNode(parentId, name, type)` 命中同父同名节点即复用，不重复建
- `--reset`：先删除根项目节点（靠 `PRAGMA foreign_keys = ON` 级联清掉子树 / 文档 / 属性值）再重建
- ⚠️ **attr_defs 不会被 reset 清除**（它属配置，可能含用户手工项）。若某次导入改了属性规划，
  需要手工清理不再使用的定义，否则会残留（实际踩过：`subreq.slug` 残留需手工 `DELETE`）

## 其他

- 导入节点统一 `created_by`/`updated_by = 'import'`，可在 UI 审计列区分
- 文档写入为**内容不同才覆盖**，避免重复导入时无谓的 `updated_at` 抖动
- `requirement` 正文若发生过名称清洗，文档开头会加一行 `> 原始名称：…` 便于追溯