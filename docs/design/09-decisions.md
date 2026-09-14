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
