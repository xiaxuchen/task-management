# Task Board IDEA 插件

在 IntelliJ IDEA 内完成"节点级 Review"：需求树 → 提交/合并状态 → 原生 Diff → 审查 → 对照需求文档 → 测试运行。

## 功能

| 区域 | 能力 |
|---|---|
| **任务视图（工具窗）** | 需求树双击进入 Review；工具窗另含「网页」（内嵌 task-board 前端）tab |
| **Review 工作区** | 默认全选 commit → 右侧展示**合并变更**（文件并集 + 净 old/new，按仓库分组、路径压缩、原生图标与绿/红统计）；「提交列表」按钮展开勾选调整范围 |
| **commit 审查** | 勾选后批量：标记通过 / 标记有问题（意见）/ 重置待审；汇总计数与「仅看待审」 |
| **链式 Diff** | 双击文件/commit → 编辑器区打开该 commit（或合并变更）的**全部文件 diff**（`SimpleDiffRequestChain`，平台自带上一/下一文件导航与 F7 变更导航，定位到点击文件） |
| **需求 + 概设** | 节点文档（需求内容/设计方案）合并为 markdown，**右侧分屏**打开对照 diff；头部含 PRD 飞书链接行 |
| **PRD（飞书）** | 编辑器区 tab（自定义 FileEditor + JCEF），首次登录后持久；`prdAnchor` 节点属性支持锚点定位 |
| **对照布局** | 一键铺排：左 diff + 右 需求+概设（编辑器区分屏） |
| **测试运行** | 写提示词 → qodercli（DeepSeek-Flash）在关联仓库执行，输出 2s 轮询 + 历史 |
| **IDE 桥** | 每 3s 轮询 task-board 的 `ide_requests`，网页点「在 IDEA 查看」自动打开（单 commit 定位文件 / 多 commit 合并变更） |

## 构建与安装

零依赖构建（javac + IDEA 自带 lib，无需 Gradle/网络）：

```bash
./build.sh
cp -r dist/task-board-idea "$HOME/Library/Application Support/JetBrains/IntelliJIdea2026.2/plugins/"
# 重启 IDEA 生效
```

- 依赖：本机 task-board 服务运行于 `http://127.0.0.1:3210`
- JCEF 为**可选依赖**（未启用时：「网页」/「PRD」自动降级）

## 关键实现点

- `CheckboxTree` 的刷新必须用**其内部 model**（`reviewTree.getModel()`），外部 model 不触发界面更新
- 链式 Diff：`DiffManager.showDiff(project, SimpleDiffRequestChain, DiffDialogHints.DEFAULT)`
- PRD tab：`PrdVirtualFile`（LightVirtualFile） + `PrdFileEditor`（JCEF，extends UserDataHolderBase） + `FileEditorProvider`（HIDE_DEFAULT_EDITOR）
- diff 打开时按文件名取 FileType（`FileTypeManager`）以启用语法高亮
- 平台图标体系：`AllIcons` / `FileType.getIcon()`；工具栏用 ActionToolbar 原生样式
