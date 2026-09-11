# 文档索引

本目录是 task-board 的**文档中枢**。
先看 [`../AGENTS.md`](../AGENTS.md)（给 AI 编码助手）或 [`../README.md`](../README.md)（给人类）。

## 文档地图

| 文档 | 作用 | 权威性 |
|---|---|---|
| [`../AGENTS.md`](../AGENTS.md) | 给 AI 编码助手的项目指引：分层铁律 · 提交规范 · 文档规范 · 测试规范 · AI 操作入口 · 已知坑 | 指引 |
| [`../README.md`](../README.md) | 人类上手：快速开始 · 常用命令 · 运行时数据路径 | 指引 |
| [`design.md`](./design.md) | **主设计文档**：概念模型 · 数据模型 · 架构与技术选型 · 接口清单 · 13 个关键流程 · UI 设计 · 错误码 · 测试策略 · 24 条决策记录 · 术语表 | **权威** |
| [`api.md`](./api.md) | 接口速查：关键 REST 接口的请求 / 响应示例与 curl | 参考（以 `design.md` §6 与运行时 `schema` 为准） |
| [`plans/`](./plans/) | 实施计划（按子系统拆分，含任务级步骤与验收标准） | 历史记录 |
| [`../features/README.md`](../features/README.md) | 功能索引：功能 → 目录 → 所属计划 → 状态 → 代码位置 | **权威** |
| [`../features/<功能>/`](../features/) | 每个功能的 `prd.md`（需求）/ `design.md`（设计）/ `commit.md`（提交记录） | **权威** |

## 设计文档的关系（重要）

- **`design.md` 是唯一权威的设计来源**，本仓库不保留第二份副本。
- 设计评审期间的过程存档（内容与 `design.md` 等同，差异仅在头部说明）留在工作区
  `charge2/docs/superpowers/specs/2026-09-11-task-board-design.md`，**不重复入库** ——
  两份同源文档会让后续修改产生漂移。
- 实施计划按子系统拆分（计划 1 数据层 / 计划 2 三入口 / 计划 3 Web UI / 计划 4 Git 集成 / 计划 5 MR 与冒烟）。
  计划 1 已归档到 [`plans/`](./plans/)；其余在实施时按同一格式补入，不预先占位。

## 更新规则

见 [`../AGENTS.md`](../AGENTS.md) 的「文档维护规范」：

| 变更类型 | 更新哪里 |
|---|---|
| 接口（REST / MCP / CLI） | `design.md` §6 + 对应 `features/*/design.md` |
| 数据模型（表 / 字段） | `design.md` §4 |
| 新增决策 | `design.md` §12 |
| 功能行为变化、踩过的坑 | `features/<功能>/design.md` |
| 架构 / 分层变化 | `design.md` §5 + `AGENTS.md` |