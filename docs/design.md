# 任务管理器（task-board）设计文档

- 日期：2026-09-11
- 状态：待评审（v1）
- 形态：全新独立工具（不改动 dsh-charge）

## 1. 背景与目标

需要以树形方式组织研发任务与子任务，层级固定为：

```
项目 → 需求 → 子需求 → 任务组（可任意嵌套）→ 子任务
```

- **任务组**：子需求中相对独立的一部分；把子需求拆分即得到下一层任务；任务组可继续嵌套任务组
- **子任务**：可独立完成的最小单元
- **组合关系**：任务组 + 子任务组合起来 = 完整的子需求
- 每种节点有专属属性，属性必须支持**扩展**（新增属性不改表结构、不改前端代码）
- 子需求需要自动获取 GitLab 上的 MR 列表与状态
- commit 需要**在线预览**（节点自身 + 子树聚合），多个 commit 之间的**冲突要被检测出来并可由用户处理**
- 代码集成：子需求的 `branch` 为集成分支；工作单元（任务组 / 子任务）可有自己的分支，合并回集成分支由用户**显式触发**（合并前预检冲突）
- 任务 / 任务组下可登记**缺陷**子节点（名称、描述、复现步骤等，字段可扩展）
- 大段文本统一以 **Markdown 文档**承载（每个节点可挂多份命名文档，支持编辑 / 渲染预览与图片上传）
- **AI 是主要操作者**：日常增删改主要由 AI 完成，工具必须对 AI 友好（稳定引用、可发现 schema、幂等写入、批量与预演、机器可解析错误）

目标：一个本机运行的独立任务管理器，`npm start` 起服务 + 打开浏览器即可使用；同时提供 MCP / CLI 让 AI 直接操作；架构上预留将来多人共享能力。

## 2. 范围

### 2.1 v1 包含

1. **表格式展开树**：整树一次加载、按行展开/收起、名称搜索 + 类型/状态筛选
2. **节点增删改**：类型由父节点决定；删除级联；同级拖拽排序；节点移动到其他父节点
3. **属性系统**：属性定义（按节点类型，可扩展）+ 属性值；右侧抽屉按定义动态渲染表单
4. **属性定义管理页**：新增 / 编辑 / 启停 / 排序
5. **MR 自动拉取**：子需求按「GitLab 项目 + 分支」调用 GitLab API 拉取 MR 列表与状态
6. **commit 手工登记**：任务组 / 子任务登记「仓库 + sha + 说明」
7. **缺陷登记**：任务 / 任务组下可新增缺陷子节点（名称、描述、复现步骤等，字段走属性系统可扩展）
8. **文档（Markdown，可多份）**：每个节点可挂多份命名 markdown 文档（名称 + 内容 + 排序，按类型预置「描述」「复现步骤」等）；表格显示 📄 数量，点击 → 右侧文档区（左列文档名 + 右侧渲染 / 编辑），支持图片粘贴 / 上传；Markdown 渲染支持代码高亮、表格、任务列表与 **mermaid 图**、KaTeX 公式
9. **本机配置页**：GitLab 地址 / token（含连通性测试）、端口、状态值域
10. **AI 接入（MCP + CLI）**：与 Web 共用同一核心的 MCP server 与命令行，提供 schema 发现、markdown 树读取、幂等 upsert、批量操作、大纲导入、`--dry-run` 与显式确认
11. **AI 变更实时可见**：`GET /api/revision` + 前端轮询，AI 改完页面自动刷新
12. **commit 在线预览**：单 commit / 节点（含子树）聚合预览；按文件看 diff（统一 / 分栏 / 全文），行级高亮与未变行折叠
13. **冲突检测与处理**：合并前用 `git merge-tree` 内存预检；冲突时列出文件与冲突块，可在工具内逐块处理（保留当前 / 采用传入 / 手改）并产出合并结果与补丁，AI 可通过 CLI / MCP 读三方并写回，也可生成交给 IDE 的提示词
14. **代码集成（显式合并）**：工作单元分支合并回子需求分支由按钮 / CLI 触发，支持批量按序合并与逐次预检；全本地、不 push
15. **工作区准备**：工具按命名规则（`{base_branch}-{slug}`）创建 worktree 与工作单元分支——分支**从当前子需求分支派生**（以创建时刻子需求分支的最新提交为基），支持多仓库，并生成可直接投喂 AI 的**开发提示词**；合并后工作区默认保留

### 2.2 v1 不包含

- commit 自动扫描 / 采集（本地或远端 git）
- 应用内的 AI 对话界面（AI 一律通过 MCP / CLI 操作，不在应用里做聊天）
- 统计与汇总看板（工时、进度、时间节点汇总）
- 多人共享与账号权限
- 从 dsh-charge（`~/.dsh/charge/requirements.db`）迁移数据
- 远端操作：push、远端分支管理、MR 自动创建（v1 全程本地；MR 仅只读拉取）
- 缺陷与外部系统（JIRA / 飞书等）同步，以及缺陷统计分析

## 3. 概念模型

节点类型（代码值）：

| 类型 | 代码 | 父节点允许值 | 说明 |
|---|---|---|---|
| 项目 | `project` | 无（`parent_id = NULL`） | 最高层 |
| 需求 | `requirement` | `project` | |
| 子需求 | `subreq` | `requirement` | 拆分的目标；承载分支 / 基线 / MR |
| 任务组 | `group` | `subreq`、`group` | 组织单元，可任意嵌套，无专属属性 |
| 子任务 | `task` | `group`、`subreq` | 最小独立单元 |
| 缺陷 | `defect` | `task`、`group` | 挂在任务 / 任务组下的缺陷，叶子节点，字段可扩展 |

说明：

- `task` 允许直接挂在 `subreq` 下，避免"只有一个任务的子需求"被迫建一个空壳任务组
- `defect` 为叶子节点，不允许再挂子节点；可与任务 / 任务组一样手工登记关联 commit（修复提交）
- 非法父子组合、跨级挂载、把节点移动到自己的后代 → 接口层拒绝（400）
- 节点可用 `id` 或**路径**（`项目A/需求1/子需求2`）引用；路径同名歧义时返回 409 并要求改用 `id`
- 每个节点可挂 N 份命名 markdown **文档**（见 §4.6）；长文本一律落在文档里，属性只放结构化短字段
- 代码集成：子需求的 `branch` 是集成分支；工作单元（任务组 / 子任务）的工作分支**从当前子需求分支派生**（命名规则 `{base_branch}-{slug}`；`base_branch` 默认取子需求分支，创建时以该分支最新提交为基），工作区由工具创建（见 §7.10），合并回集成分支需显式触发（见 §7.11）

