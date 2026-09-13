package com.xiaopeng.layouts;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.ui.components.JBScrollPane;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.util.List;

/** 管理已保存布局：列表 + 删除 / 应用 */
public class ManageLayoutsAction extends AnAction {

    public ManageLayoutsAction() {
        super("管理布局…");
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
        new ManageDialog(project).show();
    }

    private static class ManageDialog extends DialogWrapper {

        private final Project project;
        private final DefaultListModel<String> model = new DefaultListModel<>();
        private final JList<String> list = new JList<>(model);

        ManageDialog(Project project) {
            super(project);
            this.project = project;
            setTitle("管理布局");
            refresh();
            init();
        }

        private void refresh() {
            model.clear();
            List<String> names = LayoutStore.names();
            for (String n : names) {
                model.addElement(n);
            }
        }

        @Override
        protected @Nullable JComponent createCenterPanel() {
            JPanel p = new JPanel(new BorderLayout(8, 8));
            p.add(new JLabel("已保存的布局（双击应用）："), BorderLayout.NORTH);
            list.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
            list.addMouseListener(new java.awt.event.MouseAdapter() {
                @Override
                public void mouseClicked(java.awt.event.MouseEvent e) {
                    if (e.getClickCount() == 2) {
                        applySelected();
                    }
                }
            });
            p.add(new JBScrollPane(list), BorderLayout.CENTER);

            JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            JButton apply = new JButton("应用");
            JButton delete = new JButton("删除");
            apply.addActionListener(e -> applySelected());
            delete.addActionListener(e -> {
                String sel = list.getSelectedValue();
                if (sel != null) {
                    LayoutStore.remove(sel);
                    refresh();
                }
            });
            buttons.add(apply);
            buttons.add(delete);
            p.add(buttons, BorderLayout.SOUTH);
            p.setPreferredSize(new Dimension(360, 300));
            return p;
        }

        private void applySelected() {
            String sel = list.getSelectedValue();
            if (sel == null) {
                return;
            }
            try {
                LayoutStore.apply(sel, project);
            } catch (Exception ex) {
                com.intellij.openapi.ui.Messages.showErrorDialog(project, "应用布局失败：" + ex.getMessage(), "布局管理");
            }
        }

        @Override
        protected Action @NotNull [] createActions() {
            return new Action[]{getOKAction()};
        }
    }
}
