# task-board

以树形方式组织研发任务的本地任务管理器：项目 → 需求 → 子需求 → 任务组（可嵌套）→ 子任务（+ 缺陷）。

- 设计文档：`../docs/superpowers/specs/2026-09-11-task-board-design.md`
- 本地数据：`~/.taskboard/data.db`（SQLite），配置：`~/.taskboard/config.json`（权限 600）
- 测试隔离环境变量：`TASKBOARD_HOME`（不改则用 `~/.taskboard`，测试里指向临时目录）

## 开发

```bash
npm test        # 全部单测 + 集成测试
npm start       # 启动 HTTP 服务并打开浏览器
npm run smoke   # 冒烟测试
```

## 计划进度

- [x] 计划 1 数据层（config / db / store：节点·属性·文档·revision，24 个用例全绿）
- [x] 计划 2 三入口（HTTP API + CLI + MCP，ops 共享能力层 + 集成测试）
- [ ] 计划 3 Web UI（表格式展开树 + 右侧抽屉 + 文档区）
- [ ] 计划 4 Git 集成与冲突处理
- [ ] 计划 5 MR 拉取 / 上传 / 冒烟

## 目录约定（功能之家）

每个功能一个目录：`features/<slug>/`，只放 `prd.md`（功能需求）/ `design.md`（功能设计）/ `commit.md`（该功能的提交记录）；代码在 `server/`、`test/`、`web/` 按分层组织。索引见 `features/README.md`，主设计文档在 `docs/design.md`。
