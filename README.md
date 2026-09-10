# task-board

以树形方式组织研发任务的本地任务管理器：项目 → 需求 → 子需求 → 任务组（可嵌套）→ 子任务（+ 缺陷）。

- 设计文档：`../docs/superpowers/specs/2026-09-11-task-board-design.md`
- 本地数据：`~/.taskboard/data.db`（SQLite），配置：`~/.taskboard/config.json`（权限 600）
- 测试隔离环境变量：`TASKBOARD_HOME`（不改则用 `~/.taskboard`，测试里指向临时目录）

## 开发

```bash
npm test        # 数据层单测（计划 1 起可用）
```

## 计划进度

计划 1 数据层（本仓库当前内容）→ 计划 2 三入口 → 计划 3 Web UI → 计划 4 Git 集成与冲突处理 → 计划 5 MR / 上传 / 冒烟
