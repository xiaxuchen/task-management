# 设计 · agent 测试运行

## 设计要点

- 表 `agent_runs`（node_id / agent / model / prompt / cwd / status / output / exit_code / started_at / finished_at / created_by）
- 执行器 `server/agent.mjs`：spawn qodercli `-p <prompt> -m <model> -w <cwd> --permission-mode bypass_permissions`；stdout/stderr 实时 append 落库（限 200KB）；超时 10 分钟 SIGKILL → timeout；close → success/failed（仅 running 时收尾，避免与超时重复写入）
- cwd 缺省自动推导：节点子树内 commits 关联仓库中第一个存在本地路径的（resolveRunCwd）；无 → VALIDATION_FAILED
- 服务启动时 `failStaleAgentRuns()` 清理残留 running（子进程随服务退出）
- 入口：`POST /api/nodes/:id/agent-runs` + `GET` 列表 + `GET /api/agent-runs/:id`；CLI `agent run/runs`；MCP `agent_run / agent_runs_list`
- 插件：TestRunnerDialog（提示词 + 运行 + 历史下拉 + 输出区，运行中 2s 轮询）

## Qoder IDE 前台模式（ideMode）

- `startAgentRun(..., { ideMode: true })`：**只创建运行记录**（agent=`qoder-ide`、status=running），**不 spawn 进程**；cwd 允许为空（IDE 侧用项目根）
- 用途：测试运行/派单在 **Qoder IDE 前台会话**执行（用户可见可交互），而非后台无头
- 闭环：提示词内附 **run #id + 回写指令**；Agent 完成后经 MCP `agent_run_update`（id/status/output）回写运行记录 → 插件历史即时可见
- 入口：`POST /api/nodes/:id/agent-runs { prompt, ideMode: true }`；MCP `agent_run_get / agent_run_update`；
  插件 TestRunnerDialog「⚡ 在 Qoder IDE 运行（前台）」按钮（详见 `features/qoder-integration/`）

## 注意事项

- agent 以 bypass_permissions 执行（非交互、全放行），仅供本地可信场景；提示词由用户自写自担
