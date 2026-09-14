# 功能设计：研发主线思维导图

## 1. 模块职责

- `server/store.mjs`：`buildWorkflowMap(nodeId, { scope })` 只读聚合，复用现有节点、文档、用例、报告、验收与上线项读写函数。
- `server/ops.mjs`：`renderWorkflowMapMd(map)` 输出可贴进 issue / 评审记录的 markdown。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露。
- `web/src/components/WorkflowMapPane.vue`：SVG 可视化与证据查看。

## 2. 图模型

```text
root（当前范围）
├── stage:requirement         需求管理
│   ├── branch:requirement:<unit>  <需求名称>（四态）
│   └── ...
├── stage:design              概要设计
├── stage:documents           文档管理
├── stage:mindmap             思维导图
├── stage:regression          AI 可回归测试
├── stage:test_report         测试报告
├── stage:acceptance          验收报告
├── stage:release_config      上线配置
├── stage:release_sql         上线 SQL
├── stage:release_check       上线检查
├── stage:code_check          代码检查
└── stage:biz_check           业务检查
```

`nodes` 同时包含 `root` / `stage` / `unit` / `branch`；`edges` 表示“范围 → 阶段 → 分支”与“需求单元 → 分支证据”的连线。

## 3. 关键规则

**R1 只读投影**：图不是业务数据，不落表、不 bump revision。这样 AI 可以高频读取它做看板，而不会自己制造 revision 噪声。

**R2 四态语义**：

| 状态 | 含义 |
|---|---|
| `pass` | 已有证据且通过 |
| `fail` | 有数据但未通过 / 有必做项未完成 |
| `pending` | 执行中或等待结论 |
| `empty` | 尚未登记；**不得解释为通过** |

**R3 阶段状态聚合**：同阶段下多个需求分支用最严重状态收敛，优先级 `fail > pending > pass > empty`；根节点再按所有阶段收敛。这样项目视图不会因部分需求通过而掩盖另一条需求的阻塞。

**R4 复用既有口径**：

- 需求 / 概要设计：`buildRequirementReadiness` 的同名检查，避免文档“存在但空白”被算通过。
- 文档：统计文档数与正文非空数量。
- AI 可回归测试：启用中的 `regression` / `acceptance` 用例。
- 测试报告：`listTestReports`，`running` 映射为 `pending`，其它非 `pass` 终态映射为 `fail`。
- 验收报告：`buildAcceptanceReport.totals`，`running` / `notRun` 视为未取得交付证据。
- 上线配置 / SQL / 检查：`listReleaseItems` 按 `kind` 分组，必做未完成或阻塞为 `fail`。
- 代码 / 业务 / 上线检查：各自的 `test_cases.kind` + 最新报告状态。

**R5 非需求节点仍可打开**：`scope=self` 挂在项目 / 任务组上时，用节点自身作为锚点生成一条分支，避免页面空转；要看整棵需求子树时切到 `scope=subtree`。

**R6 scope 校验**：直接复用 `store.normalizeScope`，非法值返回 `VALIDATION_FAILED`，不静默降级。

## 4. 对外接口

```js
buildWorkflowMap(nodeId, { scope }) // → { node, scope, status, totals, stages, units, nodes, edges }
renderWorkflowMapMd(map)            // → markdown
```

HTTP：`GET /api/nodes/:id/workflow-map?scope=self|subtree&format=json|md`

CLI：`node bin/taskboard.js workflow map <ref> [--scope ...] [--format json|md]`

MCP：`workflow_map({ node, scope?, format? })`

## 5. UI 交互

- 顶部切换 `self` / `subtree` 与刷新；
- 画布横向按阶段排列，纵向按需求单元 / 各阶段证据分支排列；
- 节点颜色对应四态；
- 点击节点在右侧查看依据；文档分支列出文档填写状态，用例分支显示关联用例数与最近报告；
- 点击需求单元可打开对应节点抽屉。

## 6. 踩坑 / 约束

- **验收口径会纳入所有用例**：图中若新增一条尚未执行的 `code_check`，验收阶段会因 `notRun` 变为 `fail`。这是既有验收口径的正确反映，不是图把代码检查混进验收。
- **需求分支与证据分支是两个维度**：`unit` 节点表示需求单元，`branch` 节点表示该需求在某阶段的证据；连线保留两种关系，避免前端只能做成一棵树。
- **空态不等于通过**：`empty` 单独一色并计入 totals，避免“尚未登记”被误读成完成。
