# Task Board IDEA 插件

在 IntelliJ IDEA 内完成"节点级 Review"：需求树 → 提交/合并状态 → 原生 Diff → 审查 → 对照需求文档 → 测试运行。

## 功能

| 区域 | 能力 |
|---|---|
| **任务视图（工具窗）** | 需求树双击进入 Review；另含「网页」（内嵌 task-board 前端）tab；对照布局时自动停靠底部（高 30% 可调） |
| **Review 工作区** | 默认全选 commit → 右侧展示**合并变更**（文件并集 + 净 old/new，按仓库分组、路径压缩、原生图标与绿/红统计）；「提交列表」展开勾选调整范围 |
| **commit 审查** | 勾选后批量：标记通过 / 标记有问题（意见）/ 重置待审；汇总计数与「仅看待审」 |
| **链式 Diff** | 编辑器区打开全部文件 diff（`SimpleDiffRequestChain`，上一/下一文件导航 + F7）；多 commit 走合并变更 |
| **对照布局** | 一键铺排：**左 diff（宽 50% 可调）+ 右列（需求概设 ⇄ 飞书 PRD 双 tab）+ TaskBoard 底部（高 30% 可调）**；重铺前自动清场（tab/分屏不堆积） |
| **显隐开关** | 顶栏 **☑ diff / ☑ 文档** 开关（勾选=显示、状态实时）——收起文档→diff 全宽；收起 diff→文档全宽 |
| **布局设置** | diff 宽度% / TaskBoard 高度% 可配；拖分隔条自动记忆（应用级持久化） |
| **PRD（飞书）** | 编辑器区 tab（自定义 FileEditor + JCEF），首次登录后持久；`prdAnchor` 支持锚点定位 |
| **测试运行** | 「▶ 后台运行（qodercli）」或「⚡ 在 Qoder IDE 运行（前台）」（run#id 绑定，Agent 完成后 MCP 回写） |
| **Qoder 联动** | 「派给 Qoder」派单（激活面板+新会话+提示词就绪）；「复制上下文」；**选区自动捕获**（零点击，Qoder 提问时 hook 自动注入选中代码/任务上下文，见 `features/qoder-integration/`） |
| **IDE 桥** | 每 3s 轮询 `ide_requests`，网页点「在 IDEA 查看」自动打开（单 commit 定位文件 / 多 commit 合并变更） |

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
- 布局显隐：空分屏组由平台自动收起；「收起文档」需先定位文档所在组（关内容前），并清掉组内残留的 diff 副本（`closeFile(vf, window)`）以防"露出重复 diff"
- 工具窗高度：`stretchHeight(value)` 是**增量**（当前高度 + value）而非目标值——传差值保证幂等（平台源码 `ToolWindowPane.stretch`）；面板需给合理 preferred 尺寸防内容撑高
- 开关观感：`ToggleAction` 覆写 `update()` 加 ☑/☐ 前缀 + Checked 图标；点击后 `ActionToolbar.updateActionsImmediately()` 即时刷新
- 选区捕获：`EditorFactory.getEventMulticaster().addSelectionListener(listener, project)`（project 作为 Disposable 自动清理）
- Qoder 边界：插件无"程序化发送消息"契约 API；派单止步于"面板+剪贴板"，最后一步人工 ⌘V+回车（详见 `features/qoder-integration/design.md`）
