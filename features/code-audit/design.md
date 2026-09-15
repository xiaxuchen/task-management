# 功能设计：代码检查（已登记提交新增行的只读静态审查）

## 1. 模块职责

- `server/code-audit.mjs`：**纯函数**规则引擎（不碰 db / git / 网络）。
  - `CODE_AUDIT_RULES` / `CODE_AUDIT_RULE_MAP`：稳定规则集（key / severity / title / suggestion / test / mask）。
  - `auditAddedLines(entries)`：一批新增行 → 命中项列表。
  - `summarizeCodeAudit({ node, scope, items, truncated })`：命中项 + 读取错误 → 顶层结论。
  - `isCodeFile` / `isTestFile`：扩展名与测试路径判定。
- `server/git.mjs`：新增 `commitAddedLines(dir, sha)`——解析 `git show --unified=0 --no-color` 的 patch 体，
  产出 `[{ path, line, text }]`（仅新增行，`line` 为新文件侧行号）。
- `server/ops.mjs`：`getNodeCodeAudit(store, nodeRef, { scope })` 做编排（选提交 → 逐条读新增行 → 扫描 → 汇总）、
  `renderCodeAuditMd(audit)` 渲染 markdown、把 `code_audit` 登记进 `TOOLS`。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露（只做参数装配 + 错误映射）。
- `web/src/components/NodeDrawer.vue`：节点抽屉「代码检查」页签（self / subtree 切换 + 命中表）。

## 2. 关键规则

**R1 为什么扫「新增行」而不是全文件**：代码检查的目标是「本次交付有没有引入风险」。
扫全文件会把仓库里的历史遗留问题（老代码里的 `console.log`、早已存在的 TODO）一次性算到当前提交头上，
结论既不可行动也无法收敛。`commitAddedLines` 只取 diff 的 `+` 行，责任边界与 reviewer 看 diff 的边界一致。

**R2 为什么用 `--unified=0` 而不是 `--unified=3`**：默认 3 行上下文会把**未改动**的行也输出为 ` `（空格前缀）行，
一旦把它们误当新增行，就会把历史问题算进来（正是 R1 要避免的）。`--unified=0` 的 hunk 头
`@@ -a,b +c,d @@` 里 `c` 直接就是下一条新增行的新文件行号，解析无需额外推算；
`--no-color` 保证不会把 ANSI 色码带进匹配文本；`--no-renames` 与 `commitDiff` 一致，避免改名被拆成删除 + 新增。

**R3 两级严重度的划分依据**：不可逆或会**静默吞掉验证**的风险才阻塞——
私钥、硬编码凭据（泄露不可撤回）、未解决的冲突标记（代码可能根本不对）、
`eval` / `new Function`（任意代码执行面）、`.only` / `fit` / `fdescribe`（其余用例被静默跳过，直接伪造绿灯）。
遗留调试输出、待办标记这类只提示，不让「有一条 `console.log`」把交付结论拦成红灯。
与「不可逆 / 会静默吞掉验证的风险才阻塞」这条既有分级纪律一致（见上线治理的上线检查口径）。

**R4 脱敏必须发生在截断之前**：`auditAddedLines` 先对命中行应用 `rule.mask`，再 `clipSnippet` 截断到 200 字符。
顺序反了会让被截断的超长凭据以明文残留在片段里——安全扫描变成第二条泄露通道。
`maskSecret` 只保留前 2 个字符 + 长度，绝不回显原值（`test/code-audit-rules.test.mjs` 有专门用例）。

**R5 `ready=null` 的三个来源**：没有提交 / 没有新增行 / 有提交读不到 / 扫描被截断，四者都返回 `null`：
**看不到 ≠ 没问题**。与验收报告 `passRate=null`、上线清单「无必做项 `ready=null`」、就绪门禁「无待判定需求 `ready=null`」同口径。
`ready=false` 仅在**确定**命中 danger 时给出，不把「信息不足」和「检查不通过」混为一谈。

**R6 单条失败不拖垮整体**：repo 未登记 / 路径无效 / sha 不存在 → 记进 `item.error`，其余提交照常扫描。
这样 AI 与人都能看到「哪几条读不到」，而不是整棵树一起报错。

