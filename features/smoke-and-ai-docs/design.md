# 功能设计：冒烟脚本与给 AI 的用法

## 模块位置

- `scripts/smoke.mjs`（待建）：端到端冒烟
- `AGENTS.md`（已落地）：给 AI 的用法
- `docs/api.md`（已落地）：接口示例
- `package.json`：`smoke` 脚本已占位（`node --test --test-name-pattern='smoke'`）

## 设计要点

- **用 `node:test` 驱动**（与现有测试同构），用例名带 `smoke` 便于 `--test-name-pattern` 过滤
- **临时 git 仓库**：`fs.mkdtemp` + `git init` + 制造真实冲突（两个分支改同一行）
- **mock GitLab**：本地 stub server，或注入 `fetch` 替身，避免依赖真实 GitLab 与 token
- **隔离**：全程 `TASKBOARD_HOME` 指向临时目录，与真实数据完全隔离
- **断言点**：树形结构、级联删除计数、revision 单调递增、diff 内容、合并状态机、
  MR upsert 幂等、上传文件可访问

## 关联

- 设计文档 §10（测试策略：冒烟脚本）、§5.1（AI 友好约定：README 附给 AI 的用法）
- 决策 #14（AI 是主要操作者）

## 注意

冒烟脚本会起服务、建临时 git 仓库 —— 结束时要清理（临时目录、端口、后台进程），
避免残留进程或端口占用影响后续测试。