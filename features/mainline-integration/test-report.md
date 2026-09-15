# 端到端验收报告：主链路集成收口（需求 → 交付门禁）

- 集成分支：`agent/xpx-126-mainline-integration`（基于 `origin/main` 3393f23）
- 回归脚本：`scripts/e2e-mainline.mjs`（公开 CLI / HTTP 入口，无内部直调断言）
- 守门测试：`test/e2e-mainline.test.mjs`
- 一键复现：`TASKBOARD_HOME=$(mktemp -d) npm run e2e:mainline`

## 1. 结论

**通过。** 主链路「需求管理 → 概要设计 → 文档 → 思维导图 → AI 可回归测试 → 测试报告 →
验收报告/签收 → 上线配置/SQL/检查 → 交付门禁」在公开入口上端到端可跑通；
交付门禁能正确区分「无证据（not_ready）」与「证据齐备（ready）」两态。

| 验证项 | 命令 | 结果 |
|---|---|---|
| 模块测试全量 | `npm test` | **327 条，0 失败** |
| 主链路端到端回归 | `npm run e2e:mainline` | **退出码 0，全链路通过** |
| 前端构建 | `npm run build` | 通过 |
| 三入口一致性 | e2e 脚本内 HTTP × CLI 抽查 | `readiness` / `mindmap` / `delivery-gate` 结论一致 |

## 2. 端到端实测输出（原样粘贴）

```
# 主链路端到端回归
# TASKBOARD_HOME=/var/folders/bz/2fp5s_dj43lbxxp6wkk0mb780000gn/T/tmp.qifPzH9Bvj

✓ 需求管理：requirement_create 建需求 #2，初始状态 todo
✓ 需求管理：受控状态流转 → doing
✓ 需求管理：非法状态被拒（VALIDATION_FAILED）
✓ 需求管理：核心文档槽位齐备 [需求内容, 概要设计]
✓ 文档：写入「需求内容」正文
✓ 概要设计：推导大纲（2 单元 / 5 节点）且含 mermaid 脑图
✓ 概要设计：写入「概要设计」文档（written=2）
✓ 概要设计：重复 apply 不覆盖已填内容（written=0）
✓ 思维导图：3 节点 / 2 连接 / 深度 2
✓ 思维导图：深度截断计数 + 非法 maxDepth 被拒
✓ AI 可回归测试：登记 regression / code_check / biz_check 三类用例
✓ AI 可回归测试：test run dry-run 命中 1 条 regression 用例且不派单
✓ 需求管理：需求就绪门禁通过（6 项门禁，通过 6）
✓ 测试报告：可读报告列表（0 条）
✓ 验收报告：passRate=null（4 条用例）
✓ 验收签收：accepted（证据指纹 318552c19299…）
✓ 验收签收：状态可查询（state=accepted）
✓ 上线治理：登记 config / sql 上线项
✓ 上线检查：必做项未完成 → ready=false（阻塞 2 项）
✓ 上线检查：必做项完成后 → ready=true
✓ 交付门禁：decision=not_ready，来源 需求就绪=pass / 测试验收=fail / 上线治理=pass
✓ 交付门禁：正确判定 not_ready——需求就绪 pass / 测试验收 fail（无证据）/ 上线治理 pass
✓ 交付门禁：可导出 markdown 交付记录
✓ 测试证据：为 4 条启用用例（regression / code_check / biz_check）开报告并回写 pass
✓ 验收签收：测试证据变化后原签收自动失效（state=stale）
✓ 验收签收：对最新证据重新签收 accepted
✓ 交付门禁：证据齐备后 decision=ready（来源 需求就绪=pass / 测试验收=pass / 上线治理=pass）
✓ 交付门禁：可导出「可交付」的 markdown 交付记录
✓ 三入口 1:1：HTTP 与 CLI 的 readiness / mindmap / delivery-gate 结论一致

# 全链路通过 ✅
```

## 3. 逐段证据

- **需求管理**：`requirement create` 建需求（初始 `todo`）→ `transition` 到 `doing`；
  非法状态被拒（`VALIDATION_FAILED`）；需求自动关联「需求内容」+「概要设计」两份核心文档。
- **概要设计**：`design outline` 从需求树推导出 2 单元 / 5 节点骨架且含 mermaid 脑图；
  `design apply` 写入 2 份「概要设计」；重复 apply 不覆盖已填内容（`written=0`）。
- **思维导图**：`mindmap` 输出 3 节点 / 2 连接 / 深度 2，满足 `edges = nodes - 1`；
  `--max-depth 1` 正确截断并计数；非法 `maxDepth` 被拒。
- **AI 可回归测试**：登记 `regression` / `code_check` / `biz_check` 三类用例；
  `test run --dry-run` 只回待跑用例、不派单、不落库。
- **需求就绪门禁**：需求内容 + 概要设计 + 可回归用例三条门禁齐备 → `ready=true`（6 项全过）。
- **测试/验收报告**：`test report list` 可读；`test acceptance` 给出 `passRate`；
  验收签收记录 `accepted` 并绑定证据指纹，可查询。
- **上线治理**：登记 `config` / `sql` 两条上线项；必做项未完成时上线清单 `ready=false`（2 项阻塞），
  完成后 `ready=true`。
- **交付门禁两态（关键）**：
  - 无测试证据 → `decision=not_ready`，来源 `需求就绪=pass / 测试验收=fail / 上线治理=pass`；
  - 为全部启用用例补 `pass` 结论并重新签收 → `decision=ready`（3/3 来源通过）。
  - 这证明门禁不是无脑绿灯，且「测试证据 + 签收」这一环确实在把关。
- **签收失效语义**：测试证据变化后原签收自动转为 `stale`，需对最新证据重新签收（符合设计）。

## 4. 集成冲突与处理（先修阻塞项再收口）

| 编号 | 冲突 | 处理 |
|---|---|---|
| C1 | `requirement` 预置文档 4 → 5（120 新增「概要设计」预置） | 按合并后拓扑更新级联删除计数并注释来源 |
| C2 | `applyDesignOutline` 由 `created:true`（新建）变为 `created:false`（upsert 预置文档） | 断言改为真实口径 |
| C3 | dryRun「不落库」原断言为文档不存在 | 改为断言预置文档内容仍为空（安全意图不变、更准确） |
| C4 | MCP 审计 actor：`createdBy=mcp` 不再成立（行由建节点时创建） | 改为断言 `updatedBy=mcp` 且版本历史存在 `reason=update, createdBy=mcp` 快照 |
| C5 | 决策编号撞号（36/37/39 多支重复） | 重排为唯一编号并同步文档引用 |
| C6 | CLI 单层 `mindmap` 与两层 `design outline` 共用 switch | 保留两条路径并 e2e 覆盖互不影响 |

详见 `design.md` §3。所有修法都带断言，不依赖手工确认。

## 5. 范围与未做项

- 本轮为**开发阶段集成**，未派发真实测试任务（PM 指示测试阶段后续单独派发）。
  因此 e2e 中的测试结论用「同一套核心能力开报告 + 公开 CLI 回写」模拟执行者收尾，
  路径与真实派单收尾一致。
- 未做的非阻塞项（按要求不混入本轮）：大树导图的渲染性能优化；
  其余分支（`xpx-123` 图片上传 / `xpx-124` 上线 SQL 审计 / `xpx-127` 敏感信息扫描 /
  `xpx-128` 代码检查 / `xpx-130` 业务检查）不在本轮范围。
