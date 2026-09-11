# 功能设计：代码集成（显式合并）

## 模块位置

- `server/git.mjs`（待建）：合并、预检、分支操作
- `merges` 表（§4.11，已在 `db.mjs` 建表）
- `unit_repos` 表（§4.12）：决定工作单元覆盖哪些仓库
- `web/src/components/NodeDrawer.vue` 的「工作区 + 合并」区

## 设计要点

- **预检**：`git merge-tree <base_sha> <target_sha> <source_sha>`（纯内存三方合并）。
  解析输出中是否含 `<<<<<<<` 判断冲突；不写工作区、不建 commit
- **执行合并**：在目标分支上 `git merge --no-ff <source_branch>`；失败则报告 stderr 并保持原状
- **一次合并 = 按仓库各写一行 `merges`**（`source_branch` / `target_branch` / 三个 sha / `state`）
- **状态机**：`precheck_conflict` →（冲突处理后）`resolved`；直接成功 → `merged`；放弃 → `aborted`
- **批量**：按节点 `sort` 升序逐单元预检 + 合并，遇冲突立即停止并返回已完成列表

## 关联

- 设计文档 §7.11（代码集成与合并）、§4.11（merges 表）、§4.12（unit_repos）、§6
- 决策 #20（合并为显式操作）、#22（merges 表）、#24（工作单元支持多仓库）

## 注意

合并会改本机分支，属**破坏性**操作：HTTP 需 `confirm: true`，CLI 需 `--confirm`；
预检不在此列（无副作用）。v1 **不 push、不创建 MR**（§2.2）。