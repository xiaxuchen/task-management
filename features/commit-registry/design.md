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