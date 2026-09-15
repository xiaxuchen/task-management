# 验收签收 commit 记录

- feat(acceptance-signoff): 验收签收闭环——新增 acceptance_signoffs 表与 acceptance_status / acceptance_sign 三入口；签收绑定验收证据 sha256 指纹，测试证据或用例期望变化自动 stale；交付门禁要求测试全过且签收 accepted，pending/rejected/stale 均阻塞；NodeDrawer 交付页签支持通过/驳回与指纹展示；补 store/HTTP/CLI/MCP UT 与快照导入导出支持