## 4. 数据模型

存储：SQLite（Node 内置 `node:sqlite`），开启 WAL 与外键；数据文件 `~/.taskboard/data.db`。

### 4.1 nodes（节点，结构表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| type | TEXT NOT NULL | `project` / `requirement` / `subreq` / `group` / `task` / `defect`（CHECK 约束） |
| parent_id | INTEGER NULL | 自引用 FK，`ON DELETE CASCADE`；`project` 为 NULL |
| name | TEXT NOT NULL | 显示名，必填，≤200 字符 |
| status | TEXT NOT NULL | 状态码，见 4.8 |
| sort | INTEGER NOT NULL | 同级排序，升序展示，默认取当前最大 +10 |
| created_at / updated_at | TEXT | ISO 时间 |
| created_by / updated_by | TEXT | 操作者：`user` / `ai` / `cli` / `import`（审计用） |

索引：`idx_nodes_parent(parent_id, sort)`。

名称 / 状态 / 排序保留在节点表（不进属性表）：树渲染、排序、筛选是高频操作，走属性表会导致每次列树都要联表。

### 4.2 attr_defs（属性定义，按节点类型扩展）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_type | TEXT NOT NULL | 所属节点类型 |
| key | TEXT NOT NULL | 稳定标识（同类型内唯一） |
| label | TEXT NOT NULL | 显示名 |
| data_type | TEXT NOT NULL | `text` / `textarea` / `number` / `date` / `select` / `url` |
| options | TEXT | `select` 的选项，JSON 数组 `[{value,label}]` |
| required | INTEGER NOT NULL DEFAULT 0 | 是否必填 |
| default_value | TEXT | 新建节点时的默认值 |
| sort | INTEGER NOT NULL | 表单/列展示顺序 |
| enabled | INTEGER NOT NULL DEFAULT 1 | 停用后不展示、不校验，历史值保留 |
| created_at / updated_at | TEXT | |

约束：`UNIQUE(node_type, key)`。新增属性 = 插入一行，表结构与前端都不需要改动。

属性只承载结构化短字段（含多行纯文本 `textarea`）；长文本 / 富文本一律用文档实体（见 §4.6），属性不再提供 markdown 类型。

### 4.3 attr_values（属性值，按节点）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_id | INTEGER NOT NULL | FK → nodes(id) ON DELETE CASCADE |
| attr_def_id | INTEGER NOT NULL | FK → attr_defs(id) ON DELETE CASCADE |
| value | TEXT | 统一以 TEXT 存储，读取按 `data_type` 解析 |
| updated_at | TEXT | |
| updated_by | TEXT | 操作者：`user` / `ai` / `cli` / `import` |

约束：`UNIQUE(node_id, attr_def_id)`。

排序 / 过滤：`number` 用 `CAST(value AS REAL)`，`date` 按 ISO 文本（`YYYY-MM-DD`）排序。

v1 中所有属性值均由用户编辑；系统自动写入的数据只有 MR 列表（见 4.5）。

### 4.4 commits（关联 commit，用户手工登记）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_id | INTEGER NOT NULL | FK → nodes(id) ON DELETE CASCADE |
| repo | TEXT | 仓库名，可空 |
| sha | TEXT NOT NULL | 7–40 位十六进制 |
| note | TEXT | 说明，可空 |
| created_at | TEXT | |

约束：`UNIQUE(node_id, sha)`（同节点重复登记幂等）。挂载对象：`group` / `task` / `defect`。

`repo` 为仓库名，需与 `repos.name` 对应（见 §4.7）；未登记时预览 / 合并报 400 `REPO_NOT_REGISTERED`。

### 4.5 mrs（自动拉取的 MR，系统写入）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_id | INTEGER NOT NULL | FK → nodes(id) ON DELETE CASCADE |
| project | TEXT NOT NULL | GitLab 项目路径，如 `charging/xp-charge` |
| iid | INTEGER NOT NULL | 项目内 MR 序号 |
| title | TEXT | |
| state | TEXT | `opened` / `merged` / `closed` / `locked` |
| source_branch | TEXT | |
| web_url | TEXT | |
| updated_at | TEXT | 来自 GitLab |
| fetched_at | TEXT | 本地拉取时间 |

约束：`UNIQUE(node_id, project, iid)`。挂载对象：`subreq`。

### 4.6 documents（节点文档，可多份）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_id | INTEGER NOT NULL | FK → nodes(id) ON DELETE CASCADE |
| name | TEXT NOT NULL | 文档名（自由文本，不做枚举约束；同节点内唯一） |
| content | TEXT | markdown 正文 |
| sort | INTEGER NOT NULL | 展示顺序 |
| created_at / updated_at | TEXT | |
| created_by / updated_by | TEXT | 操作者：`user` / `ai` / `cli` / `import` |

约束：`UNIQUE(node_id, name)`；索引 `idx_documents_node(node_id, sort)`。

预置文档名（新建节点时自动创建空文档，可在 `config.json` 的 `docPresets` 覆盖）：

| node_type | 预置文档名 |
|---|---|
| project | 描述 |
| requirement | 需求内容 |
| subreq | 需求内容 |
| group | 无 |
| task | 无 |
| defect | 描述、复现步骤 |

文档重名返回 409 `DOC_NAME_EXISTS`；UI 新增文档时自动加序号规避（新文档 / 新文档2…）。

### 4.7 repos（仓库登记）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | 仓库名（`commits.repo` 引用它，同时作为显示名） |
| local_path | TEXT | 本地仓库绝对路径（diff / 合并 / 冲突预检用） |
| gitlab_project | TEXT | GitLab 项目路径（如 `charging/xp-charge`；本地缺失时兜底读取） |
| note | TEXT | 备注 |
| created_at / updated_at | TEXT | |

约束：`UNIQUE(name)`。读取优先级：`local_path` 存在 → 本机 git；否则用 `gitlab_project` 调 GitLab API；两者都无 → 400 `REPO_NOT_REGISTERED`。

### 4.8 状态值域

默认枚举（可在 config 覆盖标签与可用集合）：

| 码 | 标签 |
|---|---|
| `todo` | 待开始 |
| `doing` | 进行中 |
| `testing` | 提测中 |
| `done` | 已完成 |
| `cancelled` | 已取消 |

每类节点默认可用集合：

- `project`：todo / doing / done
- `requirement`：全部五项
- `subreq`：todo / doing / done
- `group`：todo / doing / done
- `task`：todo / doing / done
- `defect`：todo / doing / done / cancelled

