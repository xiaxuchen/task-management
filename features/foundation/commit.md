# 提交记录（foundation）

- chore: task-board 仓库骨架与测试基座
- fix(errors): 错误码写入 err.name，String(err) 与断言可直接命中
- fix(test): helpers 对 store.mjs 容错，避免 db/config 用例连带失败
- fix(test): openDb 落在本次临时目录，保证同文件用例隔离
- feat(config): 默认配置、600 权限与 token 打码
- feat(db): 建表、索引与预置属性定义（WAL + 外键 + busy_timeout）
- docs(features): 落地「功能之家」约定（features/<功能>/{prd,design,commit}.md），并把设计文档权威副本纳入仓库 docs/design.md
- docs: 计划 1 数据层完成，更新 README 进度与功能索引状态
