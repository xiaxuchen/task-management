# 提交记录：回归测试闭环

- feat(regression-loop): AI 可回归测试闭环——test_cases/test_reports 两表 + 用例 upsert/CRUD/排序、报告开启与终态回写、验收报告聚合（最近结果/通过率/未执行口径）；编排层 runTestCases（拼提示词派单到 agent 运行时并自动开 running 报告）+ composeTestPrompt + renderAcceptanceMd；三入口（HTTP/CLI/MCP）1:1；kind 预留 code_check/biz_check/release_check 扩展点；补 17 条单测 + 3 条 HTTP 集成测试
- fix(regression-loop): 补登 TEST_CASE_NAME_EXISTS → STATUS_BY_CODE 409——重名用例此前漏映射走默认 500，与设计文档 §9 和 AI 自纠预期不符；HTTP 用例补断言响应码（随 release-governance 提交入库）
