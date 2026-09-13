package com.xiaopeng.taskboard;

import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.impl.SimpleDataContext;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;

import java.awt.datatransfer.StringSelection;

/**
 * 派任务给 Qoder IDE（插件前台 Agent）：
 * 1) 提示词写入剪贴板；2) 激活 Qoder 工具窗；3) 尝试触发「新会话」动作。
 *
 * 说明：Qoder 未开放"程序化发送消息"的契约 API（sendRequest 由 UI 组件经 DataKey 提供），
 * 故以"剪贴板就绪 + 新会话"实现半自动派单——粘贴（⌘V）+ 回车即发送。
 */
public final class QoderOpener {

    private QoderOpener() {
    }

    /** 打开 Qoder 并就绪提示词；返回是否成功打开面板（false 时调用方提示手动操作） */
    public static boolean dispatch(Project project, String prompt) {
        try {
            CopyPasteManager.getInstance().setContents(new StringSelection(prompt));
        } catch (Throwable ignore) {
            // 剪贴板失败不阻断
        }
        try {
            ToolWindow tw = ToolWindowManager.getInstance(project).getToolWindow("Qoder");
            if (tw == null) {
                return false;
            }
            tw.activate(null);
            // 尝试开新会话（动作可能依赖焦点；失败则用户手动 Alt+N）
            try {
                AnAction newSession = ActionManager.getInstance().getAction("QoderOpenNewSessionTabAction");
                if (newSession != null) {
                    newSession.actionPerformed(AnActionEvent.createFromAnAction(
                            newSession, null, "TaskBoard", SimpleDataContext.EMPTY_CONTEXT));
                }
            } catch (Throwable ignore) {
                // 新会话触发失败不阻断
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
