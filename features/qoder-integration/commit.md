# 提交记录 · Qoder 联动

- feat(hooks): Qoder 联动桥——UserPromptSubmit 自动注入任务上下文（编号/关键词→节点路径+需求概设摘要+PRD+已登记提交），Stop 记日志；wrapper 兜底 node 路径；README 含配置与实测效果
- feat(qoder-bridge): v2——当前 review 上下文注入（插件写 ~/.taskboard/current-review.json + hook 触发词/同源附带）+ 显式@提及加长摘要；插件新增「复制上下文」按钮
- feat(qoder-ide): 测试/派单改 Qoder IDE 前台——ideMode 只建 run 记录；MCP 增 agent_run_get/update（Agent 回写）；插件 QoderOpener（面板+新会话+剪贴板）与 TestRunnerDialog「在 Qoder IDE 运行」；「派给 Qoder」去终端版
- feat(qoder-ctx): 「记入上下文」按钮——diff/编辑器选中代码一键存入上下文（~/.taskboard/selected-snippets.md + 剪贴板）；hook 触发词命中时自动注入
- feat(qoder-ctx): 零点击——全局选区监听自动捕获"最近选中"（防抖700ms、覆盖式）；hook 注入自动捕获+手动片段；移除「记入上下文」按钮
