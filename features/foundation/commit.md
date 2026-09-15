# 提交记录（foundation）

- chore: task-board 仓库骨架与测试基座
- fix(errors): 错误码写入 err.name，String(err) 与断言可直接命中
- fix(test): helpers 对 store.mjs 容错，避免 db/config 用例连带失败
- fix(test): openDb 落在本次临时目录，保证同文件用例隔离
- feat(config): 默认配置、600 权限与 token 打码
- feat(db): 建表、索引与预置属性定义（WAL + 外键 + busy_timeout）
- docs(features): 落地「功能之家」约定（features/<功能>/{prd,design,commit}.md），并把设计文档权威副本纳入仓库 docs/design.md
- docs: 计划 1 数据层完成，更新 README 进度与功能索引状态
- docs(readme): 补快速开始（clone→install→build→start）、常用命令表、运行时数据表与文档导航表
  - 修正设计文档链接（原指向工作区 `../docs/superpowers/specs/`，clone 后不可用 → `docs/design.md`）
  - 补「提交约定」（提交时同步追加本功能 commit.md）
- docs(features): entrypoints 补静态托管缓存策略记录
- docs(agent): 新增 AGENTS.md（AI 编码助手项目指引）+ AGENT.md（单数名兼容转发）
  - 内容：分层与三入口复用铁律、提交规范（scope 用功能目录名）、文档维护规范、
    测试规范、AI 操作入口（29 个 MCP 工具 + CLI 命令 + 推荐工作流）、关键约束、7 条已知坑
  - README 文档表登记 AGENTS.md
- docs(foundation): 新增 docs/README.md 文档索引（各文档作用与权威性、设计文档关系、更新规则）
- docs(foundation): 归档实施计划到 docs/plans/（plan1 数据层，1751 行）；设计评审存档不入库以免两份漂移
- docs(foundation): features/README.md 索引重构（分「已完成 / 已实现但无独立目录 / 需求已定待实现」三类）
- docs(foundation): 主设计文档按章节拆分到 `docs/design/`（10 个文件，单文件 24–231 行），
  `design.md` 变为总览 + 章节导航表（88 行）；同步更新 AGENTS.md / README.md / docs/README.md 的引用
  - 目的：AI 按需只读需要的章节（查表结构只读 `02-data-model.md`），不必加载 727 行全文
  - 章节号 §3–§13 保留，`features/*` 里的「§4.9」类引用经导航表可定位，无需批量改写
  - 接口口径统一：接口表留 `design/04-api.md`，请求/响应示例与 curl 全部归 `docs/api.md`
- feat(foundation): 新增数据快照导出/导入（`scripts/export-snapshot.mjs` / `import-snapshot.mjs`，
  npm scripts `snapshot:export` / `snapshot:import`）
  - 把 `~/.taskboard/data.db` 导成 `data/snapshot.json` 文本快照（可 diff / 可回放），
    入库 `data/snapshot.json`
  - 导入幂等：清空业务表后按旧 id→新 id 重映射重建（含父子与外键），revision 一并对齐
  - 安全：不导出/不恢复 `config.json`（含 GitLab token）；不建议直接提交 `data.db`（二进制 + WAL 会丢数据）
  - 验证：还原到临时空库后 nodes/docunents/attr_values 计数一致、正文 120804 字符一致、父子关系无孤儿
- fix(foundation): 修复数据快照静默丢表——表集合与导入顺序改为从 schema 推导
  - 缺陷：表清单硬编码在 `export-snapshot.mjs` / `import-snapshot.mjs` 两处且停在新库最早 9 张表，
    新增的 `test_cases` / `test_reports` / `release_items` / `comments` / `branch_configs` /
    `agent_*` / `ide_requests` 全部不进快照，且导出与导入都不报错（静默丢数据）
  - 修法：新增 `scripts/snapshot-tables.mjs` 作为单一来源——业务表 = `sqlite_master` − `EXCLUDED_TABLES`
    （排除项必须写明理由），**新增表自动进快照**；导入顺序按 `PRAGMA foreign_key_list` 拓扑排序，
    自引用表（`nodes.parent_id` / `agent_runs.parent_run_id`）按 id 升序插入；
    外键映射直接读 schema，不再为每张表手写插入逻辑
    （曾在修复中试过「再手写一份更全的清单」，当天即被并行分支新表撞出漂移，故改为 schema 推导）
  - 兼容：快照 `version` 升 2 并自带 `plan`；导入 v1 老快照缺表时显式告警（列出将被清空的表），
    目标库缺表时跳过并告警；`data/snapshot.json` 就地升级到 v2（原有行内容零改动，新增表为空）
  - 测试：`test/snapshot.test.mjs` 9 条（覆盖口径 / 拓扑顺序 / 端到端往返不丢表 /
    外键重映射无孤儿 / revision 与正文原值 / 新增表自动纳入 / v1 告警 / 格式校验）；
    变异验证：改回旧的 9 张硬编码清单会挂 5 条；`npm test` 252 全绿
  - 文档：`features/foundation/{prd,design}.md`、`docs/design/{02-data-model,08-testing,09-decisions}.md`、
    `AGENTS.md`、`README.md`、`features/README.md`
