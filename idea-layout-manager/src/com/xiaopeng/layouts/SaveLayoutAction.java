package com.xiaopeng.layouts;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

/** 保存当前布局为命名预设 */
public class SaveLayoutAction extends AnAction {

    public SaveLayoutAction() {
        super("保存当前布局…", "把当前的工具窗布局保存为命名预设", null);
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
        e.getPresentation().setEnabled(e.getProject() != null);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) {
            return;
        }
        String name = Messages.showInputDialog(project, "布局名称（如：开发 / Review / 调试）：", "保存布局", null);
        if (name == null || name.trim().isEmpty()) {
            return;
        }
        try {
            LayoutStore.save(name.trim(), project);
            Messages.showInfoMessage(project, "已保存布局「" + name.trim() + "」", "布局管理");
        } catch (Exception ex) {
            Messages.showErrorDialog(project, "保存失败：" + ex.getMessage(), "布局管理");
        }
    }
}