状态码是配置驱动的：如需为缺陷增加「已修复 `fixed` / 已验证 `verified`」等，只需在设置页（config）添加，无需改表。

### 4.9 预置属性定义

| node_type | key | label | data_type | required |
|---|---|---|---|---|
| requirement | start_date | 开始时间 | date | 否 |
| requirement | end_date | 结束时间 | date | 否 |
| requirement | review_date | 需求评审时间 | date | 否 |
| requirement | design_review_date | 概设评审时间 | date | 否 |
| requirement | test_submit_date | 提测时间 | date | 否 |
| requirement | estimate_hours | 预估工时 | number | 否 |
| subreq | branch | 分支 | text | 否 |
| subreq | baseline | 基线 | text | 否 |
| subreq | gitlab_project | GitLab 项目 | text | 否 |
| group | slug | 英文短名 | text | 否 |
| group | branch | 分支 | text | 否 |
| group | base_branch | 基线分支 | text | 否 |
| task | slug | 英文短名 | text | 否 |
| task | branch | 分支 | text | 否 |
| task | base_branch | 基线分支 | text | 否 |

`gitlab_project` 非必填；点「刷新 MR」时若该属性或「分支」为空，接口返回提示要求先补填。

`defect` 无预置属性（缺陷的「描述」「复现步骤」是**文档**，见 §4.6）；`group` / `task` 预置 `slug` / `branch` / `base_branch`（工作区与代码集成用，见 §7.10 / §7.11）。后续要加「严重程度 / 发现版本 / 负责人 / 优先级 / 标签」等，只插入 `attr_defs`（或在属性定义管理页添加）即可。

### 4.10 config（本机配置文件）

路径 `~/.taskboard/config.json`，权限 `600`：

```json
{
  "port": 3210,
  "gitlab": { "base_url": "", "token": "" },
  "docPresets": { "project": ["描述"], "requirement": ["需求内容"], "subreq": ["需求内容"], "group": [], "task": [], "defect": ["描述", "复现步骤"] },
  "worktreeRoot": "",
  "branchTemplate": "{base_branch}-{slug}",
  "status": {
    "labels": { "todo": "待开始", "doing": "进行中", "testing": "提测中", "done": "已完成", "cancelled": "已取消" },
    "allowed": { "project": ["todo", "doing", "done"], "requirement": ["todo", "doing", "testing", "done", "cancelled"], "subreq": ["todo", "doing", "done"], "group": ["todo", "doing", "done"], "task": ["todo", "doing", "done"], "defect": ["todo", "doing", "done", "cancelled"] }
  }
}
```

约束：token 只存本机文件，不写库、不进 git；接口返回时打码。

### 4.11 merges（合并尝试与冲突）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_id | INTEGER NOT NULL | 工作单元（`group` / `task`）的节点 id |
| repo | TEXT NOT NULL | 仓库名（对应 `repos.name`） |
| source_branch | TEXT NOT NULL | 工作单元分支 |
| target_branch | TEXT NOT NULL | 集成分支（子需求 `branch`） |
| base_sha / source_sha / target_sha | TEXT | 预检时的三方 sha |
| state | TEXT NOT NULL | `precheck_conflict` / `merged` / `resolved` / `aborted` |
| merge_sha | TEXT | 实际合并产生的 commit sha |
| conflict_files | TEXT | 冲突文件与冲突块（JSON） |
| created_at / updated_at | TEXT | |
| created_by / updated_by | TEXT | 操作者：`user` / `ai` / `cli` / `import` |

约束：一次「合并回集成分支」按仓库各产生一行；`state = precheck_conflict` 的行即待处理冲突，处理完成后置 `resolved` 并回填 `merge_sha`。

### 4.12 unit_repos（工作单元 × 仓库）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| node_id | INTEGER NOT NULL | 工作单元（`group` / `task`）的节点 id |
| repo_id | INTEGER NOT NULL | FK → repos(id) |
| branch | TEXT | 该仓库上的工作单元分支（默认 `{base_branch}-{slug}`，多仓库同名） |
| worktree_path | TEXT | 该仓库的 worktree 本地路径（工具创建后回填） |
| created_at / updated_at | TEXT | |

约束：`UNIQUE(node_id, repo_id)`。一个工作单元可覆盖多个仓库（同一条分支名），`worktree_path` 是「工作区状态」的唯一来源。

## 5. 架构与技术选型

- **形态**：本机 Web 应用 + AI 双入口。`npm start` 启动本地服务并自动打开浏览器；CLI（`taskboard`）与 MCP server（stdio）与 Web 共用同一核心 store，可独立运行、不要求 Web 服务在跑
- **后端**：Node.js ≥ 22.5（本机 22.22）+ `express` + 内置 `node:sqlite`（无原生依赖）；MCP 用官方 `@modelcontextprotocol/sdk`，CLI 用内置 `util.parseArgs`；git 操作（show / diff / log / merge / merge-tree 预检）用 `simple-git` 调本机 git
- **前端**：Vite + Vue 3 + Element Plus（`el-table` 树形数据做展开树、`el-drawer` 做右侧详情、`el-dialog` 做属性定义编辑）；文档编辑用 **Vditor**（编辑 / 预览 / 图片上传）；diff 预览与冲突处理用 **CodeMirror 6 + @codemirror/merge**（MergeView 支持逐块接受 / 拒绝）。Vditor 的图标 / mermaid / KaTeX 等资源**自托管**（静态目录 + `cdn` 配置），不依赖外网 CDN
- **错误处理**：统一错误体 `{ error: { code, message, details? } }`

模块划分：

```
task-board/
  package.json          # 根脚本：start / dev / test / smoke
  server/
    index.js            # 启动、静态资源托管（含 /uploads）、路由挂载、打开浏览器
    config.js           # config.json 读写、默认值、600 权限、token 打码
    db.js               # 打开库、建表与迁移、WAL、外键、预置 attr_defs
    store.js            # nodes / attrs / documents / commits / mrs 数据访问 + 类型校验 + 级联 + 排序
    git.js              # 本机 git 操作：show / diff / log、branch / worktree、merge、merge-tree 冲突预检
    gitlab.js           # GitLab API 客户端（项目 MR 查询、连通性测试、diff 兜底）
    api.js              # REST 路由与统一错误处理（含图片上传）
    mcp.js              # MCP server（stdio）：把核心能力暴露为工具
    cli.js              # CLI 命令实现（tree / node / attr / doc / repo / unit / commit / diff / merge / conflict / mr / batch / import / schema）
  bin/
    taskboard.js        # CLI 可执行入口（npm link 后可直接 `taskboard`）
  web/
    index.html
    src/App.vue                    # 壳 + 路由（列表 / 属性定义 / 设置）
    src/views/TreeView.vue         # 表格式展开树
    src/views/AttrDefsView.vue     # 属性定义管理
    src/views/SettingsView.vue     # GitLab / 端口 / 状态值域
    src/components/NodeDrawer.vue  # 右侧详情抽屉（动态表单 + 文档区 + commits + MR）
    src/components/MarkdownEditor.vue  # Vditor 封装：编辑 / 预览、图片上传
    src/components/DocPane.vue     # 文档区：左列文档名（增 / 改 / 排 / 删）+ 右侧渲染 / 编辑
    src/components/DiffPane.vue    # commit 预览：文件列表 + CodeMirror diff（统一 / 分栏 / 全文）
    src/components/ConflictPane.vue # 冲突处理：MergeView 逐块接受 / 拒绝 / 手改 + 产出补丁
    src/api.js
  test/                 # node:test 用例
  README.md
```

