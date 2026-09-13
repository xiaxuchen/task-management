package com.xiaopeng.taskboard;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.DiffDialogHints;
import com.intellij.diff.DiffManager;
import com.intellij.diff.chains.SimpleDiffRequestChain;
import com.intellij.diff.contents.DiffContent;
import com.intellij.diff.editor.ChainDiffVirtualFile;
import com.intellij.diff.requests.DiffRequest;
import com.intellij.diff.requests.SimpleDiffRequest;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileTypes.FileType;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.VirtualFile;

import java.util.ArrayList;
import java.util.List;

/**
 * 用 IDEA 原生 Diff 查看变更：以「请求链」方式打开整个（commit 或合并）的全部文件，
 * 平台自带「上一个/下一个文件」导航按钮与 F7 变更导航，定位到指定文件。
 */
public class DiffOpener {

    /** 上次由本插件打开的链式 diff 文件（复用：避免每次新增 tab） */
    private static VirtualFile lastDiffFile;

    /** 单个文件的 old/new 数据 */
    public static class FileDiff {
        public final String path;
        public final String oldText;
        public final String newText;

        public FileDiff(String path, String oldText, String newText) {
            this.path = path;
            this.oldText = oldText;
            this.newText = newText;
        }
    }

    /** 单 commit：双击行（filePath=null）或双击文件（定位到该文件） */
    public static void open(Project project, TaskBoardApi api, long cid, String sha, String filePath) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject diff = api.commitDiff(cid);
                List<FileDiff> files = new ArrayList<>();
                JsonArray arr = diff.getAsJsonArray("files");
                if (arr != null) {
                    for (var el : arr) {
                        JsonObject f = el.getAsJsonObject();
                        if (f.has("binary") && f.get("binary").getAsBoolean()) continue;
                        files.add(new FileDiff(
                                f.get("path").getAsString(),
                                str(f, "old"),
                                str(f, "new")
                        ));
                    }
                }
                ApplicationManager.getApplication().invokeLater(() -> showChain(project, sha, files, filePath));
            } catch (Exception e) {
                ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showErrorDialog(project, "加载 diff 失败：" + e.getMessage(), "查看 Diff"));
            }
        });
    }

    /** 双击 commit 行：打开该 commit 全部文件的链 diff */
    public static void open(Project project, TaskBoardApi api, long cid, String sha) {
        open(project, api, cid, sha, null);
    }

    /** 聚合模式（多 commit 合并变更）：old/new 已在内存，直接打开链 diff */
    public static void openCombined(Project project, String title, List<FileDiff> files, String focusPath) {
        showChain(project, title, files, focusPath);
    }

    private static void showChain(Project project, String title, List<FileDiff> files, String focusPath) {
        if (files.isEmpty()) {
            Messages.showInfoMessage(project, "没有可展示的文本变更（可能为空提交或二进制文件）", "查看 Diff");
            return;
        }
        List<DiffRequest> requests = new ArrayList<>();
        int focus = 0;
        for (int i = 0; i < files.size(); i++) {
            FileDiff fd = files.get(i);
            if (focusPath != null && focusPath.equals(fd.path)) focus = i;
            requests.add(buildRequest(project, title, fd));
        }
        SimpleDiffRequestChain chain = new SimpleDiffRequestChain(requests, focus);
        try {
            // 复用：先关掉上次本插件打开的链 diff，再开新的（保证只有一个 diff tab）
            if (lastDiffFile != null && lastDiffFile.isValid()) {
                try {
                    FileEditorManager.getInstance(project).closeFile(lastDiffFile);
                } catch (Throwable ignore) {
                    // 已关闭则忽略
                }
            }
            ChainDiffVirtualFile vf = new ChainDiffVirtualFile(chain, title);
            lastDiffFile = vf;
            FileEditorManager.getInstance(project).openFile(vf, true);
        } catch (Throwable t) {
            // 平台差异时退回标准 showDiff（可能新增 tab）
            DiffManager.getInstance().showDiff(project, chain, DiffDialogHints.DEFAULT);
        }
    }

    private static SimpleDiffRequest buildRequest(Project project, String title, FileDiff fd) {
        String fileName = fd.path.substring(fd.path.lastIndexOf('/') + 1);
        FileType fileType = FileTypeManager.getInstance().getFileTypeByFileName(fileName);
        DiffContentFactory factory = DiffContentFactory.getInstance();
        DiffContent left = factory.create(project, fd.oldText == null ? "" : fd.oldText, fileType);
        DiffContent right = factory.create(project, fd.newText == null ? "" : fd.newText, fileType);
        return new SimpleDiffRequest(
                title + " · " + fd.path,
                left, right,
                "变更前",
                "变更后"
        );
    }

    private static String str(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }
}
