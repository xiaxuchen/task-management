# 设计 · Diff 行级评论

## 数据模型（`comments` 表）

| 字段 | 说明 |
|---|---|
| node_id | 所属任务节点（外键级联删除） |
| repo / file_path | 仓库名（可空）+ 文件路径（必填） |
| commit_sha | 可选绑定（单选提交时写入） |
| line_start / line_end | 行号范围（1-based） |
| snippet | 选中片段（≤500 字，便于行号漂移后人工对齐） |
| content / author / status | 内容 / 作者 / open·resolved |
| created_at | 创建时间 |

索引：`idx_comments_node(node_id, file_path)`。

## 三入口（1:1）

- **HTTP**：`POST /api/nodes/:id/comments`、`GET /api/nodes/:id/comments?filePath=`、
  `GET /api/comments?filePath=&commitSha=`（按文件全库查）、`PATCH /api/comments/:cid`、`DELETE /api/comments/:cid`
- **MCP**：`comment_add / comment_list / comment_update / comment_remove`
- **测试**：`test/comments.test.mjs`（创建/节点查/文件查/更新/删除 + 空内容拒绝）

## 插件侧

- **取"评论上下文"**（`diffFileAndLines`）：复用「选中来源解析」的 diff 虚拟文件回退链
  （ChainDiff → `currentDiffFilePath`；diff 内容 vf → 回退当前链式 diff），取选中起始/结束行与片段
- **「评论」按钮**：`Messages.showMultilineInputDialog` 输入 → `api.addComment`（单选提交时附带 sha）
- **「评论列表」按钮**：`api.listComments(nodeId)` → 弹窗（●待处理/✓已处理 + 计数 + 文件 L 行号）

## v2 候选（未做）

- diff 行尾 **Inlay 💬 N**（`InlayModel.addAfterLineEndElement`）就地显示评论数、点击展开
- 行号漂移重定位（基于 snippet 模糊匹配）
- 评论状态流转的 UI 操作（现在只能经 MCP/HTTP 改 resolved）
