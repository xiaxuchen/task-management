# 提交记录：上线治理

- feat(release-governance): 上线治理闭环——release_items 表（上线配置 config / 上线 SQL sql / 上线检查 check + 回滚 + 状态 + 必做）按名 upsert 幂等、CRUD/筛选/排序、随节点级联删除；buildReleaseChecklist 按 self/subtree 聚合完成度/按类型分布/就绪结论/阻塞项（无必做项 ready=null）；编排层 runReleaseChecks（上线清单 + code_check/biz_check/release_check 用例拼提示词派单 + 自动开 running 报告）+ composeReleaseCheckPrompt + renderReleaseChecklistMd；三入口（HTTP/CLI/MCP）1:1；补 18 条单测 + 4 条 HTTP 集成测试 + 老库迁移断言；顺修 TEST_CASE_NAME_EXISTS 漏登记 STATUS_BY_CODE 导致重名用例返回 500 的既有缺陷
