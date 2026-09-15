# 提交记录：代码检查

- feat(code-audit): 代码检查——已登记提交新增行的只读静态审查（冲突标记 / 私钥 / 硬编码凭据 / eval / 聚焦测试 / 调试遗留），只扫 diff 新增行不误算历史遗留；两级严重度（danger 阻塞 ready；warn 仅提示）；`ready=null` 覆盖「无提交 / 无新增行 / 有提交读不到 / 扫描截断」四种空态；凭据证据先脱敏再截断，任何输出不回显原值；单条提交读取失败不拖垮整体；三入口 1:1（HTTP /api/nodes/:id/code-audit、CLI code audit、MCP code_audit）+ renderCodeAuditMd + NodeDrawer「代码检查」页签；纯读不落表不动 revision；补 36 条 UT（规则边界 / 行号口径 / 脱敏先于截断 / 三态优先级 / 真实 CLI 与 MCP 协议 / markdown 转义）
