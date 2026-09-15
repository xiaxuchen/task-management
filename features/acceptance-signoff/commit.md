# 验收签收 commit 记录

- feat(acceptance-signoff): 验收签收闭环——新增 acceptance_signoffs 表与 acceptance_status / acceptance_sign 三入口；签收绑定验收证据 sha256 指纹，测试证据或用例期望变化自动 stale；交付门禁要求测试全过且签收 accepted，pending/rejected/stale 均阻塞；NodeDrawer 交付页签支持通过/驳回与指纹展示；补 store/HTTP/CLI/MCP UT 与快照导入导出支持
- fix(acceptance-signoff): 收口独立测试 D1/D2——指纹改为按稳定 caseId 排序的 canonical 集合，纳入 prompt 与 latestReportId，latestAt/sort 等展示或排序字段不再参与指纹；补 prompt 变化必须 stale 且阻塞、仅 reorder 不得 stale 的 store/HTTP 回归
