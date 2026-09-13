# task-board ⇄ Qoder 联动（Hook 桥 + MCP）

让 Qoder（IDE 插件 / CLI）自动感知你正在进行的 task-board 任务。

## 一、Hook 桥（任务上下文自动注入）

**效果**：在 Qoder 里提问时只要带上任务编号（如 `3.1.1`）或关键词（`XPD-1141544` 等），
自动把该任务的 **层级路径 / 需求与设计摘要 / PRD 链接 / 已登记提交** 注入上下文。

**实测评效**（qodercli 实测）：

> 问：「3.1.1 这个任务是做什么的？」
> 答：「3.1.1 是在建站加盟类型的立项流程中新增"是否为内部/门店采购"字段（必填、下拉单选、默认"否"…）」
> —— 回答信息全部来自自动注入的任务上下文（模型未读任何文件）

**配置**（`~/.qoder/settings.json`，已配置，备份见同目录 `.bak-*`）：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
        "command": "bash /Users/xuchen.xia/charge2/task-board/hooks/qoder-bridge.sh", "timeout": 15 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "bash /Users/xuchen.xia/charge2/task-board/hooks/qoder-bridge.sh", "timeout": 15 } ] }
    ]
  }
}
```

- 规范：Claude Code 兼容（`qodercli hooks migrate` 可确认）；输出走
  `hookSpecificOutput.additionalContext`。
- `qoder-bridge.sh` 为 node 路径兜底包装（IDE 的 hook 环境 PATH 可能不含 nvm）。
- 日志：`/tmp/taskboard-qoder-bridge.log`（每次调用一行，排查用）。
- 匹配逻辑：提示词提取编号（`\d+\.\d+` 等）→ 查 nodes 模糊匹配 → 命中 1~2 个节点即注入；
  无命中静默（不打扰）。显式提 `task-board`/`任务板` 时还会取引号内文字做关键词。

## 二、MCP（Qoder 直接读写任务）

已注册（user 级，所有项目可用）：

```bash
qodercli mcp add task-board -s user node /Users/xuchen.xia/charge2/task-board/server/mcp.mjs
# 验证：qodercli mcp list / qodercli mcp get task-board（Status: Connected）
```

之后在 Qoder 里可以直接让它：查任务树 / 节点详情 / 文档 / 登记提交 / 改状态等（MCP 工具集）。

## 四、提及与当前 review 上下文（v2）

- **@ 提及 / 引号名**：`@3.1.1 详细说明`、「建站加盟立项」——显式提及会注入更长的文档摘要（1200 字 vs 500 字）。
- **当前 review 上下文**：IDEA TaskBoard 插件在**进节点 / 勾选提交 / 加载合并变更**时，会把
  「当前节点 + 勾选提交 + 变更文件」写到 `~/.taskboard/current-review.json`；在 Qoder 里说
  **「当前 review 的变更」「这次变更」「@review」** 等触发词即自动注入；若提问里的任务编号
  正好是插件当前节点（同源），也会自动附带。
- **手动路径**：插件顶栏「**复制上下文**」按钮——一键复制（节点/勾选提交/变更文件）markdown，
  直接粘贴到 Qoder 即可。

## 三、注意

- IDE 插件侧的 Qoder 会话需在 **重启 IDE / 重开 Qoder 会话** 后加载新配置。
- Stop 事件当前仅记录日志；如需"干完活自动回写 task-board"（登记提交 / 状态流转），
  可在此脚本上扩展（数据来源：transcript 或 git 状态）。