- 数据：`~/.taskboard/data.db`；附件图片：`~/.taskboard/uploads/`；配置：`~/.taskboard/config.json`
- 代码位置：`/Users/xuchen.xia/charge2/task-board/`（新建独立 git 仓库）
- 依赖：`express`、`@modelcontextprotocol/sdk`（MCP server）、`simple-git`（本机 git 操作）、`vue`、`element-plus`、`vditor`（Markdown 编辑 / 预览）、`@codemirror/*`（diff 预览与冲突处理）、`sortablejs`（同级拖拽排序）、`vite`、`@vitejs/plugin-vue`；其余使用 Node 内置能力（fetch / sqlite / test / util.parseArgs）
- 将来共享：存储层（`store.js`）与 HTTP 层分离，替换数据库 + 增加登录与 `owner` 字段即可升级为多人服务

### 5.1 AI 友好约定（v1 必须满足）

- **引用**：所有工具与接口同时接受 `id` 与路径（`项目A/需求1/子需求2`）
- **读取**：`tree --format md` 输出缩进 markdown 树；`node show --with=attrs,commits,mrs`
- **发现**：`schema` 返回节点类型、状态值域、属性定义与工具清单（AI 不必猜字段）
- **写入**：`node upsert --path`（get-or-create，幂等）、`attr set`（单项更新）、`doc upsert`（按文档名写正文）、`batch`（多步一次调用）；均支持 `--dry-run`
- **导入**：`import --format md` 用缩进大纲一次落成整棵子树
- **工作区**：`unit setup` 按规则建分支 + worktree（支持多仓库）并返回开发提示词；`unit prompt` 刷新提示词；`unit cleanup` 清理（合并后默认保留）
- **破坏性操作**：删除 / 移动需显式 `--confirm`（接口 `confirm: true`），未确认返回 400 `CONFIRM_REQUIRED`
- **错误**：统一 `{ error: { code, message, details } }`，错误码稳定，`details` 定位到字段 / 路径
- **并发**：SQLite WAL + `busy_timeout=5000`，Web / CLI / MCP 三方直接读写同一库
- **变更可见**：任何写入使 `GET /api/revision` 递增；前端每 10 秒轮询并自动刷新
- **预览与冲突**：`diff` 读单 commit / 节点（含子树）的 diff；`merge precheck` 预检；`merge run` 执行合并；`conflict show` 返回 base / ours / theirs 三方内容；`conflict resolve` 写回合并结果与补丁（AI 可直接处理冲突）
- **工具清单**：MCP 工具与 CLI 命令是 §6 REST 能力的 1:1 映射（schema / tree / node / attr-def / doc / repo / unit / commit / diff / merge / conflict / mr / batch / import / upload）
- **文档**：README 附「给 AI 的用法」（工具清单 + 示例 + bootstrap prompt）

### 5.2 仓库结构与文档同源（功能之家）

约定：**一个目录就是一个功能的家**，文档与代码同步推进、一起提交。

```text
task-board/
  docs/design.md              # 主设计文档（权威副本；评审版在工作区 docs/superpowers/specs/）
  features/README.md          # 功能索引（功能 → 目录 → 计划 → 状态 → 代码位置）
  features/<功能目录>/
    prd.md                    # 功能需求（目标 / 需求点 / 验收标准）
    design.md                 # 功能设计（模块职责 / 关键规则 / 接口 / 错误码 / 与主设计文档对应）
    commit.md                 # 该功能的提交记录：一行一条 commit message
  server/                     # 代码按分层组织（errors / config / db / store，后续 git•api•mcp•cli）
  test/                       # node:test 用例
  web/                        # 前端（计划 3 起）
```

规则：

1. 每个功能目录只放文档三件套（`prd.md` / `design.md` / `commit.md`），不放代码；代码在 `server/`、`test/`、`web/`，靠 `features/README.md` 的索引对应。
2. 提交前把本次 commit message 追加进所属功能的 `commit.md`，与该功能代码在同一次提交入库；跨功能的提交在每个被触碰的功能里各记一行。
3. 新增或拆分功能时同步建目录与三份文档，并在 `features/README.md` 索引里登记。
4. 功能粒度对齐 §2.1 的 v1 功能清单；目录清单见 `features/README.md`。

