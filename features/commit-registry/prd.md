# 功能：commit 手工登记

## 所属计划

计划 1（建表）· 计划 2（入口）。

## 需求

- 节点（group / task / defect）可手工登记关联提交
- 登记字段：repo（可选）、sha（7-40 位十六进制）、note（可选）
- 同节点同 sha 重复登记幂等
- sha 不合法返回 400
- repo 必须已登记（先 repo add）
- 支持按子树聚合查询

## 验收标准

- `POST /api/nodes/:id/commits { repo, sha, note }` 返回登记的 commit
- 重复 sha 返回已有记录（`created: false`）
- sha 非 7-40 位十六进制返回 400
- `GET /api/nodes/:id/commits?subtree=true` 返回子树聚合