# 功能设计：概要设计大纲 / 思维导图

## 1. 模块职责

- `server/store.mjs`：新增只读聚合 `buildDesignOutline(nodeId, { scope })` —— 选定待推导单元
  （`requirement` / `subreq`）→ 逐单元把子树里的 `subreq` / `group` / `task` / `defect` 收成结构树 →
  汇总节点计数。**纯读，不 bump revision**。同时暴露 `getReadinessConfig()`，让 apply 复用同一份
  `designDoc` 文档名。
- `server/ops.mjs`：
  - `renderDesignOutlineMd(outline)`：结构树 → markdown 骨架（mermaid mindmap + 逐层小节）；
  - `applyDesignOutline(store, nodeRef, { scope, overwrite, dryRun, by })`：把骨架经 `upsertDocument`
    写入「概要设计」文档，逐单元返回 `written / skipped / reason`；
  - `design_outline` / `design_outline_apply` 登记进 `TOOLS`（AI 能力发现）。
- `server/http.mjs` / `cli.mjs` / `mcp.mjs`：三入口 1:1 暴露（只做参数装配 + 错误映射）。
- `web/src/components/NodeDrawer.vue`：需求 / 子需求 / 项目的抽屉新增「概要设计」页签，渲染骨架
  并支持「复制骨架 / 写入概要设计」。

## 2. 关键规则

**R1 为什么只推导 `requirement` / `subreq`**：项目不承载需求正文，任务组 / 子任务 / 缺陷是拆分产物。
把单元类型浓缩到需求两层，才能得到「一份概要设计对应一个需求」的干净对应关系；要看整棵子树里的
全部需求时挂到项目上用 `scope=subtree`，此时逐需求各出一份。

**R2 结构为什么取自需求树而不是重新让 AI 生成**：用户已经在需求树里维护了拆分结构，
再让 AI「读一遍需求文档、重新梳理结构」既慢又容易与树不一致。直接复用树结构，脑图与小节天然与
看板同源；脑图结构不一致时应当去改树，而不是在脑图里改。

**R3 为什么骨架小节标「待补充」**：门禁判的是「概要设计文档正文非空白」。如果骨架本身就让门禁通过，
那门禁就变成「点一下按钮」而非「设计是否真的写了」。这里选择让骨架**可被门禁接受**（它确实是内容），
但显式标注每节待补充，由 AI / 人补上目标 / 方案 / 影响面 / 验证方式。这是一个刻意的取舍：
骨架解决「从零开始」的启动成本，不假装替人做完设计。

**R4 文档名为什么要复用 `config.readiness.designDoc`**：门禁判的文档名是可配置的。
若 apply 硬编码「概要设计」，团队把口径改成「详细设计」后就会写出门禁看不见的文档 —— 一键写入
看起来成功、门禁仍然不通过。复用同一份配置是这里唯一正确的做法，测试里专门用自定义 `designDoc`
覆盖这条不变量。

**R5 默认不覆盖**：概要是**会被人和 AI 反复追加的精炼文档**，而树结构会持续变化。
每次 apply 都覆盖会把人工写的方案冲掉。缺省跳过已填写的文档，只在显式 `overwrite:true` 时覆盖，
与 `doc_upsert`「已存在则更新」的原始语义相比更保守 —— apply 是批量写多份文档，误伤面更大，
所以保守值放在安全的一侧。

**R6 dryRun 与只读分离**：推导是纯读，落库是单独一步。`dryRun` 停在推导 + 计划层面，
回报将写哪些、原因是什么（`dry_run` / `already_filled`），保证 AI 可以先预演再落库。

**R7 mermaid 转义**：mermaid 的 `["..."]` / `root(("..."))` 语法对双引号与换行敏感，节点名是用户输入。
`mermaidText()` 把双引号换成单引号、换行压平、去掉会与语法冲突的括号，避免一个名字里带 `"` 的任务
把整张脑图渲染坏掉。测试里专门构造 `R"2` 与带换行的名字断言脑图块内不出现裸值。

**R8 self 与 subtree 的骨架形态**：`scope=self` 且单单元时根节点本身就是该需求，
脑图根直接展开该需求的子节点，避免多画一层与根同名的分支；`scope=subtree` 时根是承载节点、
下面逐需求分支。这个分支只影响渲染形态，不影响 JSON 结构（JSON 始终是逐单元 `tree`）。

## 3. 踩坑 / 约束

- **不要在 apply 里用事务包住整批并依赖失败回滚**：`upsertDocument` 内部自带 `bumpRevision`，
  被外层事务包裹时 revision 语义仍会按调用次数递增。当前实现逐单元顺序写、逐个回报结果，
  让「部分写入 + 逐条状态」可见 —— 这比一个整体失败后调用方不知道为什么更符合批量运维的预期。
- **`totals.nodes` 在 `scope=subtree` 时含父子重叠**：每个需求单元各算自己子树，
  所以上层需求与其子需求的节点会被重复计数。这是刻意的 —— 它对应「逐需求各写一份骨架」的用途，
  不是全局去重后的树大小。测试里显式断言了这个语义，避免后来者误当 bug 修掉。
- **入口不要先做 `scope` 三元再传给 store**：与需求就绪门禁同一条纪律，非法值必须到达
  `normalizeScope` 才报错（见 `features/requirement-readiness/design.md` R5.1）。
- **前端页签只在 `project` / `requirement` / `subreq` 上加载**：`group` / `task` / `defect`
  上 `self` 推导会 400，抽屉加载时应直接跳过而不是让页面弹错。

## 4. 关联章节

- 接口表：`docs/design/04-api.md`「概要设计大纲 / 思维导图」段
- 接口示例：`docs/api.md`
- 决策：`docs/design/09-decisions.md` 决策 36
- 相邻功能：`../requirement-readiness/`（消费同一份「概要设计」文档名）、`../documents/`（落库载体）、
  `../tree-table-ui/`（抽屉页签）
