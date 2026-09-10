# 功能：工程基座与配置（foundation）

- 计划：计划 1 · Task 1–4
- 代码：`package.json`、`test/helpers.mjs`、`server/errors.mjs`、`server/config.mjs`、`server/db.mjs`
- 主设计文档：`../../docs/design.md`（仓库内权威副本；评审版在工作区 `docs/superpowers/specs/2026-09-11-task-board-design.md`）§4（数据模型）、§4.9–4.10（预置属性 / config）、§5（架构与技术选型）、§9（错误码）

## 1. 目标

给 task-board 一个可测试、可迁移、离线可用的地基：仓库骨架、本机配置（600 权限、token 不进库）、SQLite 建库建表与预置数据、稳定错误码。

## 2. 需求点

- R1 仓库骨架：Node ≥ 22.5 ESM（源码 `.mjs`）；`npm test` 用 `node --test` 自动发现 `**/*.test.mjs`（不带目录参数）。
- R2 配置：`~/.taskboard/config.json` 首次访问自动生成默认值；写入后权限固定 600；支持局部合并保存；`maskToken()` 把 token 换成 `****`。
- R3 测试隔离：`TASKBOARD_HOME` 可指向任意目录（测试用临时目录），不污染真实 `~/.taskboard`。
- R4 建库：打开 `~/.taskboard/data.db` 即建 10 张表（nodes / attr_defs / attr_values / commits / mrs / documents / repos / merges / unit_repos / meta）与索引，开启 WAL、外键、`busy_timeout=5000`。
- R5 预置：按主设计文档 §4.9 写入 15 条预置属性定义；`meta.revision` 初始化 0；重复打开不重复预置（幂等）。
- R6 错误码：稳定字符串常量；`String(err)` 自带错误码（CLI / AI 直读），`err.message` 保持人话，`err.details` 带字段级信息。

## 3. 验收标准

- `test/db.test.mjs`：10 张表齐全、WAL 与外键开启、预置幂等
- `test/config.test.mjs`：默认值生成、600 权限、局部合并、token 打码
- `test/errors.test.mjs`：错误码常量稳定、`fail()` 抛出的 `AppError` 带 code 与 details
