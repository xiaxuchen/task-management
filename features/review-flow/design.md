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

## 后续候选

- 「新建缺陷」：插件登记 defect 节点（关联当前节点）
- 问题闭环状态机（issue → fixed → verified）+ 后端强约束
- 在 IDEA 内以 Markdown 编辑节点文档
