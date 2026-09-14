# 提交记录（workflow-map）

- feat(workflow-map): 研发主线思维导图——新增只读聚合 `buildWorkflowMap`，把节点树 / 需求与概要设计门禁 / 文档 / AI 可回归用例 / 测试报告 / 验收报告 / 上线配置与 SQL / 上线、代码、业务检查投影成 `root → stage → branch` 图；四态 `pass/fail/pending/empty`，空态不伪装成通过；`scope=subtree` 覆盖需求两层；三入口 1:1（HTTP `/api/nodes/:id/workflow-map`、CLI `workflow map`、MCP `workflow_map`）+ `renderWorkflowMapMd` + NodeDrawer「主线」页签 SVG 可视化；纯读、不落表、不动 revision