## 6. 接口（REST，JSON）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查，返回版本与数据文件路径 |
| GET | `/api/schema` | 节点类型、状态值域、属性定义、工具清单（AI 能力发现） |
| GET | `/api/revision` | 数据版本号（任何写入 +1），供前端轮询与 AI 判断变更 |
| GET | `/api/tree?format=md` | 缩进 markdown 树（AI 读取用）；默认 `json` |
| GET | `/api/tree` | 全量树数据：`[{id,type,parentId,name,status,sort,attrs:{key:value}}]`，前端组树与过滤 |
| GET | `/api/nodes/:id` | 节点详情：核心字段 + `attrs` + `commits` + `mrs` + `children` |
| POST | `/api/nodes` | 创建节点 `{parentId?, type, name, attrs?}`；校验父子类型 |
| PATCH | `/api/nodes/:id` | 更新 `{name?, status?, parentId?, attrs?}`；`attrs` 为 key→value 局部更新 |
| DELETE | `/api/nodes/:id` | 级联删除（返回删除的节点数与关联行数） |
| POST | `/api/nodes/reorder` | `{parentId, orderedIds[]}` 一次性写入同级顺序 |
| POST | `/api/nodes/upsert` | 按路径 get-or-create（幂等）：`{path, type?, name?, attrs?}` |
| POST | `/api/batch` | 批量操作：`{ops:[...], dryRun?}`，一次调用执行多步 |
| POST | `/api/import` | 大纲导入：`{format:"md", content, parentPath?, dryRun?}` |
| GET | `/api/attr-defs?nodeType=` | 属性定义列表 |
| POST | `/api/attr-defs` | 新增属性定义 |
| PATCH | `/api/attr-defs/:id` | 编辑（label / data_type / options / required / sort / enabled） |
| DELETE | `/api/attr-defs/:id` | 删除定义（连带删除其属性值） |
| POST | `/api/nodes/:id/documents` | 新增文档 `{name, content?}` |
| POST | `/api/nodes/:id/documents/upsert` | 按文档名 get-or-create 并写内容（幂等）：`{name, content}` |
| PATCH | `/api/documents/:docId` | 更新文档 `{name?, content?}` |
| DELETE | `/api/documents/:docId` | 删除文档 |
| POST | `/api/nodes/:id/documents/reorder` | `{orderedIds[]}` 写入文档顺序 |
| POST | `/api/nodes/:id/commits` | `{repo?, sha, note?}` 登记 commit |
| DELETE | `/api/commits/:cid` | 删除登记 |
| GET | `/api/commits/:cid/diff` | 单 commit 预览：文件列表 + 每文件 old / new 与 patch |
| GET | `/api/nodes/:id/diffs?scope=self\|subtree` | 节点（含子树）聚合预览，按 commit / 仓库分组 |
| POST | `/api/nodes/:id/merges/precheck` | 合并预检（merge-tree，不落库、不合并） |
| POST | `/api/nodes/:id/merges` | 显式合并：`{units?, repo?, dryRun?}`，逐仓库预检并合并，返回 `{merged[], conflicts[]}` |
| GET | `/api/merges?nodeId=&state=` | 合并记录列表（含待处理冲突） |
| GET | `/api/merges/:mid/conflicts` | 冲突详情：文件 + 冲突块 + base / ours / theirs 三方内容 |
| POST | `/api/merges/:mid/resolve` | 写回冲突处理结果 `{files:[{path, content}], asPatch?}` |
| POST | `/api/merges/:mid/confirm` | 确认合并完成（本地已应用）→ 回填 `merge_sha`，置 `resolved` |
| POST | `/api/merges/:mid/abort` | 放弃本次合并 → `aborted`（不改任何分支） |
| GET | `/api/repos` | 仓库登记列表 |
| POST | `/api/repos` | 新增仓库 `{name, local_path?, gitlab_project?, note?}` |
| PATCH | `/api/repos/:rid` | 更新仓库 |
| DELETE | `/api/repos/:rid` | 删除仓库 |
| GET | `/api/nodes/:id/unit-repos` | 工作单元涉及的仓库（branch / worktree_path） |
| POST | `/api/nodes/:id/unit-repos` | 新增 `{repoId, branch?, worktreePath?}` |
| DELETE | `/api/unit-repos/:urid` | 移除工作单元仓库 |
| POST | `/api/nodes/:id/setup` | 创建工作区：`{repoIds?, dryRun?}` → 建分支 + worktree，返回 `{branch, repos:[{repo, worktreePath}], prompt}` |
| GET | `/api/nodes/:id/prompt` | 生成 / 刷新开发提示词 |
| POST | `/api/nodes/:id/cleanup` | 清理工作区（移除 worktree / 删除已合并分支；需 `confirm`） |
| GET | `/api/nodes/:id/mrs` | 该节点已拉取的 MR 列表 |
| POST | `/api/nodes/:id/mrs/refresh` | 拉取 MR：`{pulled, created, updated, errors[]}` |
| GET | `/api/config` | 读取配置（token 打码） |
| PUT | `/api/config` | 保存配置 |
| POST | `/api/config/gitlab/test` | GitLab 连通性测试（返回当前用户与项目可达性） |
| POST | `/api/uploads` | 上传图片：请求体 JSON `{ name, data }`（`data` 为 base64，`express.json` 限额 20 MB），存入 `~/.taskboard/uploads/`，返回 `{ url: "/uploads/<name>" }` |
| GET | `/uploads/:name` | 图片静态访问（Markdown 预览使用） |

状态码：参数/父子类型/必填校验失败 → `400`；资源不存在 → `404`；唯一约束冲突 / 路径歧义 → `409`；GitLab 侧错误 → `502`（`details` 带原始信息）。破坏性操作未显式确认 → `400`，`code = CONFIRM_REQUIRED`。合并预检发现冲突不改工作区，返回 `200` + 冲突清单（`state = precheck_conflict`）；本机 git 不可用 / 失败 → `500`（`GIT_UNAVAILABLE` / `GIT_FAILED`）。

## 7. 关键流程

### 7.1 建树

1. 工具条「新建项目」→ `POST /api/nodes {type:"project", name}`
2. 行悬浮「+」→ 按父节点类型推导子类型（project→requirement→subreq→group→task）→ 校验后创建；`task` / `group` 行还可选择「+ 添加缺陷」（`defect`）
3. 父子校验失败、或把节点移动到自身后代 → 400 并给出明确原因

### 7.2 属性编辑（右侧抽屉）

1. 点行 → 抽屉请求 `GET /api/nodes/:id`
2. 按节点 `type` 过滤 `attr_defs`（`enabled=1`，按 `sort`）渲染表单（text/textarea/number/date/select/url）；文档不在这里，见 §7.7
3. 保存 → `PATCH /api/nodes/:id { attrs: {key: value} }` → `store` 按 key 找 `attr_def_id` → upsert `attr_values`
4. 校验：`required` 不能为空；`number` 必须可解析为数字；`date` 必须为 `YYYY-MM-DD`；`select` 必须命中 options

### 7.3 MR 刷新

1. 前置：`config.gitlab.base_url` 与 `token` 已配置；节点为 `subreq`，且 `branch`、`gitlab_project` 属性非空
2. 调用：`GET {base_url}/api/v4/projects/{urlencode(project)}/merge_requests?source_branch={branch}&state=all&per_page=100`，带 `PRIVATE-TOKEN` 头；分页最多 3 页（300 条）
3. 映射：`iid` / `title` / `state` / `source_branch` / `web_url` / `updated_at`
4. 写入：按 `(node_id, project, iid)` upsert；本次未返回的既有记录**保留不删**，前端以「上次拉取时间」提示可能过期
5. 失败：未配置 → 400 + 引导；401 → 提示 token 无效；404 → 提示项目路径错误；网络异常 → 502；任何失败都不改动既有 MR 数据

### 7.4 commit 登记

