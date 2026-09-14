# agent 运行时管理（对齐 multica）

## 需求

参考 [multica](https://github.com/multica-ai/multica) 的 agent 运行时管理能力，把 task-board 现有的
「扁平 agent 运行记录」升级成可管理、可续跑、可观测的运行时体系：

1. **运行时（Runtime）**：机器级执行环境。一台机器上一个 CLI 实例一行（`daemon_id + provider` 唯一），
   带 `online/offline` 心跳、`device_info`、可见性（private/public）。服务启动自动注册本机 qodercli。
2. **会话（Session）**：节点上一个 agent 的连续对话。任务结束后把 CLI 会话号与工作目录沉淀下来，
   下次派单可 `--resume` 续跑同一段对话；支持显式新建 / 归档。
3. **任务（Run/Task）**：一次执行。带 `attempt` / `parent_run_id` 重试链、`failure_reason` 失败分类、
   `cancel` / `retry`，以及按 `seq` 递增的**消息流**（事件流）。
4. **三入口 1:1**：REST / CLI / MCP 三个入口能力一致。
5. **插件 UI**：IDEA 插件「Agent 控制台」——运行时状态条 + 会话选择（可续跑）+ 提示词 + 任务列表
   （状态胶囊）+ 消息流，并能取消 / 重试。

## 验收标准

- 派单缺省自动注册本机运行时（同 daemon+provider 幂等，不重复建行）并复用该节点活动会话
- 任务结束后 `cliSessionId` / `workDir` 写回会话；`resume` 派单会带上 `--resume`
- 任务消息流按 `seq` 严格递增，`sinceSeq` 能增量拉取
- 取消未完成任务会置 `cancelled` 并终止本地子进程；重试生成 `attempt+1` 且 `parentRunId` 指向原任务
- 有未完成任务时删除运行时被拒；删除后历史任务解绑保留
- 服务重启把残留 `running` 任务置 `failed(runtime_recovery)`，并把在线运行时收敛为离线
