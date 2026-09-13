package com.xiaopeng.taskboard;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import org.jetbrains.annotations.NotNull;

/** 注册 TaskBoard 工具窗口：任务面板 + 内嵌网页（JCEF） */
public class TaskBoardToolWindowFactory implements ToolWindowFactory {

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        TaskBoardPanel panel = new TaskBoardPanel(project);
        Content content = ContentFactory.getInstance().createContent(panel, "任务", false);
        toolWindow.getContentManager().addContent(content);
        panel.reloadTree();

        // 内嵌网页视图：JCEF（Chromium）直接加载 task-board 前端（Vue3 + Element Plus）
        // JCEF 为可选依赖（用户可能禁用该模块），全部放入 try/catch(Throwable) 防御
        try {
            if (JBCefApp.isSupported()) {
                JBCefBrowser browser = new JBCefBrowser(TaskBoardApi.DEFAULT_BASE);
                // 合理的偏好尺寸：避免底部停靠时内容偏好把工具窗撑高
                browser.getComponent().setPreferredSize(new java.awt.Dimension(900, 320));
                Content webContent = ContentFactory.getInstance()
                        .createContent(browser.getComponent(), "网页", false);
                webContent.setDisposer(browser);
                toolWindow.getContentManager().addContent(webContent);
            }
        } catch (Throwable t) {
            // JCEF 模块禁用或初始化失败时跳过网页视图，不影响任务面板
        }
    }
}