1. 抽屉输入 `repo`（可选）/ `sha` / `note`
2. 校验 sha 为 7–40 位十六进制 → `INSERT OR IGNORE`（同节点同 sha 幂等）
3. 返回该节点最新 commits 列表

### 7.5 排序与移动

- **同级拖拽排序**：前端用 `sortablejs` 绑定表格行，`onMove` 限制同父同级；落库调 `POST /api/nodes/reorder { parentId, orderedIds }`
- **移动**：抽屉 / 行菜单「移动到…」选择目标父节点 → `PATCH /api/nodes/:id { parentId }`，校验目标父类型合法且不是自身后代

### 7.6 缺陷登记

1. 在 `task` / `group` 行的「+ 添加缺陷」或抽屉的子节点区选择「缺陷」→ `POST /api/nodes { parentId, type: "defect", name }`
2. 抽屉「文档」区填写预置文档「描述」「复现步骤」（Markdown 编辑器）；其余字段可在属性定义管理页扩展
3. 缺陷为叶子节点，接口拒绝在其下建子节点；状态流转沿用节点状态（可在设置页添加 `fixed` / `verified` 等状态码）
4. 缺陷与任务 / 任务组一样支持手工登记关联 commit（修复提交）

### 7.7 文档的打开、渲染与编辑

1. 表格「文档」列显示 📄 数量；点击该单元格 → 抽屉切到**文档区**并默认选中第一份文档
2. 文档区布局：左列文档名列表（＋新增、重命名、↑↓ 排序、删除），右侧为内容区（顶部「预览 / 编辑」切换；默认预览，点「编辑」进编辑器）
3. 新建节点时按 `docPresets` 自动创建空文档；AI 用 `POST /api/nodes/:id/documents/upsert` 按文档名 get-or-create 写入内容（幂等）
4. 保存：`PATCH /api/documents/:docId`；顺序：`POST /api/nodes/:id/documents/reorder`；删除需二次确认
5. 图片：粘贴或选择图片 → 前端用 Vditor 自定义 `upload.handler` 以 base64 JSON 调 `POST /api/uploads` → 存 `~/.taskboard/uploads/<时间戳>-<随机>.<ext>` → 返回 `/uploads/...`，编辑器把地址写入 markdown
6. 图片限制：仅 `png` / `jpg` / `jpeg` / `gif` / `webp`，单文件 ≤ 10 MB；超限或类型不符返回 400
7. 表格内与折叠态只展示文档名与数量，不渲染正文

### 7.8 启动

1. `npm start` → 读 `~/.taskboard/config.json`（不存在则生成默认值，权限 600）
2. 打开 / 初始化 `~/.taskboard/data.db`（建表 + 预置 attr_defs，幂等）
3. 监听端口（默认 3210；被占用则依次尝试 +1，最多到 3220，并在终端打印实际端口）
4. 自动打开浏览器（macOS `open`）；前端使用 Vite 构建产物，由后端静态托管

### 7.9 AI 操作流程（MCP / CLI）

1. AI 先 `schema` 发现节点类型、状态值域与属性定义（避免猜字段）
2. `tree --format md` 读取现状（缩进 markdown 树，直接可读）
3. 规划后写入：结构用 `import --format md` 一次落库，或 `batch` 执行多步；不确定的先 `--dry-run` 预演
4. 单点更新用 `node upsert --path ...`、`attr set`，重复调用安全（幂等）
5. 破坏性操作（删除 / 移动）必须带 `--confirm`
6. 写入后 `GET /api/revision` 递增，前端轮询自动刷新，无需人工刷新

**大纲导入格式**（`import --format md`）：

```text
- 项目A
  - 需求1
    - 子需求1
      - 任务组A
        - [task] 子任务1
          - 预估工时: 8
        - [defect] 登录报错
```

规则：缩进 2 空格；`- ` 列表项为一个节点；`[task]` / `[defect]` 必须显式标注，其余类型按层级推导（第 1 层项目 / 第 2 层需求 / 第 3 层子需求 / 第 4 层及更深为任务组）；节点下更深缩进的 `键: 值` 行为属性（匹配属性 `label` 或 `key`）；`#` 开头行忽略（便于 AI 写注释）；长文本用 `doc upsert`（按文档名写入正文）或 `batch` 写入。

### 7.10 工作区准备（建分支 / worktree + 开发提示词）

1. 在工作单元（`group` / `task`）抽屉选择**涉及仓库**（多选，写入 `unit_repos`），填 `slug`（可空）；`base_branch` 默认取**当前子需求分支**（如需基于其他分支可覆盖）
2. 「创建工作区」/ `unit setup`：
   - 分支名 = `config.branchTemplate` 渲染（默认 `{base_branch}-{slug}`；`slug` 为空时用 `n{id}`）
   - 逐仓库执行 `git worktree add <path> -b <branch> <base_branch>`：**分支从子需求分支派生**，即以创建时刻 `base_branch` 的最新提交为基；分支已存在则复用（基线不同则报 `BRANCH_EXISTS_DIFFERENT_BASE`）
   - worktree 路径：`config.worktreeRoot`（默认空 = 与主仓库同级）下 `<仓库目录名>-wt-<slug>`
   - 幂等：路径已存在且是同一分支 → 跳过；已占用且非本分支 → 409 `WORKTREE_PATH_EXISTS`
3. 回填工作单元属性 `branch` 与 `unit_repos.branch` / `worktree_path`
4. 返回**开发提示词**（可直接复制给 AI）：节点路径与 id、涉及仓库与工作区路径、工作分支与基线、该节点的文档清单、常用命令（`doc upsert` / `commit add` / `merge run`）、提交与合并约定
5. 清理：`unit cleanup`（移除 worktree、删除已并入集成分支的分支）；**合并后默认保留**工作区与分支，避免 Diff 入口消失；清理需 `confirm`

### 7.11 代码集成与合并（显式）

1. 工作单元（`group` / `task`）已填 `branch` / `base_branch` 并登记涉及仓库（见 §7.10）；即使未创建工作区，只要本地已存在该分支也可直接合并
2. 「合并回子需求分支」（抽屉按钮或 `merge run`）→ 对每个相关仓库执行 `git merge-tree` 预检（内存三方合并，不碰工作区）
3. 预检无冲突 → 在本机仓库执行 `git merge --no-ff <source_branch>`（目标为集成分支；**不 push**）→ 写 `merges` 行（`state = merged` + `merge_sha`）
4. 预检有冲突 → 写 `merges` 行（`state = precheck_conflict` + 冲突文件），进入 §7.12
5. **批量**：一个子需求下的多个工作单元可一键按 `sort` 顺序逐个合并，遇冲突即停并返回已完成清单
6. 全程只读 + 本地写；不 push、不动远端分支

