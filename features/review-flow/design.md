# 设计 · 审查流（问题闭环）

## 数据

复用现有 `commits` 表：`review_status`（pending/approved/issue）+ `review_note`（问题意见）。
「标记有问题…」经 `JOptionPane.showInputDialog("问题说明（可空）")` 录入，`updateCommitReview` 落库。

## 展示（commit 信息区）

`setCommitInfos(List<String> htmls)` 统一渲染（JBLabel 逐条 + 分隔线）。

- **单 commit（buildDetail）**：commitInfo 之后追加一条
  `<font color='#D43A3A'><b>⚠ 问题：</b></font> + reviewNote`
- **多 commit（buildCombinedDetail）**：遍历勾选 `sel`，收集 `reviewStatus=='issue'` 的条目，
  拼「⚠ 待解决问题（N）」段落（sha + note + 意见原文）**插入 `infos[0]` 置顶**

## 审批拦截

`markApproved()` 替代原匿名 `markChecked("approved", null)`：

1. 勾选为空 → 提示
2. 扫描 `sel` 中 `issue` 状态 → 有则 `Messages.showWarningDialog` 列出清单（标题「无法标记通过」），**不执行**
3. 无 issue → 走原 `markChecked("approved", null)`

## 缺陷登记与 AI 修复（已交付）

**登记**（Review 顶栏「登记缺陷」）：
1. 输入标题（showInputDialog）+ 描述（showMultilineInputDialog）
2. 自动取 diff 上下文（焦点编辑器或 `lastSelectionEditor` 回退）→ 文件/行号/选中片段
3. `POST /api/nodes { parentId=当前节点, type=defect, name=标题 }` 创建缺陷节点
4. `documents/upsert` 写「缺陷描述」文档（标题 + 描述 + 位置 + 选中代码）
5. 弹窗询问「派给 Qoder / 稍后」

**驱动 AI**（选「派给 Qoder」）：
- `dispatchDefectToQoder`：提示词 = 缺陷标题 + 描述 + 位置（文件/行号）+ 选中代码 + 修复要求
  （含"可使用 task-board MCP 工具回写状态"）
- 经 `QoderOpener.dispatch`：打开 Qoder 面板 + 新会话 + 剪贴板就绪 → ⌘V+回车

**闭环**：缺陷节点在树中可见 → 双击进 Review（可挂修复 commit）→ 审查通过。

## 后续候选

- 在 IDEA 内以 Markdown 编辑节点文档
- 问题闭环状态机（issue → fixed → verified）+ 后端强约束
