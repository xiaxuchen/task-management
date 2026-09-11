# dsh-charge 需求同步导入功能提交记录

- feat(import): dsh-charge 需求导入脚本（server/import-dsh.mjs）
  - 支持 --dry-run 预演
  - 映射 requirement/subreq/subtask/sql_items 到 task-board 节点/属性/文档
  - 幂等写入，自动创建 attr_def