# 需求 · Qoder 联动（task-board ⇄ Qoder IDE / CLI）

## 背景与目标

task-board 是任务/需求管理的"事实源"，Qoder 是日常编码的 AI Agent。
目标：**任务上下文自动流向 Qoder，Qoder 的产出自动回写任务**——把"查任务 → 贴上下文 → 干活 → 登记"的人工链路压缩到最低。

## 场景

1. **提问带上下文**：在 Qoder 里问"3.1.1 这个任务…" / "当前 review 的变更…"——自动带入
   任务层级路径、需求/概设摘要、PRD 链接、已登记提交、当前 review（节点 + 勾选提交 + 变更文件）
2. **选中代码零操作**：在 diff/编辑器里选中代码后直接在 Qoder 提问（"这段代码…"）——自动带入选中内容（**无需任何按钮/复制粘贴**）
3. **派单在 Qoder IDE 前台执行**：从 task-board 网页/插件生成任务提示词 → 打开 Qoder 面板新会话 → 粘贴 + 回车即开工；
   完成后 Agent 通过 MCP 回写运行记录（**run id 绑定**）
4. **Qoder 反向读写任务**：挂载 task-board MCP 后，Qoder 里可直接查任务树/节点/文档、登记提交、改状态、读写测试运行

## 边界（明确不做 / 平台做不到）

- Qoder 插件**无对外"程序化发送消息"的契约 API**（sendRequest 由 UI 组件经 DataKey 注入）——
  最后一步"粘贴 + 回车"保留人工（1 秒动作），其余全自动
- Qoder 的"选区引用"仅对**真实编辑器**生效（diff 视图不识别）——用"全局选区自动捕获"绕开
- Stop 事件暂只记录日志（"干完活自动登记提交"留待扩展）

## 验收

- Qoder 提问带任务编号 → 回答中出现任务文档/PRD 细节（模型未读文件，信息来自注入）
- diff 里选中代码 → Qoder 问"这段代码" → 上下文含选中内容
- 测试运行选"Qoder IDE 前台" → run#id 建记录 → Agent 完成后 `agent_run_update` 回写 → 插件历史可见结果
- `qodercli mcp list` 显示 task-board（stdio, Connected）
