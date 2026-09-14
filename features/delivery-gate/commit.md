# 交付门禁 commit 记录

- feat(delivery-gate): 交付门禁（需求就绪 / 测试验收 / 上线治理的最终汇总）——新增只读聚合 `buildDeliveryGate`，把三段既有结论收敛为唯一“能否交付”判定；每个来源三态 `pass/fail/not_applicable`，最终 `ready/not_ready/unknown`（全不适用时 `ready=null`，不伪造成绿灯）；`acceptance` 的 `running`/`notRun` 也视为未取得交付证据；blockers 展平到条目级；三入口 1:1（HTTP `/api/nodes/:id/delivery-gate`、CLI `delivery gate`、MCP `delivery_gate`）+ `renderDeliveryGateMd` + NodeDrawer「交付」页签；纯读、不落表、不动 revision
