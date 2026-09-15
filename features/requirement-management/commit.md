# 提交记录：需求管理

- feat(requirement-management): 需求管理端到端垂直切片——新增专属列表/创建/状态流转能力（store + HTTP + CLI + MCP 1:1），创建需求时自动关联「需求内容 / 概要设计」两份文档，列表返回文档关联状态、就绪结论与 KPI；需求状态机在 store 强制，通用 node.update 不能绕过；新增 RequirementsView 页签与 DocPane 文档抽屉；补 store/HTTP/CLI/MCP 回归
