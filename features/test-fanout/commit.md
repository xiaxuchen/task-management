# 提交记录：并行派单（test-fanout）

- feat(test-fanout): 回归测试并行派单——runTestCases 新增 fanout 分支（每条用例一个独立 agent 任务 / 独立提示词 / 独立报告，mode=fanout 返回 runs[] + tasks[]），缺省 grouped 保持向后兼容；maxParallel 调用级护栏（缺省 4、上限 16，超出显式拒绝而非静默截断，值域非法一律 VALIDATION_FAILED）；三入口 1:1（HTTP body / CLI --fanout --max-parallel / MCP schema）；CLI settleCliDispatch 升级为等待一组 run 终态；dryRun 只回报任务与逐条提示词、不落库不动 revision；补 test/test-fanout.test.mjs
