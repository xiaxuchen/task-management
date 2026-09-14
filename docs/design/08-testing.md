# 10. 测试策略

> 本文是主设计文档 [`../design.md`](../design.md) 的拆分章节；索引与章节导航见该文件。


- **单测（`node:test`）**：
  - `store`：建树与父子校验、环校验、级联删除计数、sort 与 reorder、节点移动
  - `attrs`：属性定义 CRUD、属性值 upsert、required / 类型校验、停用定义后不校验
  - `documents`：CRUD、按名 upsert 幂等、重名 409、排序、随节点级联删除
  - `commits`：sha 校验、同节点幂等
  - `gitlab`：分页、401、404、超时（mock `fetch`）
  - `config`：默认值生成、权限 600、token 打码
  - `uploads`：扩展名 / 大小校验、落盘命名、静态访问
  - `git`：diff / log 读取、`merge-tree` 预检（构造真冲突用例）、merge 成功与失败、未登记仓库
  - `merges`：状态机（`precheck_conflict` → `resolved` / `merged`）、批量按序合并遇冲突停下、abort 不改分支
  - `conflicts`：三方内容读取、逐块接受 / 拒绝产出、补丁可 `git apply`
  - `unit`：分支命名规则（`{base_branch}-{slug}` 与 slug 兜底 `n{id}`）、建分支 / worktree 幂等、清理默认保留、开发提示词内容
  - `test-case`：测试用例 CRUD / 按名唯一与 upsert 幂等 / `kind` 筛选 / 启停 / 排序 / 级联删除；报告开启与终态回写 / 历史保留；验收报告聚合（最近结果 / 通过率 / 未执行口径 / `scope=subtree` / 空态）；编排层 `dryRun` 与提示词拼装
  - `cli-regression-loop`：真实 CLI 子进程跑参数契约（`--enabled` / `--run-id` / `--overwrite`）与错误码
  - 回归防护：每条缺陷修复都配一条「在旧实现上会失败」的 UT（`test-case.test.mjs` 缺陷 2/3/4、`http.test.mjs` 缺陷 1/2/3/5、`cli-regression-loop.test.mjs` 缺陷 5）
  - `release-item`：上线项 CRUD / 按名唯一与 upsert 幂等 / `kind` 与 `status` 筛选 / `includeOptional` / 排序 / 级联删除 / revision 语义；上线检查清单聚合（就绪结论 / 阻塞项 / 无必做项 `ready=null` / `scope=subtree` / `blocked` 与 `skipped` 计数）；编排层 `dryRun`（只挑 `code_check`/`biz_check`/`release_check` 用例、`caseIds` 过滤、`scope=subtree`）与 markdown 渲染
  - `readiness`：需求就绪门禁三条门禁各自独立判定（预置空文档不算通过 / 空白正文不算 / 停用用例与 `code_check` 不算可回归 / `acceptance` 算）；`scope=subtree` 汇总与逐单元结论、阻塞项；非需求类型 `scope=self` 拒绝并提示 `subtree`；**纯读聚合不产生 revision**；markdown 渲染
  - `delivery-gate`：交付门禁汇总三段既有结论——空证据 `unknown`（不伪造成可交付）、需求就绪但测试未执行 `not_ready`、三段通过 / 不适用不阻塞 `ready`、必做上线项未完成覆盖测试通过结论；`scope=subtree` 联动；阻塞项展平到条目级；**纯读聚合不产生 revision**；markdown 渲染与能力清单登记
  - `run-finalize`：**派单自动收尾**（`finalizeReportsForRun`）——按输出逐条结论回写 pass/fail、无结论→blocked、失败→error、超时/取消→cancelled、不覆盖人工终态、自动结论可被人工无 `overwrite` 改正、收尾只 +1 revision；**进程级**用真实 CLI 子进程验证 `test run` / `release check` 非 dry-run 收尾到终态并回写报告，`--no-wait` 保留只派单语义；边界（upsert 只传部分字段不清空其余、名称 trim 唯一性、大小写口径、`release check scope=subtree`）
- **API 集成测试**：临时数据库 + `fetch` 直连服务跑主流程与错误分支
- **CLI 集成测试**：`taskboard` 子命令建树 / upsert / batch / import / dry-run / `--confirm` 语义
- **MCP 冒烟**：以 stdio 拉起 MCP server，逐个工具调用并校验返回（含错误码）
- **并发验证**：Web 与 CLI 同时写同一库（WAL + busy_timeout）不报错，`/api/revision` 单调递增
- **冒烟脚本** `npm run smoke`：起服务 → 建五级树 → 建缺陷 → 改属性 + 写文档 → 上传图片 → 建临时 git 仓库（含冲突场景）→ diff 预览 → 合并预检 → mock GitLab 刷新 MR → 登记 commit → 断言树与详情
- **手工验收清单**：拖拽排序、移动节点、抽屉动态表单、表格 📄 数量点击 → 右侧文档渲染、文档新增/重命名/排序/删除、Markdown 编辑与预览、图片粘贴上传、缺陷登记与状态流转、commit 预览（统一 / 分栏 / 全文 + 子树聚合）、Markdown 含 mermaid 图渲染、工作区准备（多仓库建分支 + worktree）、开发提示词复制、冲突处理（逐块接受 / 拒绝 → 补丁可应用）、仓库登记、列显示设置、设置页连通性测试
