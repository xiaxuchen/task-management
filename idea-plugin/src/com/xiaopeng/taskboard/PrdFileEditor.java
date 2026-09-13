package com.xiaopeng.taskboard;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorState;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.jcef.JBCefBrowser;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.beans.PropertyChangeListener;

/** PRD 编辑器：编辑器区 tab，内容为 JCEF 展示的飞书云文档 */
public class PrdFileEditor extends UserDataHolderBase implements FileEditor {

    private final VirtualFile file;
    private final JBCefBrowser browser;
    private final JPanel component;

    public PrdFileEditor(@NotNull VirtualFile file) {
        this.file = file;
        String url = file instanceof PrdVirtualFile ? ((PrdVirtualFile) file).getUrl() : "about:blank";
        browser = new JBCefBrowser(url);
        component = new JPanel(new BorderLayout());
        component.add(browser.getComponent(), BorderLayout.CENTER);
    }

    @Override
    public @NotNull VirtualFile getFile() {
        return file;
    }

    @Override
    public @NotNull JComponent getComponent() {
        return component;
    }

    @Override
    public @NotNull JComponent getPreferredFocusedComponent() {
        return component;
    }

    @Override
    public @NotNull String getName() {
        return "PRD";
    }

    @Override
    public boolean isModified() {
        return false;
    }

    @Override
    public boolean isValid() {
        return true;
    }

    @Override
    public void setState(@NotNull FileEditorState state) {
    }

    @Override
    public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {
    }

    @Override
    public void dispose() {
        try {
            browser.dispose();
        } catch (Throwable ignore) {
            // 忽略释放异常
        }
    }
}
