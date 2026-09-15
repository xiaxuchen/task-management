# 设计：工程基座与配置（foundation）

## 1. 模块与职责

| 文件 | 职责 | 不做 |
|---|---|---|
| `server/errors.mjs` | 稳定错误码 `CODES`、`AppError`、`fail()` | 不做 HTTP 状态码映射（计划 2） |
| `server/config.mjs` | `config.json` 读写、默认值、600 权限、token 打码；导出 `DB_PATH` / `UPLOAD_DIR` | 不校验业务字段 |
| `server/db.mjs` | `openDb()` 打开库、建表建索引、预置；导出 `CHILD_TYPES` / `LEAF_TYPES` | 不做业务校验（属 store） |
| `test/helpers.mjs` | 每个用例一个临时 HOME + 独立库文件 | 不含断言 |

## 2. 关键设计

- **HOME 在模块 import 时确定**：`const HOME = process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard')`。ESM 模块只求值一次，所以同一测试文件内改 `TASKBOARD_HOME` 不会换目录；用例隔离靠 `openDb(file)` 显式指向本次临时目录下的 `data.db`。
- **错误码写进 `err.name`**：`String(err)` 输出 `PARENT_TYPE_INVALID: <人话>`；`err.message` 不重复码值（HTTP 层的 `message` 保持干净）。
- **建表 + 预置幂等**：`CREATE TABLE IF NOT EXISTS`；以「`attr_defs` 计数为 0」作为播种条件；后续 schema 变更在 `db.mjs` 内追加幂等迁移块。
- **快照主键重映射**：文本快照导入统一清空后按依赖顺序重建；除 nodes/attrs/repos 外，documents 也建立旧→新 id 映射，供 `document_versions` 重写外键；test_cases 建立映射供 `test_reports.case_id` 重写（`run_id` 指向的 agent 运行日志不随快照迁移，导入置 null）；`acceptance_signoffs` 随 nodes 重映射。
- **父子类型单一事实来源**：`CHILD_TYPES`（父 → 允许的子类型数组），空数组即叶子；store 的类型校验只读它，不在别处重复定义。

## 3. 对外接口

```js
// errors.mjs
CODES                       // { VALIDATION_FAILED, PARENT_TYPE_INVALID, LEAF_NODE, CYCLE_DETECTED, NOT_FOUND, PATH_NOT_FOUND, PATH_AMBIGUOUS, DOC_NAME_EXISTS, CONFIRM_REQUIRED }
class AppError extends Error // .name = 错误码, .code, .details
fail(code, message, details) // 抛 AppError

// config.mjs
HOME_DIR, CONFIG_PATH, DB_PATH, UPLOAD_DIR, DEFAULT_CONFIG
loadConfig()  // 不存在则生成默认并返回
saveConfig(patch) // 局部深度合并后落盘（600）
maskToken(cfg)    // token → '****'

// db.mjs
CHILD_TYPES, LEAF_TYPES
openDb(file = DB_PATH) // DatabaseSync，已开 WAL / 外键 / busy_timeout，已建表与预置
```

## 4. 与主设计文档的对应

§4.9（预置属性定义逐条对应 `SEED_ATTR_DEFS`）、§4.10（config 默认值逐字段对应 `DEFAULT_CONFIG`）、§4.11–4.12（`merges` / `unit_repos` 建表已就位，读写留给计划 4）、§9（错误码清单，本功能只落数据层需要的那些）。
