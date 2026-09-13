package com.xiaopeng.taskboard;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;

/** 缺陷登记对话框：单窗口填写「标题 + 描述」，附当前 diff 位置只读展示 */
public class DefectDialog extends DialogWrapper {

    private final Project project;
    private final JTextField titleField = new JTextField(36);
    private final JTextArea descArea = new JTextArea(6, 36);
    private final String[] diffInfo;

    public DefectDialog(Project project, String[] diffInfo) {
        super(project);
        this.project = project;
        this.diffInfo = diffInfo;
        setTitle("登记缺陷");
        init();
    }

    @Override
    protected @Nullable JComponent createCenterPanel() {
        JPanel p = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(4, 4, 4, 4);
        c.anchor = GridBagConstraints.NORTHWEST;
        c.fill = GridBagConstraints.HORIZONTAL;

        c.gridx = 0;
        c.gridy = 0;
        p.add(new JLabel("标题："), c);
        c.gridx = 1;
        c.weightx = 1;
        p.add(titleField, c);

        c.gridx = 0;
        c.gridy = 1;
        c.weightx = 0;
        p.add(new JLabel("描述："), c);
        c.gridx = 1;
        c.weightx = 1;
        c.fill = GridBagConstraints.BOTH;
        c.weighty = 1;
        descArea.setLineWrap(true);
        descArea.setWrapStyleWord(true);
        p.add(new JScrollPane(descArea), c);

        if (diffInfo != null) {
            c.gridx = 0;
            c.gridy = 2;
            c.gridwidth = 2;
            c.weighty = 0;
            c.fill = GridBagConstraints.HORIZONTAL;
            JLabel loc = new JLabel("<html><font color='#888'>位置：" + esc(diffInfo[0]) + " · L"
                    + diffInfo[1] + "-" + diffInfo[2] + "（自动附带）</font></html>");
            p.add(loc, c);
        }
        p.setPreferredSize(new Dimension(560, 320));
        SwingUtilities.invokeLater(titleField::requestFocusInWindow);
        return p;
    }

    public String getDefectTitle() {
        return titleField.getText() == null ? "" : titleField.getText().trim();
    }

    public String getDefectDesc() {
        return descArea.getText() == null ? "" : descArea.getText().trim();
    }

    @Override
    protected void doOKAction() {
        if (getDefectTitle().isEmpty()) {
            Messages.showWarningDialog(project, "标题不能为空", "登记缺陷");
            return;
        }
        super.doOKAction();
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("<", "&lt;").replace(">", "&gt;");
    }
}