**R7 只读语义**：门禁不修改任何数据，**不产生 revision**——AI 可高频轮询做看板而不制造变更噪声
（否则前端 `/api/revision` 轮询会被自己触发）。与 `acceptance_report` / `readiness` / `release_checklist` 一致。

**R8 `scope` / `format` 单点校验**：入口把原始值透传给 `store.normalizeScope` / `store.normalizeFormat`，
不得先做 `scope === 'subtree' ? … : 'self'`——否则非法值到不了校验点，
「子树里有未扫描的高危提交」会被翻成 `ready=true`（放行门禁假绿，见决策 31 / 35）。

**R9 提交数上限**：`CODE_AUDIT_MAX_COMMITS = 200`。每次读新增行要起一个 git 子进程，子树很大时限制住开销；
更重要的是没扫完就报「通过」是假绿灯，因此截断时 `totals.truncated=true` 且结论降级为 `ready=null`。

**R10 markdown 单元格转义**：表格必须先转义反斜杠再转义竖线，否则含 `|` 或结尾 `\` 的代码片段会把表格切歪
（与 `renderDeliveryGateMd.cell()` 同一坑，独立测试曾实测）。

## 3. 规则集（首版）

| 规则 key | 严重度 | 命中条件 | 建议 |
|---|---|---|---|
| `merge_conflict_marker` | danger | 行首为 `<<<<<<<` / `\|\|\|\|\|\|\|\|` / `>>>>>>>` | 解决冲突并移除标记后再提交 |
| `private_key_block` | danger | 含 `-----BEGIN … PRIVATE KEY-----` | 从历史移除并轮换密钥 |
| `hardcoded_secret` | danger | `key = '长值'` 形式的密码 / token / api key（排除占位值与环境变量） | 改用环境变量 / 密钥服务并轮换 |
| `eval_usage` | danger | `eval(` / `new Function(`（注释行除外） | 改用显式分支或解析库 |
| `focused_test` | danger | 测试文件里的 `.only(` / `fit(` / `fdescribe(` | 移除聚焦，避免其余用例被跳过 |
| `debugger_statement` | warn | `debugger` 语句 | 移除调试断点 |
| `console_log` | warn | 非测试代码文件里的 `console.log(` | 改用统一日志或移除 |
| `lint_suppression` | warn | `eslint-disable` / `@ts-ignore` / `nolint` / `noqa` | 说明原因或修复根因 |
| `todo_marker` | warn | `TODO` / `FIXME` / `HACK` / `XXX` | 登记为待办或缺陷 |

## 4. 踩坑 / 约束

- 解析 patch 时 `+++` 是文件头而不是新增行：必须先于 `+` 分支消费，否则每个文件的第一行行号会错位。
  `+++ /dev/null` 表示删除文件，该文件段没有新增行可扫，直接置 `curPath=null`。
- `\ No newline at end of file` 以 `\` 开头，既不推进行号也不产出条目。
- 硬编码凭据正则**不锚定行首**：真实写法常带声明关键字或类型（`const password = '…'`、`String apiKey = "…"`）。
  用命名捕获组取「键 / 引号 / 值」，掩码时按 `groups.value` 替换，避免同一行多个相似子串被整体替换。
  值至少 8 字符且不含空白，`password === x` 这类比较不会命中（`=` 后还有 `=`，值里含空白）。
- 同名节点路径引用会 409 `PATH_AMBIGUOUS`——用 id 或唯一路径。
- 只读接口**不要**顺手缓存结论：源提交或仓库路径变了，结论必须立刻跟着变。

## 5. 关联章节

- 接口表：`docs/design/04-api.md`「代码检查」段
- 接口示例：`docs/api.md`
- 测试策略：`docs/design/08-testing.md`（单测分组：`test/code-audit*.test.mjs`）
- 决策：`docs/design/09-decisions.md` 决策 36（代码检查只读、扫新增行、danger 才阻塞）
- 相邻功能：`../commit-registry/`（提交登记）、`../diff-preview/`（`commitDiff` / `commitStat`）、
  `../release-governance/`（`kind=code_check` 的 AI 检查用例）、`../delivery-gate/`（交付结论）
