package com.xiaopeng.layouts;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

/** 应用某个已保存布局 */
public class ApplyLayoutAction extends AnAction {

    private final String name;

    public ApplyLayoutAction(String name) {
        super(name);
        this.name = name;
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) {
            return;
        }
        try {
            LayoutStore.apply(name, project);
        } catch (Exception ex) {
            Messages.showErrorDialog(project, "应用布局失败：" + ex.getMessage(), "布局管理");
        }
    }
}
