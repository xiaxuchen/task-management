# 交付门禁 commit 记录

- feat(delivery-gate): 交付门禁（需求就绪 / 测试验收 / 上线治理的最终汇总）——新增只读聚合 `buildDeliveryGate`，把三段既有结论收敛为唯一“能否交付”判定；每个来源三态 `pass/fail/not_applicable`，最终 `ready/not_ready/unknown`（全不适用时 `ready=null`，不伪造成绿灯）；`acceptance` 的 `running`/`notRun` 也视为未取得交付证据；blockers 展平到条目级；三入口 1:1（HTTP `/api/nodes/:id/delivery-gate`、CLI `delivery gate`、MCP `delivery_gate`）+ `renderDeliveryGateMd` + NodeDrawer「交付」页签；纯读、不落表、不动 revision
- fix(delivery-gate): `scope` 收口为枚举校验（D2 连带修复）——`buildDeliveryGate` 改走 `store.normalizeScope`，非法值不再静默降级 `self`；同时其内部 `buildRequirementReadiness` 在「子树无需求」时返回空态而非抛错，交付门禁仍按 `not_applicable` 处理（不伪造成绿灯）