### 7.12 冲突处理

1. `GET /api/merges/:mid/conflicts` 返回每个冲突文件的 base / ours / theirs 与冲突块
2. 工具内：`ConflictPane`（CodeMirror MergeView）逐块「保留当前 / 采用传入 / 手改」
3. 产出：合并后的文件内容 + unified 补丁；可复制 / 下载 / 写入对应仓库的 worktree（`unit_repos.worktree_path`，若已填）
4. AI：`conflict show` 读三方 → `conflict resolve` 写回合并结果（同一能力暴露给 MCP / CLI）
5. 本地应用完成后「确认合并完成」→ 回填 `merge_sha`，`merges.state = resolved`；也可生成「交给 IDE 的提示词」
6. 放弃则调 `abort` → `aborted`（不改任何分支）

### 7.13 commit 预览

1. 节点抽屉「提交」区列出该节点**与子树**的 commits（按 commit 分组、标注来源节点与仓库）
2. 点某个 commit 或文件 → `GET /api/commits/:cid/diff`（或 `GET /api/nodes/:id/diffs`）→ 文件列表 + 每文件 diff
3. 视图：统一 / 分栏 / 全文（CodeMirror，行级高亮 + 未变行折叠）
4. 仓库解析：`repos.local_path` → 本机 git；否则 `repos.gitlab_project` → GitLab API；都没有 → `REPO_NOT_REGISTERED`

## 8. UI 设计

### 8.1 主界面：表格式展开树

- 顶部工具条：名称搜索、类型筛选、状态筛选、列显示设置（多选属性列）、新建项目、属性定义入口、设置入口
- 固定列：类型图标 + 名称（缩进体现层级）、状态（彩色标签，点击可快速切换）、**文档（📄 数量，点击打开右侧文档区）**、**提交（数量，含子树，点击打开预览）**、子节点数
- 动态属性列：取所有 `enabled` 的 `attr_defs` 并集，表头标注所属类型（如「需求·提测时间」）；可按列设置显示/隐藏（属性只含结构化短字段，不含正文）
- 展开/收起：`el-table` 树形数据（`row-key=id`，`children` 由 `/api/tree` 组装）
- 行操作：悬浮显示「+ 添加子节点」（`task` / `group` 行额外提供「+ 添加缺陷」）、「⋯ 菜单（移动到… / 删除）」
- 缺陷行：使用独立类型图标；为叶子节点，不显示「+ 添加子节点」
- 筛选与搜索在 v1 由前端完成（整树一次加载，节点量级为千级）
- **AI 变更实时可见**：每 10 秒轮询 `GET /api/revision`，版本号变化即刷新树与当前抽屉

### 8.2 右侧详情抽屉（默认宽 760px，可切「加宽」到窗口 70%）

分区：

1. 基本信息：类型、名称（可编辑）、状态、创建者 / 更新者（`user` / `ai` 徽标）与更新时间
2. **文档区**：左列文档名（＋新增 / 重命名 / ↑↓排序 / 删除）+ 右侧内容区（默认渲染预览，点「编辑」进 Markdown 编辑器）；表格「📄 数量」点击直接落在本区
3. 属性：按 `attr_defs` 动态渲染的表单 + 保存按钮（只有结构化短字段）
4. 子节点：子节点列表（点击跳转并展开对应行）
5. **提交**（`group` / `task` / `defect`）：登记表单（repo / sha / note）+ 列表（含子树，按 commit 分组、标注来源节点）+ 预览入口 + 合并状态徽标
6. **工作区 + 合并**（`group` / `task`）：`slug` / `branch` / `base_branch` + 涉及仓库与各仓库 worktree 状态；「创建工作区」（建分支 + worktree，多仓库）+「复制开发提示词」+「清理工作区」（默认保留）；「合并回子需求分支」按钮 + 预检结果 + 冲突入口（待处理冲突数）
7. MR（`subreq`）：列表（状态标签 + 标题链接到 GitLab）+「刷新 MR」按钮 + 上次拉取时间

### 8.3 属性定义管理页

表格展示 `attr_defs`（按 nodeType 分组）；行内/弹窗编辑 label、data_type、options（`select` 用标签式编辑器）、required、sort、enabled；新增时选择所属节点类型。

### 8.4 设置页

GitLab `base_url` 与 `token`（带「测试连接」按钮，返回当前用户与项目可达性）、端口、状态标签与每类可用状态集合。

### 8.5 冲突处理视图（ConflictPane）

- 左：冲突文件列表（带冲突块数）；右：MergeView（base / ours / theirs 三栏，或 ours–theirs 两栏 + base 折叠），每块提供「保留当前 / 采用传入 / 手改」
- 顶部：批量合并结果、上一个 / 下一个冲突块导航、「全部接受当前 / 全部接受传入」
- 底部：「导出补丁」「复制合并结果」「写入 worktree_path（若已填）」「确认合并完成」「放弃」

### 8.6 commit 预览视图（DiffPane）

- 左：commit 列表（按仓库分组；节点自身与子树 commit 用徽标区分）+ 文件列表（带 A / M / D 状态）
- 右：CodeMirror diff，视图切换统一 / 分栏 / 全文；未变行可折叠；行号 + 语法高亮；上一个 / 下一个变更快捷键（F7 / Shift+F7）

### 8.7 仓库登记入口

列表页工具条「仓库登记」：表格维护 `name` / `local_path` / `gitlab_project` / `note`，并提供「路径连通性检查」（路径存在且是 git 仓库）。

