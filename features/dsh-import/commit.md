# dsh-charge 需求同步导入功能提交记录

- feat(import): dsh-charge 需求导入脚本（server/import-dsh.mjs）
  - 支持 --dry-run 预演
  - 映射 requirement/subreq/subtask/sql_items 到 task-board 节点/属性/文档
  - 幂等写入，自动创建 attr_def
- refactor(import): 按 task-board 规格重写映射（非字段级搬运）
  - 文档名改用 docPresets 预置名「需求内容」（原自造「需求说明/需求描述/任务描述」）
  - 属性改用规格预置 key branch/baseline/gitlab_project；扩展属性仅保留 req_no/feishu_url/branch/test_report_url
  - 状态按语义映射 planned→todo、reviewing/developing→doing、merged/done→done（原硬编码 done，丢失全部进度）
  - 逐项剔除同名同内容的「登记单元」子任务（75→41，剔除 34）；原按 subreq 下数量判定，漏剔 2 个
  - 名称剥离「- 概要设计」「- 小优化」等流程后缀，原名保留在文档开头便于追溯
  - 新增 --reset（级联清理旧树后重建）
  - 长文本归文档（note/task_desc/verify_note 平均 1–2 千字）、属性只放结构化短字段