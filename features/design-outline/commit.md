# 提交记录：概要设计大纲 / 思维导图

- feat(design-outline): 概要设计大纲 / 思维导图——补上「需求管理 → 概要设计 → 文档」主线的生成侧。buildDesignOutline 从用户已在维护的需求树（子需求 / 任务组 / 子任务 / 缺陷）只读推导结构树与计数（不落表、不动 revision）；renderDesignOutlineMd 产出可写入「概要设计」文档的 markdown 骨架（mermaid mindmap + 逐层小节，节点名做 mermaid 语法转义）；applyDesignOutline 经 upsertDocument 落库，文档名复用 config.readiness.designDoc 保证与需求就绪门禁判定同一份文档，默认不覆盖已填内容（overwrite 显式放行），支持 dryRun 预演；三入口 1:1（GET/POST /api/nodes/:id/design-outline[/apply] · CLI design outline|apply · MCP design_outline / design_outline_apply）+ NodeDrawer「概要设计」页签；补 25 条 UT（结构推导 / scope 值域 / 只读语义 / mermaid 转义 / 覆盖策略 / 三入口契约）
