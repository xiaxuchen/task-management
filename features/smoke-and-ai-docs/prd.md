# 功能：冒烟脚本与给 AI 的用法

## 所属计划

计划 5。

## 需求

- **`npm run smoke` 一条命令跑通全链路**：
  起服务 → 建五级树 → 建缺陷 → 改属性 + 写文档 → 上传图片 →
  建临时 git 仓库（含冲突场景）→ diff 预览 → 合并预检 → mock GitLab 刷新 MR →
  登记 commit → 断言树与详情
- **README 附「给 AI 的用法」**：工具清单 + 示例 + bootstrap prompt（设计文档 §5.1 明文要求）

## 验收标准

- `npm run smoke` 全绿，且**不污染**真实 `~/.taskboard`（用 `TASKBOARD_HOME` 指向临时目录）
- 文档中的工具清单与 `GET /api/schema` 返回的 `tools` **一致**（有校验手段）
- bootstrap prompt 能让一个空白 AI 会话直接开始操作本工具（无需人工再解释）

## 现状

| 子项 | 状态 |
|---|---|
| 给 AI 的用法 | ✅ 已由 `AGENTS.md` 承担（29 个工具 + CLI 命令 + 推荐工作流 + 关键约束 + 已知坑）|
| 接口示例 | ✅ 见 `docs/api.md` |
| `scripts/smoke.mjs` | ❌ 未实现（`package.json` 已有 `smoke` 脚本占位）|