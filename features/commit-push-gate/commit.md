# 提交记录（commit-push-gate）

- feat(commit-push-gate): 代码推送门禁——判定已登记提交是否真的到了远程（`pushed`/`not_pushed`/`unknown` 三态，未登记仓库/无远程/sha 本地不存在归入 unknown 且阻塞但不冒充通过）；`server/git.mjs` 新增 `commitPushState`（先 `rev-parse` 兜 `sha-not-found`，再查 `refs/remotes/*`；只读不 fetch/不 push），`server/ops.mjs` 新增 `getNodePushGate`（按 repo+sha 去重回填来源节点、`scope=self|subtree`、空态 `ready=null`、纯读不 bump revision）+ `renderPushGateMd`（表格单元格转义）；三入口 1:1（HTTP `/api/nodes/:id/push-gate`、CLI `push gate`、MCP `commit_push_gate`）+ 随附 prd/design 文档与决策 36；补 15 条聚合/UT + 4 条三入口集成测试
- feat(commit-push-gate): 收口决策 36 预留的下一步——把推送判定并入 `delivery_gate` 成为第四个来源（决策 37），交付结论不再漏掉「登记提交没 push」；`ops.buildDeliveryGateFull` 复用 `getNodePushGate` 产出证据注入同步聚合，`not_pushed`/`unknown` 一律阻塞
