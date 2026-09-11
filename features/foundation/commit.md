# 提交记录（foundation）

- chore: task-board 仓库骨架与测试基座
- fix(errors): 错误码写入 err.name，String(err) 与断言可直接命中
- fix(test): helpers 对 store.mjs 容错，避免 db/config 用例连带失败
- fix(test): openDb 落在本次临时目录，保证同文件用例隔离
- feat(config): 默认配置、600 权限与 token 打码
- feat(db): 建表、索引与预置属性定义（WAL + 外键 + busy_timeout）
- docs(features): 落地「功能之家」约定（features/<功能>/{prd,design,commit}.md），并把设计文档权威副本纳入仓库 docs/design.md
- docs: 计划 1 数据层完成，更新 README 进度与功能索引状态
- docs(readme): 补快速开始（clone→install→build→start）、常用命令表、运行时数据表与文档导航表
  - 修正设计文档链接（原指向工作区 `../docs/superpowers/specs/`，clone 后不可用 → `docs/design.md`）
  - 补「提交约定」（提交时同步追加本功能 commit.md）
- docs(features): entrypoints 补静态托管缓存策略记录
