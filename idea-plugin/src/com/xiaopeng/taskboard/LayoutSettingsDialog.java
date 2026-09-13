package com.xiaopeng.taskboard;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;

/** 对照布局比例设置：diff 宽度比例 / TaskBoard 高度比例（保存后即时应用） */
public class LayoutSettingsDialog extends DialogWrapper {

    private final JSpinner diffSpinner;
    private final JSpinner toolWindowSpinner;
    private final Runnable onApplied;

    public LayoutSettingsDialog(Project project, Runnable onApplied) {
        super(project);
        this.onApplied = onApplied;
        setTitle("布局比例设置");
        diffSpinner = new JSpinner(new SpinnerNumberModel((int) (LayoutPrefs.diffRatio() * 100), 30, 85, 5));
        toolWindowSpinner = new JSpinner(new SpinnerNumberModel((int) (LayoutPrefs.toolWindowRatio() * 100), 15, 50, 5));
        init();
    }

    @Override
    protected @Nullable JComponent createCenterPanel() {
        JPanel p = new JPanel(new BorderLayout(8, 8));
        JPanel grid = new JPanel(new GridLayout(2, 2, 8, 8));
        grid.add(new JLabel("diff 视图宽度（%）："));
        grid.add(diffSpinner);
        grid.add(new JLabel("TaskBoard 高度（%）："));
        grid.add(toolWindowSpinner);
        p.add(grid, BorderLayout.CENTER);
        p.add(new JLabel("<html><font color='#808080'>保存后立即应用到已铺的对照布局；未铺过时作为下次默认值。<br>"
                + "另：拖动分隔条也会自动记住比例。</font></html>"), BorderLayout.SOUTH);
        return p;
    }

    @Override
    protected void doOKAction() {
        LayoutPrefs.setDiffRatio(((Number) diffSpinner.getValue()).floatValue() / 100f);
        LayoutPrefs.setToolWindowRatio(((Number) toolWindowSpinner.getValue()).floatValue() / 100f);
        if (onApplied != null) {
            try {
                onApplied.run();
            } catch (Throwable ignore) {
                // 应用失败不阻断关闭
            }
        }
        super.doOKAction();
    }
}