## 9. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 父子类型非法 / 跨级 | 400，返回允许的父类型 |
| 在叶子节点（`task` / `defect`）下建子节点 | 400，提示该类型为叶子节点 |
| 路径同名歧义 | 409，提示改用 `id` 引用 |
| 同节点内文档重名 | 409 `DOC_NAME_EXISTS`；UI 新增时自动加序号规避 |
| 破坏性操作未确认 | 400 `CONFIRM_REQUIRED`，提示加 `--confirm` / `confirm: true` |
| 移动到自身或后代（成环） | 400 |
| 必填属性缺失 / 类型不匹配 | 400，指出具体属性 label |
| sha 非法 | 400 |
| 同一节点重复登记同一 sha | 幂等，返回已存在记录 |
| 仓库未登记 / 本地路径不存在 | 400 `REPO_NOT_REGISTERED` / `REPO_PATH_MISSING`，提示先登记仓库 |
| 分支不存在（工作单元或集成分支） | 400 `BRANCH_NOT_FOUND` |
| 分支已存在但基线不同 | 400 `BRANCH_EXISTS_DIFFERENT_BASE`，提示确认或改用其他分支名 |
| worktree 路径已被占用 | 409 `WORKTREE_PATH_EXISTS` |
| 合并预检有冲突 | 返回 `precheck_conflict` + 冲突文件（**不改工作区、不落分支**），进入冲突处理 |
| 本机 git 不可用 / 命令失败 | 500 `GIT_UNAVAILABLE` / `GIT_FAILED`（`details` 带原始 stderr） |
| GitLab 未配置 | 400 + 「前往设置页配置」提示 |
| GitLab 401 / 404 | 502（`details` 区分 token 无效 / 项目路径错误） |
| GitLab 网络异常 / 超时（10s） | 502，既有 MR 数据不变 |
| 端口占用 | 自动 +1 重试至 3220，仍失败则报错退出 |
| 并发写入 | 单进程单写者；WAL 模式；接口层串行化写操作 |
| 上传文件类型 / 大小不合规 | 400，提示允许的格式（png / jpg / jpeg / gif / webp）与 10 MB 上限 |
| 数据备份 | 提示直接复制 `~/.taskboard/data.db` 与 `~/.taskboard/uploads/`（关闭进程后复制） |

错误码（AI 依赖，保持稳定）：`VALIDATION_FAILED`、`PARENT_TYPE_INVALID`、`LEAF_NODE`、`CYCLE_DETECTED`、`PATH_NOT_FOUND`、`PATH_AMBIGUOUS`、`DOC_NAME_EXISTS`、`CONFIRM_REQUIRED`、`UPLOAD_INVALID_TYPE`、`UPLOAD_TOO_LARGE`、`GITLAB_NOT_CONFIGURED`、`GITLAB_AUTH_FAILED`、`GITLAB_PROJECT_NOT_FOUND`、`GITLAB_UNAVAILABLE`、`REPO_NOT_REGISTERED`、`REPO_PATH_MISSING`、`BRANCH_NOT_FOUND`、`BRANCH_EXISTS_DIFFERENT_BASE`、`WORKTREE_PATH_EXISTS`、`MERGE_CONFLICT`、`GIT_UNAVAILABLE`、`GIT_FAILED`。

## 10. 测试策略

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
- **API 集成测试**：临时数据库 + `fetch` 直连服务跑主流程与错误分支
- **CLI 集成测试**：`taskboard` 子命令建树 / upsert / batch / import / dry-run / `--confirm` 语义
- **MCP 冒烟**：以 stdio 拉起 MCP server，逐个工具调用并校验返回（含错误码）
- **并发验证**：Web 与 CLI 同时写同一库（WAL + busy_timeout）不报错，`/api/revision` 单调递增
- **冒烟脚本** `npm run smoke`：起服务 → 建五级树 → 建缺陷 → 改属性 + 写文档 → 上传图片 → 建临时 git 仓库（含冲突场景）→ diff 预览 → 合并预检 → mock GitLab 刷新 MR → 登记 commit → 断言树与详情
- **手工验收清单**：拖拽排序、移动节点、抽屉动态表单、表格 📄 数量点击 → 右侧文档渲染、文档新增/重命名/排序/删除、Markdown 编辑与预览、图片粘贴上传、缺陷登记与状态流转、commit 预览（统一 / 分栏 / 全文 + 子树聚合）、Markdown 含 mermaid 图渲染、工作区准备（多仓库建分支 + worktree）、开发提示词复制、冲突处理（逐块接受 / 拒绝 → 补丁可应用）、仓库登记、列显示设置、设置页连通性测试

## 11. 后续演进（非 v1）

1. 多人共享：存储层换 MySQL / PostgreSQL，增加账号、权限与 `owner` 字段
2. commit 自动扫描（本地仓库或远端 GitLab API）
3. AI 自主运营：定时梳理结构 / 生成周报、缺陷聚类、自动回填 commit 等（在 v1 的 MCP / CLI 之上）
4. 统计与看板：工时、进度、需求各时间节点汇总
5. 导入导出（含从 dsh-charge 迁移历史数据）
6. 跨父拖拽、批量操作、通知提醒
7. 在 worktree 内自动完成合并与冲突解决（含自动 push 与 MR 创建）

## 12. 决策记录

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

## 13. 术语

| 术语 | 说明 |
|---|---|
| 项目 / 需求 / 子需求 / 任务组 / 子任务 | 五级树节点，任务组可任意嵌套，子任务为叶子 |
| 属性定义（attr_def） | 某个节点类型上的一项自定义属性（名称、类型、是否必填、选项等） |
| 属性值（attr_value） | 某个节点在某项属性上的取值 |
| 路径（path） | 从根项目开始的名称链（`项目A/需求1/子需求2`）；同名歧义时返回 409 |
| MCP server | 以 stdio 暴露工具的 AI 入口，与 CLI / Web 共用同一核心 |
| revision | 数据版本号，任何写入 +1，供前端轮询与 AI 判断变更 |
| actor | 操作者标记：`user` / `ai` / `cli` / `import` |
| MR | GitLab Merge Request，由系统按「项目 + 源分支」自动拉取 |
| 缺陷（defect） | 挂在任务 / 任务组下的缺陷节点；描述 / 复现步骤为预置文档，其他字段由属性系统定义 |
| 文档（document） | 挂在节点上的命名 markdown 文档，可多份、可排序；表格显示 📄 数量，右侧文档区渲染 / 编辑 |
| 集成分支 | 子需求的 `branch`，该子需求下所有工作单元最终汇入的分支 |
| 工作区（worktree） | 工具为工作单元创建的本地检出目录（`unit_repos.worktree_path`） |
| 开发提示词 | 工具生成的、可直接投喂 AI 的开发指令（含节点路径 / 工作区 / 分支 / 文档 / 登记与合并命令） |
| slug | 工作单元英文短名，用于分支命名（为空时用 `n{id}`） |
| 工作单元分支 | 任务组 / 子任务的工作分支，**从当前子需求分支派生**（`base_branch` 默认取子需求 `branch`，创建时以该分支最新提交为基） |
| 合并预检 | 用 `git merge-tree` 在内存做三方合并、判断是否冲突，不改工作区也不落分支 |
| 冲突块 | 三方合并中无法自动对齐的片段（base / ours / theirs 三方内容） |
| merges | 合并尝试记录（仓库 / 分支 / sha / 状态 / 冲突文件 / merge_sha） |
| commit 登记 | 手工把提交（repo + sha + 说明）挂到任务组 / 子任务 / 缺陷 |
