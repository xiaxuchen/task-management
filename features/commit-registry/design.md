# 功能设计：commit 手工登记

## 模块位置

server/store.mjs（554–597 行），对外通过 http/CLI/MCP 暴露。

## 数据结构

commits 表：id、node_id（FK → nodes, ON DELETE CASCADE）、repo、sha、note、created_at。

## 关键规则

- `UNIQUE(node_id, sha)` 保证幂等
- sha 正则 `/^[0-9a-f]{7,40}$/i`
- repo 存在性校验：引用 `repos.name`
- 子树查询：`WITH RECURSIVE` 聚合节点下所有 descendent 的 commit
## commit 审查（review，2026-09-13 新增）

- commits 表新增字段：`review_status`（pending / approved / issue，默认 pending）、`review_note`、`reviewed_by`、`reviewed_at`
- 入口：`PATCH /api/commits/:cid`（body: {reviewStatus, note?}）；CLI `commit review <cid> --review-status ... [--review-note ...]`；MCP `commit_review`
- 语义：pending 时清空审者信息；note 仅在显式传入时更新（保留历史意见）
- 消费方：IDEA 插件（提交表「审查」列 + 右键菜单：通过 / 有问题 / 重置；支持批量；节点汇总「待审/通过/有问题」计数 + "仅看待审"过滤）

## 多 commit 合并 diff（combined-diff，2026-09-13 新增）

- `POST /api/commits/combined-diff {cids}`（ops.getCombinedDiff）：按仓库分组、文件取并集
- 每文件净变更：`old` = 涉及它最早的 commit 的父版本；`new` = 最新的 commit 的版本（按提交时间升序）
- 文件统计（+/-）= 各 commit 该文件增删之和（概览近似值）
- 响应顶层 `commits` 明细（cid/sha/note/repo/author/authorEmail/date/branches）——来自轻量 `commitMeta`
  （`git show -s --format` + branchesContaining，不拉 patch），供 UI 信息区逐条展示
- 三入口：HTTP / CLI `commit combined-diff --ids` / MCP `commit_combined_diff`
