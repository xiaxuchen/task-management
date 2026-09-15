# 功能设计：上线 SQL 风险审查

## 1. 模块职责

- `server/config.mjs`：新增 `releaseSqlAudit` 配置块（规则与严重度可覆盖），随 `config.json` 生效。
- `server/store.mjs`：唯一读写核心，新增 `buildReleaseSqlAudit(nodeId, { scope })`——
  选 `kind=sql` 上线项 → 逐条做规则匹配 → 汇总顶层结论。**纯读，不 bump revision**。
- `server/ops.mjs`：`renderReleaseSqlAuditMd(audit)` 渲染 markdown；并把 `release_sql_audit` 登记进 `TOOLS`。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露（只做参数装配 + 错误映射）。

## 2. 关键规则

**R1 为什么审查已有 `release_items` 而不是新表**：上线 SQL 本来就以 `kind=sql` 的上线项登记
（名称 + 内容 + 回滚 + 状态）。审查是**从这份内容推导出的结论**，不是新的业务数据；
落表会产生第二份真相，还要处理「内容改了结论要不要失效」。因此与 `acceptance_report` /
`readiness` / `release_checklist` / 推送门禁同一条「只读聚合」原则（决策 25 / 29 / 36）。

**R2 为什么两级严重度**：把「不可逆破坏」和「风险写法 / 缺回滚」混为一谈会失去可执行性——
前者必须拦住上线，后者只该提示补全。因此 `danger` 才进 `blockers` 并让 `ready=false`；
`warn` 单列 `warnings`，不改变 `ready`。这与推送门禁「`not_pushed` 与 `unknown` 都阻塞、
但用不同 reason 区分修复动作」是同一种分级纪律。

**R3 无 `WHERE` 判定必须看语句边界，不能全表 `includes('where')`**：一条 SQL 里常有多个语句，
`DELETE FROM t;` 与 `UPDATE a SET x=1 WHERE id=1` 混在同一段时，全表搜 `where` 会把无条件的
`DELETE` 误判成安全。实现按 `;` 切分逐条语句，再在**单条语句内**判断有没有 `WHERE`。

**R4 注释不能误伤**：`-- DROP TABLE foo`（行注释）与 `/* DROP TABLE */`（块注释）
不应命中。实现先剥离这两类注释，再按语句匹配规则关键字。

**R5 `ready=null` 空态**：范围内没有 `kind=sql` 上线项时返回 `null`，
与验收报告 `passRate=null`、上线清单「无必做项 `ready=null`」、就绪门禁「无待判定需求」同口径：
**不知道 ≠ 没通过**。调用方拿到 `null` 应提示「没有可审查的 SQL」，而不是展示红灯。

**R6 只读语义**：门禁不修改任何数据，因此**不产生 revision**——AI 可以高频轮询做看板，
而不该因此制造变更噪声（否则前端 `/api/revision` 轮询会被自己触发）。

**R7 `scope` / `format` 单点校验**：入口把原始值透传给 `store.normalizeScope` /
`store.normalizeFormat`，不得先做 `scope === 'subtree' ? … : 'self'`——
否则非法值到不了校验点，会把「子树有高危 SQL」翻成 `ready=true`（放行门禁假绿，见决策 31 / 35）。

## 3. 规则集（首版）

| 规则 key | 严重度 | 命中条件 | 建议 |
|---|---|---|---|
| `drop_table` | danger | 语句含 `DROP TABLE` / `DROP DATABASE` | 确认备份与不可逆影响，或改为可回滚迁移 |
| `truncate` | danger | 语句含 `TRUNCATE` | 确认数据可丢弃，否则改用带条件的 `DELETE` |
| `delete_without_where` | danger | `DELETE FROM` 语句内无 `WHERE` | 补 `WHERE` 限定范围 |
| `update_without_where` | danger | `UPDATE` 语句内无 `WHERE` | 补 `WHERE` 限定范围 |
| `drop_column` | warn | `ALTER TABLE ... DROP COLUMN` | 先确认无代码引用、评估回滚 |
| `sql_no_rollback` | warn | 上线项 `rollback` 为空 | 补回滚脚本 |

规则集放在 `config.releaseSqlAudit`，团队可按需增减；默认值见 `server/config.mjs`。

## 4. 踩坑 / 约束

- `buildReleaseSqlAudit` 选的是**本节点**上线项；`scope=subtree` 要沿 `subtreeIds` 聚合，
  与 `buildReleaseChecklist` 的 scope 口径保持一致。
- 上线项内容可能为空（只登记了名称）——空内容不命中 danger 规则，但会因缺回滚而记 `warn`。
- markdown 渲染必须转义表格单元格里的 `|` 与换行（SQL 内容常见 `|` 与多行），
  否则会多分列或截断表格（与 `renderDeliveryGateMd.cell()` 同款处理）。
- 大小写不敏感：`drop table` / `DROP TABLE` 都要命中，匹配前统一转小写。

## 5. 关联章节

- 数据模型：`docs/design/02-data-model.md` §4.15（release_items）
- 接口表：`docs/design/04-api.md`「上线 SQL 风险审查」段
- 接口示例：`docs/api.md`
- 测试策略：`docs/design/08-testing.md`（单测分组：`test/release-sql-audit.test.mjs`）
- 决策：`docs/design/09-decisions.md` 决策 39（只读聚合）/ 40（危险 SQL 分级阻塞）
- 相邻功能：`../release-governance/`（上线项登记与检查清单）、`../delivery-gate/`（交付结论）
