# 4. 数据模型

> 本文是主设计文档 [`../design.md`](../design.md) 的拆分章节；索引与章节导航见该文件。


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

