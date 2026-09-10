# 功能：节点树与增删改（node-tree）

- 计划：计划 1 · Task 5–6
- 代码：`server/store.mjs`（节点部分）、`test/store-nodes.test.mjs`、`test/store-path.test.mjs`
- 主设计文档：`../../docs/design.md`（仓库内权威副本；评审版在工作区 `docs/superpowers/specs/2026-09-11-task-board-design.md`）§3（概念模型）、§4.1（nodes）、§7.1（建树）、§7.5（排序与移动）、§9（错误码）

## 1. 目标

用一棵自引用树承载「项目 → 需求 → 子需求 → 任务组（可任意嵌套）→ 子任务（+ 缺陷）」，并提供 AI 友好的引用方式与安全的增删改。

## 2. 需求点

- R1 建树规则：`project` 无父；`requirement` → `project`；`subreq` → `requirement`；`group` → `subreq | group`（可嵌套）；`task` → `group | subreq`；`defect` → `task | group`。
- R2 叶子规则：`defect` 不能再挂子节点（`LEAF_NODE`）；`task` 只允许挂 `defect`（挂 `group` → `PARENT_TYPE_INVALID`）。
- R3 拒绝清单：非法父类型 → `PARENT_TYPE_INVALID`；空名称 → `VALIDATION_FAILED`；移动到自身或后代 → `CYCLE_DETECTED`。
- R4 引用方式：节点可用数字 id 或路径（`项目A/需求1/子需求2`）引用；路径不存在 → `PATH_NOT_FOUND`；同名歧义 → `PATH_AMBIGUOUS` 并提示改用 id。
- R5 排序：同级 `sort` 步长 10；`reorderSiblings(parentId, orderedIds)` 一次性重排。
- R6 级联删除：删节点即删整棵子树，返回 `{nodes, documents, attrValues, commits, mrs, merges}` 计数。
- R7 读取：`listTree()` 返回带 `children` 的树；`listChildren(parentId)` 带 `childCount`；节点 VO 带 `path` 与审计字段。

## 3. 验收标准

- `test/store-nodes.test.mjs`：建五级树 + 缺陷并校验 path、父子/叶子拒绝、成环拒绝、级联删除计数、同级排序与 reorder
- `test/store-path.test.mjs`：id / 路径命中、`PATH_NOT_FOUND`、`PATH_AMBIGUOUS`
