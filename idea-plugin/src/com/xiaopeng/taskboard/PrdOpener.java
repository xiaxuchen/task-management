package com.xiaopeng.taskboard;

import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.ex.FileEditorManagerEx;
import com.intellij.openapi.fileEditor.impl.EditorWindow;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.jcef.JBCefApp;

import javax.swing.*;

/** 在编辑器区打开 PRD（JCEF 编辑器 tab，形如普通文件）；支持定向分屏；再次打开复用并刷新 */
public class PrdOpener {

    private static VirtualFile current;

    /** 准备 PRD 虚拟文件（先关掉上次的，避免堆积）；不负责打开 */
    public static PrdVirtualFile prepare(Project project, String url, String nodeName) {
        try {
            if (!JBCefApp.isSupported()) {
                return null;
            }
            FileEditorManager fem = FileEditorManager.getInstance(project);
            if (current != null && current.isValid()) {
                try {
                    fem.closeFile(current);
                } catch (Throwable ignore) {
                    // 已关闭则忽略
                }
            }
            PrdVirtualFile vf = new PrdVirtualFile(url, "PRD · " + nodeName);
            current = vf;
            return vf;
        } catch (Throwable t) {
            return null;
        }
    }

    public static void open(Project project, String url, String nodeName) {
        open(project, url, nodeName, false);
    }

    /** splitRight=true 时在右侧分屏中打开（与左侧 diff 并排对照） */
    public static void open(Project project, String url, String nodeName, boolean splitRight) {
        try {
            PrdVirtualFile vf = prepare(project, url, nodeName);
            if (vf != null) {
                FileEditorManager fem = FileEditorManager.getInstance(project);
                if (splitRight) {
                    try {
                        FileEditorManagerEx femEx = FileEditorManagerEx.getInstanceEx(project);
                        EditorWindow window = femEx.getCurrentWindow();
                        if (window != null) {
                            window.split(JSplitPane.HORIZONTAL_SPLIT, true, vf, true);
                            return;
                        }
                    } catch (Throwable ignore) {
                        // 分屏失败则普通打开
                    }
                }
                fem.openFile(vf, true);
                return;
            }
        } catch (Throwable ignore) {
            // JCEF 不可用时降级
        }
        BrowserUtil.browse(url, project);
    }
}
