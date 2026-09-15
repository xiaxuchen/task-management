# 功能设计：代码推送门禁

## 1. 模块职责

- `server/git.mjs`：新增 `commitPushState(dir, sha)`——纯读的本机 git 判定，单条提交返回
  `pushed` / `not_pushed` / `unknown` + 依据 refs + reason。不 fetch、不 push。
- `server/ops.mjs`：新增跨 store 编排 `getNodePushGate(store, nodeRef, { scope })`
  （选提交 → 按 repo/sha 去重 → 逐条判定 → 汇总）与 `renderPushGateMd(gate)`；
  并把 `commit_push_gate` 登记进 `TOOLS`。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露（只做参数装配 + 错误映射）。

## 2. 关键规则

**R1 为什么是「只读聚合」而不是落表**：推送状态是**从本机 git 推导出的结论**，不是业务数据。
落库会产生第二份真相，还要处理「什么时候刷新」；而 git 的真实状态随时可能变。
因此与 `acceptance_report` / `readiness` / `delivery_gate` 同一条设计原则（见决策 25/29/33）：
纯读、不写库、不 bump revision。AI 可以高频轮询做看板而不制造变更噪声。

**R2 为什么判定单位是已登记的 commit，而不是「节点」**：TaskBoard 的提交关联本来就是
`commits` 表（一节点可挂多条、子树可聚合）。门禁直接复用这份数据，
按 `(repo, sha)` 去重——同一提交在多个节点登记（worktree 与需求分支都登了）只算一条，
与 `node_tracks` / `getNodeDiffs` 的去重口径一致，避免重复记账。

**R3 判定用 remote-tracking ref，不用网络**：

```
git rev-parse --verify <sha>^{commit}          # 本地能否解析出这个 commit
git for-each-ref --contains=<sha> refs/remotes/  # 哪些远程跟踪 ref 包含它
git remote                                     # 是否配置了远程
```

- 只要有一个 `refs/remotes/*` 包含该提交 → `pushed`（依据列出 ref 名，如 `origin/main`）。
- 本地解析得出、有远程、但没有任何 remote-tracking ref 包含它 → `not_pushed`。
- 其余（未登记仓库 / 路径无效 / 无远程 / 本地解析不出 / git 失败）→ `unknown`，
  并带 `reason`（`repo-not-registered` / `repo-path-missing` / `no-remote` / `sha-not-found` / `git-error`）。

`git for-each-ref --contains=<sha>` 对**无法解析的 sha 会以 exit 129 报错**（实测），
所以实现里必须先 `rev-parse` 确认本地存在该 commit，再查 ref；顺序反过来会把
「登记了一个本机不存在的 sha」误报成 `git-error`，丢掉 `sha-not-found` 这个关键区分。

**R3.1 短 sha 也要能判**：`commit_add` 允许登记 7–40 位短 sha（`SHA_RE`）。
`for-each-ref --contains` 接受短 sha，所以实现不做「补全 sha」的多余步骤，
直接用登记值判定即可（实测短 sha 与全 sha 结果一致）。

**R4 `unknown` 不等于「未推送」，但同样阻塞**：把 `unknown` 直接当 `pushed` 是假绿灯
（最危险的失败模式）；当 `not_pushed` 又会让人以为「push 一下就绿」，
而真实原因是「仓库压根没登记」。因此三态里 `unknown` 独立成一态，
在 `blockers` 里带 `reason` 说明该怎么修。顶层 `ready` 只要有任一非 `pushed` 就是 `false`。

**R5 为什么只读本地 ref、不自动 fetch**：自动 fetch 会引入网络请求、凭据与副作用，
而门禁可能被高频轮询。代价是「同事已 push 但本机没 fetch」会读成 `not_pushed`——
这是**保守**方向的误报（宁可说没推，不可说推了），提示里明确让人先 `git fetch`。
与 `branch-track` 的「ref-not-found → 先 fetch」同一条纪律。

**R6 为什么首版不并进 `delivery_gate`**：交付门禁的 `totals.sources` 现在恒为 3，
既有测试逐字段断言 `notApplicable: 3`。新增第 4 个来源会改变这个契约与所有 `deepEqual`，
属于独立的显式决策（要同时决定「未推送是否可以交付」）。首版先把能力做扎实、可单独调用，
并入交付门禁留给下一步。

**R7 空态 `ready=null`**：scope 内没有任何已登记提交时返回 `null`，
与验收报告 `passRate=null`、需求就绪 / 上线清单 / 交付门禁的 `ready=null` 保持同一条口径：
**不知道 ≠ 没通过**。调用方拿到 `null` 应提示「没有可判定的提交」，而不是展示红灯。

**R8 `scope` / `format` 复用单点校验**：入口把原始值透传给 `store.normalizeScope` /
`normalizeFormat`，**不得**在入口先做 `scope === 'subtree' ? … : 'self'`
（否则非法值到不了校验点，会把「子树有未推送提交」翻成 `ready=true`）。
MCP 用 `mcpValidate` 把业务错误转成 `isError` 文本，不泄漏 SDK `-32602`。

## 3. 踩坑 / 约束

- `for-each-ref --contains` 对坏 sha 报 exit 129；必须先用 `rev-parse` 兜 `sha-not-found`（见 R3）。
- `git for-each-ref` 在没有匹配 ref 时 **exit 0 且空输出**（不是报错）——空输出即 `not_pushed`。
- 没有配置任何远程时 `git remote` 空输出 → `no-remote`，不要报成 `not_pushed`
  （「没地方推」和「忘了推」修复方式不同）。
- `commitPushState` 是纯读：测试断言 revision 不变，防止后续实现误写审计。
- 逐条判定是每条一次 `git` 子进程；节点提交量大时是 O(n)。首版接受该成本
  （与 `node_tracks` 的非 light 路径同量级），后续可按 repo 批量优化。
- 缓存不在首版：推送状态随本机 git 变化，缓存会引入失效逻辑；先保证正确。

## 4. 关联章节

- 接口表：`docs/design/04-api.md`「代码推送门禁」段
- 接口示例：`docs/api.md`
- 测试策略：`docs/design/08-testing.md`（单测分组：`test/push-gate.test.mjs`）
- 决策：`docs/design/09-decisions.md` 决策 38
- 相邻功能：`../commit-registry/`（提交登记与去重）、`../branch-track/`（合并追踪）、
  `../delivery-gate/`（交付门禁）
