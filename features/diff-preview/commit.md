# commit 在线预览功能提交记录

> 状态：**已实现**（单 commit 详细 diff + 节点/子树聚合概览；统一 / 分栏视图）。

- docs(diff-preview): 建立功能文档 —— prd（需求 + 接口表 + 验收标准）、design（设计要点 + 关联章节 + 注意事项）
- feat(diff-preview): 本机 git diff 能力（commit_diff / node_diffs 三入口 1:1）+ DiffPane（CodeMirror MergeView，统一/分栏）+ 测试