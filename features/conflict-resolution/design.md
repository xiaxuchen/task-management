# 功能设计：冲突检测与处理

## 模块位置

- `server/git.mjs`（待建）：解析 `merge-tree` 输出、生成补丁
- `merges.conflict_files`（JSON 字段，§4.11）
- `web/src/components/ConflictPane.vue`（待建）：MergeView 逐块处理

## 设计要点

- **冲突块解析**：把 `merge-tree` 输出的 `<<<<<<< / ======= / >>>>>>>` 段落结构化为
  `{ file, blocks: [{ base, ours, theirs, oursStartLine, oursEndLine, theirsStartLine, theirsEndLine }] }`
- **落库**：原始冲突块存 `merges.conflict_files`（JSON）；resolve 时写回合并结果与补丁
- **前端**：`@codemirror/merge` 的 MergeView 提供三栏（或 ours–theirs 两栏 + base 折叠），
  每块「保留当前 / 采用传入 / 手改」；顶部「全部接受当前 / 全部接受传入」与上一个 / 下一个块导航
- **三入口同源**：REST `GET /api/merges/:mid/conflicts` ↔ CLI/MCP `conflict show` / `conflict resolve`
  —— AI 读同样三方数据、写回同样结果

## 关联

- 设计文档 §7.12（冲突处理）、§8.5（ConflictPane）、§4.11、§6
- 决策 #21（冲突在工具内处理 + AI 可写）、#18（CodeMirror MergeView）

## 注意

冲突处理**不自动改分支**；只有显式「确认合并完成」（`confirm`）才回填 `merge_sha`。
补丁默认不落盘，仅在用户选择「写入 worktree」时写到 `unit_repos.worktree_path`。