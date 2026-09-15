# 提交记录

- feat(business-gate): 业务检查门禁——补上「业务可验收性」的独立只读判定：聚合节点（含可选子树）的未关闭缺陷（`defect` 且 status ∉ done/cancelled）与启用中的 `biz_check` 用例最近结论（只认 pass，`running`/`not_run` 都阻塞），三态 `ready`（无可判定对象时 `null`，不伪造成通过）；`blockers` 按 `open_defect` / `unpassed_case` 分型；纯读聚合不落表、不动 revision；三入口 1:1（HTTP `GET /api/nodes/:id/business-gate`、CLI `business gate`、MCP `business_gate`）+ `renderBusinessGateMd`（表格单元格转义）+ NodeDrawer「业务检查」页签；补 11 条 store UT + 4 条三入口 UT + 1 条 HTTP 全链路；文档同步（本目录 + docs/design 04/08/09 + docs/api + features/README）
