# 12. 决策记录

> 本文是主设计文档 [`../design.md`](../design.md) 的拆分章节；索引与章节导航见该文件。


| # | 决策 | 说明 |
|---|---|---|
| 1 | 全新独立工具 | 不复用 dsh-charge 代码与数据，dsh-charge 保持现状 |
| 2 | 本地 Web 应用 | Node + SQLite + 浏览器 SPA；先单机自用，架构预留共享 |
| 3 | 节点单表 + 属性定义表 + 属性值表 | 属性可扩展；名称 / 状态 / 排序留在节点表 |
| 4 | 表格式展开树 + 右侧抽屉 | 放弃「左树右详情」与「逐层下钻」 |
| 5 | MR 自动拉取、commit 手工登记 | 按 GitLab 项目 + 源分支查 MR；commit 由用户粘贴 |
| 6 | GitLab token 存本机 config.json（600） | 不入库、不进 git，接口返回打码 |
| 7 | 数据与配置放 `~/.taskboard/` | 便于备份与后续迁移 |
| 8 | `task` 可直接挂 `subreq` | 单任务子需求不必建空壳任务组 |
| 9 | 状态默认五值 + 每类可用子集 | 标签与集合可在 config 覆盖 |
| 10 | 代码放 `charge2/task-board/` | 新建独立 git 仓库 |
| 11 | 新增 `defect` 节点类型 | 父 = 任务 / 任务组，叶子节点；描述 / 复现步骤为预置文档，其他字段由属性系统定义 |
| 12 | Markdown 统一用 Vditor | 编辑 + 预览 + 图片上传；mermaid / KaTeX / 图标资源自托管（不依赖外网 CDN）；备选 md-editor-v3（Vue3 原生、v-model 接入最省事，mermaid 需注入本地实例） |
| 13 | 附件图片存 `~/.taskboard/uploads/` | `POST /api/uploads` 上传，`/uploads/*` 静态访问 |
| 14 | AI 是主要操作者 | MCP + CLI 双入口，与 Web 共用核心 store；路径引用、schema 发现、幂等 upsert、batch、dry-run、稳定错误码 |
| 15 | 节点 / 属性带操作者审计 | `created_by` / `updated_by` 取值 user / ai / cli / import，UI 徽标展示 |
| 16 | UI 变更可见用轮询 | `GET /api/revision` + 前端 10 秒轮询，不使用 WebSocket |
| 17 | 长文本用独立「文档」实体 | 每节点可挂多份命名 markdown（名称自由文本、同节点唯一、可排序）；表格显示 📄 数量，点击在右侧文档区渲染 / 编辑；属性不再承载 markdown |
| 18 | commit 在线预览（含子树聚合） | 用 CodeMirror 6 + @codemirror/merge 渲染 diff（统一 / 分栏 / 全文），行级高亮与未变行折叠 |
| 19 | git 操作走本机 git（`simple-git`） | 冲突检测用 `git merge-tree` 内存预检（非破坏性）；仓库定位本地优先、GitLab 兜底 |
| 20 | 合并为显式操作（不自动） | 工作单元分支 → 子需求分支的合并由按钮 / CLI 触发，支持批量按序 + 逐次预检；全本地不 push |
| 21 | 冲突在工具内处理 + AI 可写 | MergeView 逐块（保留当前 / 采用传入 / 手改）产出合并结果与补丁；同一三方数据开放给 CLI / MCP；也可生成交给 IDE 的提示词 |
| 22 | 新增 `repos` / `merges` 表 | `repos`（仓库名 → 本地路径 + GitLab 项目）；`merges` 记录合并尝试、冲突文件与状态机 |
| 23 | 工作区由工具创建 | 分支命名 `{base_branch}-{slug}`（`config.branchTemplate` 可改）；建分支 + worktree + 生成开发提示词；合并后**默认保留**工作区与分支 |
| 24 | 工作单元支持多仓库 | `unit_repos`（node × repo：branch + worktree_path），一条分支名覆盖多仓库 |
| 25 | 回归测试闭环用 `test_cases` + `test_reports` 两表 | 用例（可被 AI 重复执行的测试指令）与报告（一次执行 = 一行）分离；验收报告不落表，按节点聚合用例的**最近一次**结果。`kind` 作为统一扩展轴：v1 实现 regression / acceptance，预留 code_check / biz_check / release_check，后续接入上线配置 / 上线 SQL / 代码检查 / 业务检查时只加用例与检查器，不改表结构与入口 |
| 26 | 测试执行复用 agent 运行时，不新建执行器 | `runTestCases` 只做「拼提示词 → `startAgentRun` 派单 → 开 running 报告」，不阻塞等结果；任务结束后由前台执行者 / 收尾钩子 `test_report_finish` 回写终态。后台（qodercli）与前台（Qoder IDE ideMode）走同一条链路 |
| 27 | 验收通过率以「已完结用例」为分母 | 分桶总数守恒（`pass+fail+blocked+error+cancelled+running+notRun=cases`）；`running`（已派单未回写）与 `notRun`（从未派单）都不计入分母，`settled` = 五种终态之和；`error`/`cancelled` 从 `blocked` 拆出单列；无完结时 `passRate = null` 而非 0（避免「已派单/没跑 = 未通过」压低结论） |
| 28 | 报告状态机由应用层强制（不只靠 DB CHECK） | `running → 终态` 单向；终态重复提交同状态幂等（只更新摘要，`finished_at` 不变）；终态互转 / 回退 running 默认拒绝 `REPORT_STATUS_IMMUTABLE`（409），需显式 `overwrite:true`；非法 status 拦成 `VALIDATION_FAILED`（不把 DB CHECK 错误当 500 泄漏外部）。同时 `createTestReport` 校验 `caseId` 同节点、`runId` 存在，保证引用完整性 |
| 29 | 需求就绪门禁不落表，由既有数据推导 | 门禁（需求内容文档 / 概要设计文档 / 可回归用例）是**结论**而非业务数据，落库会产生两处真相；仿 `acceptance_report` 做纯读聚合，**不写库、不动 revision**（AI 可高频轮询做看板而不制造变更噪声）。文档判定口径是「存在且正文非空」——`createNode` 预置空白文档，只判存在会让新建需求立刻“就绪” |
| 30 | 门禁口径配置化（`config.readiness`） | 文档名与「视为可回归」的用例类型是值域而非硬编码，团队改用「详细设计」等命名只改配置、不改代码；与 `docPresets` / `status` 同一条「本机配置驱动」原则 |
| 31 | `scope` 枚举入口必须校验，禁止静默降级 | 早期三入口写成 `scope === 'subtree' ? 'subtree' : 'self'`，把 `Subtree`/`subtre`/空串吞成 `self`——「本节点就绪、子树未就绪」会被翻成 `ready=true`（放行门禁假绿）。改为 `store.normalizeScope` 单点校验：`self\|subtree` 原样，缺省取 `self`，其余 `VALIDATION_FAILED`（`details.allowed` 带值域）；入口**透传原始值**而不是先做三元。同一校验被 readiness / acceptance / release-checklist / delivery-gate / diffs / tracks / duplicates 共用 |
| 32 | 门禁空态用 `ready=null` 表示「没有可判定对象」 | 只有「节点本身不是需求类型且 `scope=self`」才拒绝（提示改用 `subtree`）；子树内没有需求属于**空态**，返回 `ready=null` 而非 400。原实现提前抛错，让 `units.length===0 ? null` 成为不可达死代码——选择兑现文档承诺，与上线清单「无必做项 `ready=null`」、验收报告 `passRate=null` 同口径 |
| 33 | 交付门禁复用三段既有聚合，不落表 | 交付结论 = 需求就绪 + 测试验收 + 上线治理的**只读汇总**；每个来源是三态（`pass` / `fail` / `not_applicable`），最终为 `ready` / `not_ready` / `unknown`。不适用不等于通过，全部不适用时 `ready=null` 而非绿灯；`acceptance` 的 `running` / `notRun` 也不算交付证据。落表会产生第二份真相，因此与 `acceptance_report` / `readiness` 同样纯读、不 bump revision |
| 34 | 停用用例不参与交付门禁 | `buildAcceptanceReport` / `buildDeliveryGate` 只聚合 `enabled=1` 的用例，与 readiness 口径一致；否则停用历史用例会永远以 `notRun` 阻塞交付，而执行链默认不会选它。删除停用用例不得改变门禁结论 |
| 35 | `format` 参数禁止静默降级 | 与 `scope` 同一条纪律：`json\|md` 缺省 `json`，其它值一律 `VALIDATION_FAILED`；三入口统一由 `store.normalizeFormat` 校验，MCP 将业务错误转为 `isError` 文本而不是泄漏 SDK `-32602`。markdown 渲染器必须转义表格单元格中的 `\|` 与换行 |
| 36 | 代码推送门禁纯读本地 ref，`unknown` 独立成态且阻塞 | 「提交并 push」的收尾动作此前没有判定：登记的提交是否真到了远程，只能人工翻 git。门禁按 remote-tracking ref（`refs/remotes/*`）判定，**只读、不 fetch、不 push、不落表**（与 `acceptance_report` / `readiness` / `delivery_gate` 同一条纯读原则，避免网络副作用与第二份真相）。单条三态 `pushed` / `not_pushed` / `unknown`：`unknown`（未登记仓库 / 路径无效 / 无远程 / sha 本地不存在 / git 失败）**不冒充通过**，与 `not_pushed` 一样阻塞但带 `reason` 区分修复方式。判定前必须 `rev-parse` 兜 `sha-not-found`——`for-each-ref --contains=<坏 sha>` 会 exit 129，顺序反了会把登记错误报成 `git-error`。首版不并入 `delivery_gate`：那会改变其 `totals.sources` 既有契约与断言，属下一步的显式决策（已由决策 37 收口） |
| 37 | 代码推送并入交付门禁，作为第四个来源 | 决策 36 把推送判定与交付结论拆开，留下一个真实假绿灯：需求就绪 + 测试通过即可算出 `ready=true`，哪怕登记的提交从未 push，交付结论看不到。现把 `push` 并入 `delivery_gate` 成为第四个来源（`totals.sources` 由 3 → 4），口径与其余来源一致：`ready=null` → `not_applicable`（范围内无登记提交）、`true` → `pass`、`false` → `fail`；`not_pushed` / `unknown` 都阻塞且展平到 `blockers`。推送判定要读本机 git ref（异步），而 store 聚合是同步纯读——因此新增 `ops.buildDeliveryGateFull` 先算 `pushGate` 再注入 `store.buildDeliveryGate({ pushGate })`，三入口只走 async 版本。同步入口漏传推送证据时**不得默认放行**：范围内有登记提交即判 `fail`（未判定 ≠ 通过），避免后续调用方误用同步版绕过门禁 |
| 38 | 回归派单的并行是显式开关，不是缺省行为 | `runTestCases` 是三入口共用的既有能力，`delivery-gate` / `acceptance` 依赖它落下的报告。缺省改 fan-out 会同时改变 run 数量、CLI 等待语义与下游脚本行为；因此并行只在 `fanout=true` 时生效（每条用例一个独立任务：真并行 + 独立输出 + 可单独取消 / 重试），缺省 `grouped` 逐字节保持 |
| 39 | fan-out 护栏超限「显式拒绝」而非静默截断 | 本机执行器没有排队调度器——`startAgentRun` 立即 spawn。若把超出的用例截掉，它们的报告仍会建成 `running` 却永远不会执行（假执行中），且无人补救。`maxParallel`（缺省 4、上限 16）超限一律 `VALIDATION_FAILED` 并带 `selected` / `maxParallel` / `limit`，让调用方自己收窄 `caseIds`，与 `scope` / `format` 同一条「禁止静默降级」纪律。真正的「选 100 条、并发 4」需要任务队列，不是提高上限 |
| 40 | `maxParallel` 先卡 number 类型再判值域，校验不只挂在 fan-out 分支 | `Number(value)` 隐式转换会把 `true` → 1、`"4"` → 4、`[1]` → 1 放过，而 MCP 用 zod `z.number()` 在协议层就拦成 SDK `-32602`，三入口对同一非法输入结论不同。改为 `normalizeMaxParallel` 先 `typeof === 'number'`、再 `Number.isInteger` + 1..16，并把校验从 fan-out 分支提到 `runTestCases` 开头（grouped 下非法值同样拒绝，不静默忽略）。CLI argv 是文本，由 `parseMaxParallelCli` 只收规范十进制整数字面量；MCP schema 用 `z.unknown()` 让非 number 进 handler，统一转 `isError + VALIDATION_FAILED`（与决策 31/35 对 `scope` / `format` 同一条纪律） |
| 41 | 重试为用例随 child run 新开报告，而非原地改写父报告 | 重试是一次新的执行，父 run 的用例报告停在旧结论会让「可单独重试」在门禁 / UI 上失效。`retryAgentRun` 建 child run 后为父 run 关联的每条用例新开一条 `running` 报告——选「新开」而非「rebind」是因为：回归闭环既有口径是「一次执行 = 一行」，原地改写会丢历史；child 落终态时 `finalizeReportsForRun` 只扫自己 `run_id` 下的 running 报告，新报告天然被收尾、无需另写路径；验收按「用例最近一条报告」取结论，自动落到重试结果；父 run 不带报告时不凭空造。组合写入用 `withoutBump` 合并为一次 revision 递增 |
