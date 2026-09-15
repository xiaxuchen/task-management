# 提交记录：主链路集成收口

- merge(mainline-integration): 主链路集成收口——按依赖顺序把 5 条能力分支合入 main 并跑通端到端回归：xpx-119 文档版本历史 → xpx-122 验收签收（栈在 119 之上）→ xpx-120 需求管理 → xpx-113 概要设计大纲 → xpx-126 思维导图。集成中修 6 处跨分支契约冲突（预置文档 4→5、applyDesignOutline created 语义、dryRun 断言对象、MCP 审计 actor 落点、决策编号撞号、CLI 单层/两层命令共用 switch），每处都带断言。新增 scripts/e2e-mainline.mjs：只走 CLI/HTTP 公开入口，覆盖需求管理→概要设计→文档→思维导图→用例→报告→验收签收→上线治理→交付门禁九段，并断言门禁「无证据 not_ready / 证据齐备 ready」两态而非无脑绿灯；test/e2e-mainline.test.mjs 把它作为守门测试；npm run e2e:mainline 一键复现。验证：npm test 327 条 0 失败、npm run build 通过、e2e 退出码 0。
