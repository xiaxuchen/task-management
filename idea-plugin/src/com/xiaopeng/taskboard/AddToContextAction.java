package com.xiaopeng.taskboard;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import org.jetbrains.annotations.NotNull;

/**
 * 全局动作：把"当前选中"加入 Qoder 上下文池（可多次累积，多文档/多文件）。
 *
 * 选中来源（自动识别）：
 *  - 编辑器（代码 / 需求概设 Markdown / diff 视图）→ 编辑器选区文本
 *  - JCEF 网页（飞书 PRD 云文档 / Markdown 预览）→ window.getSelection()
 *
 * 快捷键：Ctrl+Shift+Alt+C（Mac 为 Control+Shift+Option+C；避开被 IDEA 占用的 Cmd+Alt+C 重构键）；亦在编辑器右键菜单。
 * 上下文池写入 ~/.taskboard/selected-snippets.md，hook 注入（30 分钟内新鲜即带，触发词放宽到 2h）。
 */
public class AddToContextAction extends AnAction {

    public AddToContextAction() {
        super("加入 Qoder 上下文", "把当前选中内容（代码 / Markdown / 云文档）追加到 Qoder 上下文池（可多次）", null);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        TaskBoardPanel p = TaskBoardPanel.lastInstance();
        if (p != null) {
            p.addSelectionToContextGlobal();
        }
    }
}
