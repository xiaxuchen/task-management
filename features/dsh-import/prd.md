# 功能：dsh-charge 需求同步导入

## 所属计划

计划 3 配套功能。

## 需求

把 dsh-charge（`~/.dsh/charge/requirements.db`）的历史需求**按 task-board 规格撰写**导入，
而不是字段级的照搬拷贝。产出必须能直接被 task-board 的树 / 属性 / 文档体系消费。

## 规格映射

| dsh-charge 来源 | task-board 节点 | name | 文档（对齐 docPresets） | 属性（对齐 §4.9） |
|---|---|---|---|---|
| —（固定容器） | `project` | `dsh-charge 历史需求` | 「描述」 | — |
| `requirements` | `requirement` | `title`（清洗） | **「需求内容」** ← `note` | `req_no`\* / `feishu_url`\* / `branch`\* |
| `subreqs` | `subreq` | `name`（清洗） | **「需求内容」** ← `task_desc`；「验证说明」← `verify_note` | `branch` / `baseline` / `gitlab_project` |
| `subtasks`（仅非冗余项） | `task` | `name`（清洗） | 「需求内容」← `task_desc`；「验证说明」← `verify_note` | `slug` / `branch` / `base_branch` 无源数据；`test_report_url`\* |
| `sql_items` | `requirement` 上的文档 | — | 「SQL: {feature}」 | — |

\* = **扩展属性**。设计文档 §4.2 明确「新增属性 = 插入一行，表结构与前端都不需要改动」，
故按需扩展是被规格允许的，`design.md` 里逐项记录了理由。

## 关键规则

- **冗余剔除**：dsh-charge 建子需求时会自动生成一个与其**同名且同内容**的子任务作「登记单元」。
  该单元不建 `task`，内容由 `subreq` 承载；同名但正文有增量（后续编辑过）时保留。
- **状态映射**：`planned`→`todo`、`reviewing`/`developing`→`doing`、`merged`/`done`→`done`，
  结果必须落在 §4.8 的值域内（每类节点的可用集合）。
- **名称清洗**：剥离 `- 概要设计` / `- 小优化` 等流程性后缀（支持叠加，如 `X-小优化 - 概要设计` → `X`），
  原始全名附在文档开头便于追溯。
- **长文本归文档**：`task_desc` / `note` / `verify_note` 都是长文本（平均 1–2 千字），一律落文档；
  属性只承载结构化短字段（编号 / 分支 / 链接）。

## 验收标准

- `node server/import-dsh.mjs --dry-run` 输出统计与冗余剔除数
- `node server/import-dsh.mjs --reset` 重建后：**6 需求 / 47 子需求 / 41 子任务 / 剔除 34 冗余单元**
- 文档名全部为 docPresets 预置名或已声明的扩展文档名，无自造名
- 所有节点状态落在 task-board 值域内
- 树结构符合 `project → requirement → subreq → task` 层级约束