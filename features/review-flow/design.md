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

## 缺陷登记与 AI 修复（已交付，三段式流程）

**登记**（Review 顶栏「登记缺陷」）：
1. **单对话框**（`DefectDialog`：标题 + 描述 + 位置只读展示，一个窗口搞定）
2. 自动取 diff 上下文（焦点编辑器或 `lastSelectionEditor` 回退）→ 文件/行号/选中片段
3. `POST /api/nodes { parentId=当前节点, type=defect }` 创建缺陷节点
4. `documents/upsert` 写「缺陷描述」文档
5. 弹窗：「分析根因 / 稍后」

**三段式流程**（合法提交前置）：

| 环节 | 按钮 | 行为 |
|---|---|---|
| ① 分析 | 「分析根因」 | 派 Qoder（`defect_analyze` 模板）输出 root cause + 修复方案；结果由 Qoder 经 MCP 回写文档「根因与修复方案」 |
| ② 审批 | 「批准修复」 | 读「根因与修复方案」（空则拒绝）→ 弹窗展示方案 → 确认后写「修复方案审批」文档（已批准/审批人/时间） |
| ③ 修复 | 「按方案修复」 | **检查审批文档含"已批准"**（否则拦截）→ 派 Qoder（`defect_dispatch` 模板，含已批准方案）实施 |

**提示词模板机制**：
- 存储：`config.json` 的 `promptTemplates`（默认三套：`defect_analyze` / `defect_dispatch` / `task_dispatch`）
- 变量：`{{defectId}} {{title}} {{desc}} {{locationSection}} {{analysisSection}}` 等，插件 `applyTemplate` 注入
- 配置入口：网页 **设置页「提示词模板」编辑区**（保存后即时生效；服务不可用时插件用内置兜底模板）

**闭环**：缺陷节点在树中可见 → 三段式修复 → 修复提交登记回缺陷节点 → 审查通过。

## 后续候选

- 在 IDEA 内以 Markdown 编辑节点文档
- 问题闭环状态机（issue → fixed → verified）+ 后端强约束
