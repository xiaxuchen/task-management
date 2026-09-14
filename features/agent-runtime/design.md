# 设计 · agent 运行时管理

## 参考来源（multica）

| multica | task-board | 说明 |
|---|---|---|
| `agent_runtime` 表 | `agent_runtimes` | daemon_id + provider 唯一；status online/offline；metadata jsonb → TEXT |
| `chat_session` 表 | `agent_sessions` | `session_id` → `cli_session_id`（qodercli `--resume` 用）；带 run_count / last_activity_at |
| `agent_task_queue` 表 | `agent_runs` | attempt / max_attempts / parent_task_id → parent_run_id；failure_reason 分类 |
| `task_message` 表 | `agent_run_messages` | `seq` 服务端自增 + `UNIQUE(run_id, seq)`；type/tool/content/input/output |
| 运行时心跳 + sweeper 降级 | 读时收敛 | 无后台任务：`listRuntimes` 把超 90s 未心跳的 online 行降级为 offline |
| `runtime went offline` / `runtime_recovery` | `failure_reason` | 分类口径对齐：`runtime_recovery` / `timeout` / `agent_error.*` / `manual` |
| UI `task-status-pill` | 插件状态胶囊 | queued/dispatched/running/… → 运行中/成功/失败/超时/已取消 |

## 设计要点

- **三层模型**：`agent_runtimes` → `agent_sessions` → `agent_runs`（+ `agent_run_messages`）。
  旧版只有一张扁平 `agent_runs`，无法回答「哪台机器 / 哪个 CLI 实例」「能不能续跑」「多次派单是否同一段对话」。
- **迁移**：`server/db.mjs` 的 `migrate()` 对老库幂等补表补列（`agent_runs` 补
  session_id / runtime_id / attempt / max_attempts / parent_run_id / failure_reason / cli_session_id /
  work_dir / priority / resumed / wait_reason），旧数据自动兼容（新列为 NULL / 默认值）。
- **服务自身即 daemon**：`localDaemonId()` = 主机名，`ensureLocalRuntime()` 在服务启动与每次派单时
  upsert 本机运行时（幂等，不重复建行）；心跳由 `heartbeatRuntime` 刷新。
- **续跑**：任务结束 `finishAgentRun` 把 `cliSessionId` / `workDir` 沉淀到会话；
  下次 `startAgentRun({resume:true})` 取出会话里的 `cliSessionId`，qodercli 参数追加 `--resume <id>`。
- **重试链**：`retryAgentRun` 复制原任务为 `attempt+1` 的子任务，`parent_run_id` 回指原任务，
  挂同一会话——不新建对话。
- **消息流**：`appendChunk` 把子进程输出按行切成 `text` 消息落库（同时仍写 `output` 整块，兼容旧读取）；
  `seq` 由服务端在插入前 `MAX(seq)+1` 生成，UI 用 `sinceSeq` 增量拉取。
- **取消**：`cancelAgentRun` 置 `cancelled`；后台执行的 `startAgentRun` 有 2s cancel-watch，
  检测到 `cancelled` 就 `SIGKILL` 子进程（对标 multica 用 cancelled 让 daemon 优雅中断）。
- **删除运行时**：有未完成任务 → `VALIDATION_FAILED`（对标 multica 的 runtime_delete_not_drained）；
  历史任务 / 会话解绑（`runtime_id = NULL`）后删除运行时，历史不丢。

## 入口

- REST：见 `docs/design/04-api.md` 的「agent 运行时 / 会话 / 任务」
- CLI：`runtime list|register|heartbeat|status|remove`、`agent session list|new|get|archive`、
  `agent run|runs`、`agent run get|messages|cancel|retry|update`
- MCP：`runtime_*`、`agent_session_*`、`agent_run*`（清单见 `schema` 返回）

## 插件 UI（IDEA）

- 组件：`AgentConsoleDialog`（Review 顶栏「Agent」按钮打开，替代原 TestRunnerDialog）
- 运行时状态条（在线数 + 健康图标）；会话下拉（标注「可续跑」/「已归档」）+「新会话」+「续跑会话」勾选
- 任务下拉（状态胶囊 + `attempt` + 续跑标记）→ 消息流区；「取消任务 / 重试」按钮按状态启用
- 运行中任务 2s 轮询：先刷新任务状态，再按 `sinceSeq` 增量追加消息（不再整块重读 output）

## 注意事项

- 心跳降级是「读时收敛」，没有后台 sweeper：没人读列表时 online 行可能短暂保留旧状态，
  对本地单机场景无影响。
- `agent_run_messages` 的 `seq` 由「读 MAX + 写」两步生成，但整段包在 `BEGIN IMMEDIATE` 事务里，
  并对 SQLite busy 做有限重试：多进程（如 CLI / MCP 同时回写同一条任务）并发追加也不会撞号，
  由 `test/agent.test.mjs` 的「多进程并发追加消息」用例覆盖（4 进程 × 25 条 → seq 连续无重复）。
- qodercli 的 `--resume` 语义依赖 CLI 自身实现；拿不到会话号时（如 `echo` 之类）续跑退化为普通派单。
