# 提交记录：需求就绪门禁

- feat(requirement-readiness): 需求就绪门禁——补上「需求管理」闭环缺失的**起点判定**：需求内容 / 概要设计 / 可回归用例三条门禁。buildRequirementReadiness 纯读聚合（不落表、不动 revision，与 acceptance_report 同一条「结论不落库」原则）；口径配置化 config.readiness（文档名 + 视为可回归的用例类型）；文档判定为「同名文档 + 正文非空白」（预置空文档不算通过）；判定单元限 requirement/subreq，scope=self|subtree，无待判定需求 ready=null；非需求节点 self 拒绝并提示 subtree；三入口 1:1（GET /api/nodes/:id/readiness · CLI readiness check · MCP requirement_readiness）+ renderReadinessMd；补 10 条单测 + 2 条 HTTP 集成 + 1 条 CLI 契约测试
