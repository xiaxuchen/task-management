# Layout Manager IDEA 插件

窗口布局管理（类似 Cocos 的 Window → Layout）：把当前的工具窗布局保存为命名预设，随时一键切换。

## 功能

**入口**：`Window → 布局管理`

- **保存当前布局…**：把当前所有工具窗的布局（显示/隐藏、停靠位置、宽高）存为命名预设
- **管理布局…**：列表（双击应用 / 选中删除）
- **已保存布局列表**：菜单内直接点击一键切换
- 持久化：应用级（全 IDE 通用，重启保留）

## 构建与安装

零依赖构建（javac + IDEA 自带 lib）：

```bash
./build.sh
cp -r dist/layout-manager "$HOME/Library/Application Support/JetBrains/IntelliJIdea2026.2/plugins/"
# 重启 IDEA 生效
```

## 关键实现点

- 布局对象：平台原生 `com.intellij.openapi.wm.impl.DesktopLayout`
  - 保存：`ToolWindowManagerEx.getLayout()` → `writeExternal("user")` → JDOM `Element` → XML 字符串
  - 恢复：XML → `JDOMUtil.load` → `DesktopLayout.readExternal(el, false)` → `ToolWindowManagerEx.setLayout(dl)`
- 持久化：应用级 `PropertiesComponent`（`xpLayoutManager.names` 名称索引 + `xpLayoutManager.layout.<name>` 布局 XML）
- 动态菜单：`ActionGroup.getChildren()` 实时列出已保存布局（`plugin.xml` 挂 `WindowMenu`）
