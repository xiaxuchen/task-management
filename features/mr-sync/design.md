# 功能设计：MR 自动拉取

## 模块位置

- `server/gitlab.mjs`（待建）：GitLab API 客户端（MR 查询 + 连通性测试 + diff 兜底）
- `mrs` 表（§4.5，已在 `db.mjs` 建表）：`UNIQUE(node_id, project, iid)`
- `web/src/views/SettingsView.vue`（已实现）：配置与「测试连接」
- `web/src/components/NodeDrawer.vue` 的 MR 区（`subreq` 节点）

## 设计要点

- 用内置 `fetch` + `PRIVATE-TOKEN` 头；**10s 超时**；分页最多 3 页（`per_page=100`）
- 字段映射后按 `(node_id, project, iid)` upsert，另存本地 `fetched_at` 用于「可能过期」提示
- **token 安全**：只存 `~/.taskboard/config.json`（权限 600），不入库、不进 git；接口返回时用 `maskToken` 打码
- 错误码按失败原因细分（未配置 / token 无效 / 项目路径错 / 网络不可达），便于 AI 与人区分处理（§9）

## 关联

- 设计文档 §7.3（MR 刷新）、§4.5（mrs 表）、§6、§9
- 决策 #5（MR 自动拉取 / commit 手工登记）、#6（token 存 config 600）

## 注意

v1 对 MR 只**只读**：不创建 MR、不 push、不动远端分支（§2.2）。
GitLab 的 `diff` 能力同时被 `diff-preview` 用作**本地仓库缺失时的兜底**。