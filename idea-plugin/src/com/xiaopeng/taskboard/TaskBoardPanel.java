package com.xiaopeng.taskboard;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.ide.BrowserUtil;
import com.intellij.icons.AllIcons;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionToolbar;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.DefaultActionGroup;
import com.intellij.openapi.actionSystem.Separator;
import com.intellij.openapi.actionSystem.ToggleAction;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.fileEditor.ex.FileEditorManagerEx;
import com.intellij.openapi.fileEditor.impl.EditorWindow;
import com.intellij.openapi.fileTypes.FileTypeManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.CheckboxTree;
import com.intellij.ui.CheckedTreeNode;
import com.intellij.ui.ScrollPaneFactory;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import javax.swing.event.TreeSelectionEvent;
import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.DefaultTreeCellRenderer;
import javax.swing.tree.DefaultTreeModel;
import javax.swing.tree.TreePath;
import javax.swing.tree.TreeSelectionModel;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.datatransfer.StringSelection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * task-board 工具窗口（Git Log 式、平台原生风格）：
 * 视图 A（节点选择）：双击节点进入 Review；
 * 视图 B（节点 Review）：默认全部勾选 → 右侧直接展示全部 commit 的合并变更（文件并集 + 净 old/new）；
 *   「提交列表」按钮可展开/收起左侧 commit 列表（勾选/取消调整参与合并的范围）；
 *   双击文件 → IDEA 原生 Diff；勾选后批量审查（✓通过 / ✗有问题 / ○重置）；[← 退出] 返回节点选择。
 */
public class TaskBoardPanel extends JPanel {

    private final Project project;
    private final TaskBoardApi api = new TaskBoardApi(TaskBoardApi.DEFAULT_BASE);

    // ---------- 视图切换 ----------
    private final CardLayout cardLayout = new CardLayout();
    private final JPanel cards = new JPanel(cardLayout);
    private static final String CARD_SELECT = "select";
    private static final String CARD_REVIEW = "review";

    // ---------- 视图 A：节点选择 ----------
    private final DefaultMutableTreeNode selectRoot = new DefaultMutableTreeNode("task-board");
    private final DefaultTreeModel selectModel = new DefaultTreeModel(selectRoot);
    private final JTree selectTree = new JTree(selectModel);
    private final JBLabel selectStatus = new JBLabel(" ");

    // ---------- 视图 B：节点 Review ----------
    private final CheckedTreeNode reviewRoot = new CheckedTreeNode("review");
    private CheckboxTree reviewTree;
    private final JBLabel reviewSummary = new JBLabel(" ");
    private JBCheckBox onlyPending;
    private final List<CommitItem> commitItems = new ArrayList<>();
    private long requestToken = 0;
    private long currentNodeId = -1;
    private String currentNodeName = "";
    private JSplitPane reviewSplit;
    private JScrollPane commitScroll;
    private boolean commitListVisible = false;
    private static final int COMMIT_LIST_WIDTH = 330;

    // 详情区
    private final DefaultMutableTreeNode detailRoot = new DefaultMutableTreeNode("files");
    private final DefaultTreeModel detailModel = new DefaultTreeModel(detailRoot);
    private final JTree detailTree = new JTree(detailModel);
    private final JPanel commitInfoPanel = new JPanel();
    private JSplitPane detailVertSplit;
    private final Map<Long, JsonObject> diffCache = new HashMap<>();
    private long detailToken = 0;
    private Timer checksDebounce;
    // 当前聚合变更（供链 diff 打开时使用）
    private List<DiffOpener.FileDiff> aggregateFiles = new ArrayList<>();
    private String aggregateTitle = "";

    public TaskBoardPanel(Project project) {
        super(new BorderLayout());
        this.project = project;
        // 合理的偏好尺寸：避免底部停靠时被“内容偏好”（树/表格的巨量 preferred）撑高
        setPreferredSize(new Dimension(900, 320));
        setMinimumSize(new Dimension(320, 120));
        cards.add(buildSelectView(), CARD_SELECT);
        cards.add(buildReviewView(), CARD_REVIEW);
        add(cards, BorderLayout.CENTER);
        startIdeBridgePolling();
        startSelectionCapture();
        lastInstance = this;
    }

    /** 最近一个面板实例（供全局动作「加入 Qoder 上下文」调用） */
    private static volatile TaskBoardPanel lastInstance;

    public static TaskBoardPanel lastInstance() {
        return lastInstance;
    }

    /** 已加入上下文的标记（文本 hash → 高亮，供"再按一次解除"） */
    private final java.util.Map<String, AddedMark> addedMarks = new java.util.concurrent.ConcurrentHashMap<>();

    /** 一条已加入标记（高亮 + 所属编辑器） */
    private static class AddedMark {
        final com.intellij.openapi.editor.Editor editor;
        final com.intellij.openapi.editor.markup.RangeHighlighter highlighter;

        AddedMark(com.intellij.openapi.editor.Editor editor,
                  com.intellij.openapi.editor.markup.RangeHighlighter highlighter) {
            this.editor = editor;
            this.highlighter = highlighter;
        }
    }

    private static String textHash(String text) {
        return Integer.toHexString(text.trim().hashCode());
    }

    /** 全局：把"当前选中"加入/解除上下文（toggle；编辑器选中加入后高亮标注，再按一次解除） */
    public void addSelectionToContextGlobal() {
        try {
            com.intellij.openapi.editor.Editor editor =
                    FileEditorManagerEx.getInstanceEx(project).getSelectedTextEditor();
            String text = editor != null && editor.getSelectionModel().hasSelection()
                    ? editor.getSelectionModel().getSelectedText() : null;
            if (text != null && !text.trim().isEmpty()) {
                String hash = textHash(text);
                AddedMark existing = addedMarks.get(hash);
                if (existing != null) {
                    // 再按一次 = 解除该片段（移高亮 + 从池移除）
                    try {
                        existing.editor.getMarkupModel().removeHighlighter(existing.highlighter);
                    } catch (Throwable ignore) {
                        // 编辑器已关闭等情况忽略
                    }
                    addedMarks.remove(hash);
                    removeFromContextPool(text);
                    reviewSummary.setText("已从上下文移除该片段：" + sourceLabelOf(editor));
                    return;
                }
                appendToContextPool(text, sourceLabelOf(editor), editor);
                return;
            }
            // 无编辑器选中 → 尝试 JCEF（飞书云文档 / Markdown 预览）
            PrdFileEditor prd = PrdFileEditor.last();
            if (prd != null) {
                prd.captureJcefSelection(t -> {
                    if (t != null && !t.trim().isEmpty()) {
                        appendToContextPool(t, "云文档/预览（JCEF）", null);
                    } else {
                        reviewSummary.setText("未获取到选中（编辑器/云文档均无选中）");
                    }
                });
                return;
            }
            reviewSummary.setText("未获取到选中（先选中代码/文档内容再按快捷键）");
        } catch (Throwable t) {
            reviewSummary.setText("加入上下文失败：" + t.getMessage());
        }
    }

    /** 追加一条选中到上下文池（可多次累积，多文档/多文件；编辑器来源时高亮标注） */
    private void appendToContextPool(String text, String source, com.intellij.openapi.editor.Editor editor) {
        try {
            StringBuilder block = new StringBuilder();
            block.append("\n### ").append(source).append("（")
                    .append(java.time.LocalTime.now().withNano(0)).append("）\n```\n")
                    .append(text).append("\n```\n");
            Path dir = java.nio.file.Paths.get(System.getProperty("user.home"), ".taskboard");
            Files.createDirectories(dir);
            Files.writeString(dir.resolve("selected-snippets.md"), block.toString(),
                    java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
            // 高亮标注"已加入上下文"（直构 TextAttributes，强对比；再按一次可解除）
            boolean highlighted = false;
            if (editor != null && !editor.isDisposed() && editor.getSelectionModel().hasSelection()) {
                try {
                    com.intellij.openapi.editor.markup.TextAttributes attrs =
                            new com.intellij.openapi.editor.markup.TextAttributes();
                    attrs.setBackgroundColor(new java.awt.Color(0xFF, 0xF3, 0xB0));
                    attrs.setEffectType(com.intellij.openapi.editor.markup.EffectType.BOXED);
                    attrs.setEffectColor(new java.awt.Color(0xF5, 0xA6, 0x23));
                    com.intellij.openapi.editor.markup.RangeHighlighter h = editor.getMarkupModel()
                            .addRangeHighlighter(
                                    editor.getSelectionModel().getSelectionStart(),
                                    editor.getSelectionModel().getSelectionEnd(),
                                    com.intellij.openapi.editor.markup.HighlighterLayer.SELECTION - 1,
                                    attrs,
                                    com.intellij.openapi.editor.markup.HighlighterTargetArea.EXACT_RANGE);
                    addedMarks.put(textHash(text), new AddedMark(editor, h));
                    highlighted = true;
                } catch (Throwable t) {
                    diag("highlighter failed: " + t);
                }
            }
            int lines = text.split("\n", -1).length;
            reviewSummary.setText("已加入上下文" + (highlighted ? "（高亮标注）" : "") + "：" + source
                    + "（" + lines + " 行）" + (highlighted ? "—再按一次可解除" : ""));
        } catch (Exception ex) {
            reviewSummary.setText("加入上下文失败：" + ex.getMessage());
        }
    }

    /** 从上下文池移除包含该文本的条目（重写文件） */
    private void removeFromContextPool(String text) {
        try {
            Path file = java.nio.file.Paths.get(System.getProperty("user.home"), ".taskboard", "selected-snippets.md");
            if (!Files.exists(file)) {
                return;
            }
            String all = Files.readString(file);
            String key = text.trim();
            if (key.length() > 100) {
                key = key.substring(0, 100);
            }
            String[] parts = all.split("(?m)^### ");
            StringBuilder sb = new StringBuilder();
            for (String p : parts) {
                if (p.trim().isEmpty() || p.contains(key)) {
                    continue;
                }
                sb.append("### ").append(p);
            }
            Files.writeString(file, sb.toString());
        } catch (Exception ex) {
            reviewSummary.setText("移除上下文失败：" + ex.getMessage());
        }
    }

    /** 选中来源标签（编辑器/diff 真实文件路径；虚拟文件回退当前链式 diff） */
    private String sourceLabelOf(com.intellij.openapi.editor.Editor editor) {
        try {
            VirtualFile vf = editor.getVirtualFile();
            if (vf instanceof com.intellij.diff.editor.ChainDiffVirtualFile) {
                String p = DiffOpener.currentDiffFilePath(vf);
                return p != null ? p : "当前 review diff";
            }
            if (vf instanceof com.intellij.testFramework.LightVirtualFile) {
                VirtualFile chainVf = DiffOpener.currentFile();
                if (chainVf != null && chainVf.isValid()) {
                    String p = DiffOpener.currentDiffFilePath(chainVf);
                    if (p != null) {
                        return p;
                    }
                }
                return "当前 review diff";
            }
            return vf.getName();
        } catch (Throwable t) {
            return "编辑器";
        }
    }

    // ---------- Qoder 联动：自动捕获编辑器选中（零点击） ----------

    /** 注册全局选区监听：任意编辑器（含 diff 视图）里选中代码后自动写入"最近选中"，供 Qoder Hook 注入 */
    private void startSelectionCapture() {
        try {
            com.intellij.openapi.editor.EditorFactory.getInstance().getEventMulticaster()
                    .addSelectionListener(new com.intellij.openapi.editor.event.SelectionListener() {
                        @Override
                        public void selectionChanged(@NotNull com.intellij.openapi.editor.event.SelectionEvent e) {
                            captureSelectionDebounced(e.getEditor());
                        }
                    }, project);
        } catch (Throwable ignore) {
            // 监听注册失败不影响插件主体
        }
    }

    /** 防抖（700ms）：避免拖选过程中频繁写盘 */
    private void captureSelectionDebounced(com.intellij.openapi.editor.Editor editor) {
        if (selectionTimer != null) {
            selectionTimer.stop();
        }
        selectionTimer = new Timer(700, ev -> {
            ((Timer) ev.getSource()).stop();
            captureSelection(editor);
        });
        selectionTimer.setRepeats(false);
        selectionTimer.start();
    }

    /** 把"最近一次选中"（≥10 字符）覆盖写入 ~/.taskboard/last-selection.md（Qoder Hook 自动注入） */
    private void captureSelection(com.intellij.openapi.editor.Editor editor) {
        try {
            if (editor == null || editor.isDisposed()) {
                return;
            }
            String text = editor.getSelectionModel().hasSelection()
                    ? editor.getSelectionModel().getSelectedText() : null;
            if (text == null || text.trim().length() < 10) {
                return;
            }
            String fileName = "";
            try {
                VirtualFile vf = editor.getVirtualFile();
                if (vf instanceof com.intellij.diff.editor.ChainDiffVirtualFile) {
                    // 链式 diff 的 tab 自身：取"当前显示的变更文件路径"
                    String diffPath = DiffOpener.currentDiffFilePath(vf);
                    fileName = diffPath != null ? diffPath : "（当前 review diff）";
                } else if (vf instanceof com.intellij.testFramework.LightVirtualFile) {
                    // diff 的左右编辑器（内容 vf）或其它虚拟文件：回退到"当前链式 diff"取真实文件路径
                    String diffPath = null;
                    VirtualFile chainVf = DiffOpener.currentFile();
                    if (chainVf != null && chainVf.isValid()) {
                        diffPath = DiffOpener.currentDiffFilePath(chainVf);
                    }
                    fileName = diffPath != null ? diffPath : "（当前 review diff）";
                } else {
                    fileName = vf.getName();
                }
            } catch (Throwable ignore) {
                // 虚拟文件时忽略
            }
            StringBuilder block = new StringBuilder();
            block.append("### 最近选中（").append(java.time.LocalTime.now().withNano(0))
                    .append(fileName.isEmpty() ? "" : "，来自 " + fileName).append("）\n```\n")
                    .append(text).append("\n```\n");
            Path dir = java.nio.file.Paths.get(System.getProperty("user.home"), ".taskboard");
            Files.createDirectories(dir);
            Files.writeString(dir.resolve("last-selection.md"), block.toString());
        } catch (Throwable ignore) {
            // 捕获失败不影响使用
        }
    }

    // ---------- 需求 + 概设 / PRD ----------

    /** 一键对照布局：左 diff + 中 需求+概设 + 右 PRD（飞书），并调整宽度比例 */
    private void openReviewLayout() {
        if (currentNodeId < 0) {
            reviewSummary.setText("请先从节点树进入一个节点");
            return;
        }
        final long nodeId = currentNodeId;
        final String nodeName = currentNodeName;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = api.nodeDocuments(nodeId);
                String prdUrl = null;
                try {
                    prdUrl = findPrdUrl(nodeId);
                } catch (Exception ignore) {
                    // 无 PRD 链接不阻断
                }
                // 实时拉取当前节点（子树）全量变更：不依赖面板缓存（切节点后立即点击也正确）
                List<DiffOpener.FileDiff> layoutFiles = new ArrayList<>();
                String layoutTitle = nodeName + " · 全部变更";
                try {
                    JsonObject tracks = api.nodeTracks(nodeId, "subtree");
                    JsonArray items = tracks != null ? tracks.getAsJsonArray("items") : null;
                    if (items != null && items.size() > 0) {
                        long[] cids = new long[items.size()];
                        for (int i = 0; i < items.size(); i++) {
                            cids[i] = items.get(i).getAsJsonObject()
                                    .getAsJsonObject("commit").get("id").getAsLong();
                        }
                        JsonObject combined = api.combinedDiff(cids);
                        JsonArray repos = combined.getAsJsonArray("repos");
                        if (repos != null) {
                            for (JsonElement rel : repos) {
                                JsonArray fs = rel.getAsJsonObject().getAsJsonArray("files");
                                if (fs == null) continue;
                                for (JsonElement fe : fs) {
                                    JsonObject f = fe.getAsJsonObject();
                                    if (f.has("binary") && f.get("binary").getAsBoolean()) continue;
                                    layoutFiles.add(new DiffOpener.FileDiff(
                                            f.get("path").getAsString(),
                                            str(f, "old", ""),
                                            str(f, "new", "")));
                                }
                            }
                        }
                    }
                } catch (Exception ignore) {
                    // 实时失败时退回面板当前缓存
                }
                if (layoutFiles.isEmpty() && aggregateFiles != null && !aggregateFiles.isEmpty()) {
                    layoutFiles = aggregateFiles;
                    layoutTitle = aggregateTitle;
                }
                final List<DiffOpener.FileDiff> finalFiles = layoutFiles;
                final String finalLayoutTitle = layoutTitle;
                final JsonArray finalDocs = docs;
                final String finalPrdUrl = prdUrl;
                SwingUtilities.invokeLater(() -> {
                    // 0) 清场：关掉上次开的三类 tab + 合并分屏 → 保证每次都是干净三栏（不堆叠）
                    try {
                        DiffOpener.closeCurrent(project);
                        PrdOpener.closeAll(project);
                        String docsPath = java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"),
                                "taskboard-docs", "taskboard-需求概设.md").toString();
                        VirtualFile docsOld = LocalFileSystem.getInstance().findFileByPath(docsPath);
                        if (docsOld != null) {
                            FileEditorManagerEx.getInstanceEx(project).closeFile(docsOld);
                        }
                        FileEditorManagerEx.getInstanceEx(project).unsplitAllWindow();
                    } catch (Throwable ignore) {
                        // 清场失败不阻断重铺
                    }
                    // 1) 左侧：diff（当前节点全量变更）
                    if (finalFiles != null && !finalFiles.isEmpty()) {
                        DiffOpener.openCombined(project, finalLayoutTitle, finalFiles, null);
                    } else {
                        CommitItem sel = selectedCommit();
                        if (sel != null) DiffOpener.open(project, api, sel.cid, sel.sha, null);
                    }
                    // 2) 中间：需求+概设文档（右分屏）
                    FileEditorManagerEx femEx = FileEditorManagerEx.getInstanceEx(project);
                    EditorWindow main = femEx.getCurrentWindow();
                    VirtualFile docsVf = (finalDocs != null && finalDocs.size() > 0)
                            ? buildDocsFile(finalDocs, finalPrdUrl) : null;
                    EditorWindow docWin = null;
                    if (docsVf != null && main != null) {
                        docWin = main.split(JSplitPane.HORIZONTAL_SPLIT, true, docsVf, true);
                    }
                    // 3) 右侧同一组：PRD 作为第二个 tab（与需求概设切换展示，用顶栏「文档/PRD」按钮切）
                    if (finalPrdUrl != null) {
                        try {
                            PrdVirtualFile prdVf = PrdOpener.prepare(project, finalPrdUrl, nodeName);
                            if (prdVf != null) {
                                // focus=false：打开为 tab 但不抢激活（默认展示需求概设）
                                FileEditorManagerEx.getInstanceEx(project).openFile(prdVf, false);
                            }
                        } catch (Throwable ignore) {
                            // PRD 打开失败不阻断
                        }
                    }
                    // 4) 宽度：diff 主组约 70%；并把 TaskBoard 工具窗停靠到底部（与 diff 上下）后设高度约 30%
                    final EditorWindow mainRef = main;
                    Timer t = new Timer(500, ev -> {
                        ((Timer) ev.getSource()).stop();
                        applyTopSplitterProportion(mainRef, LayoutPrefs.diffRatio());
                        applyTaskBoardBottom(project);
                    });
                    t.setRepeats(false);
                    t.start();
                    reviewSummary.setText("已铺对照布局：diff（" + finalFiles.size() + " 文件，宽70%） + 右列（需求概设⇄PRD 用顶栏按钮切） + TaskBoard底部（高30%）");
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("铺布局失败：" + ex.getMessage()));
            }
        });
    }

    // ---------- Qoder 联动：当前 review 上下文 ----------

    /** 把"当前 review 上下文"（节点/勾选提交/变更文件）写到固定文件，供 Qoder hook 桥注入 */
    private void writeReviewContext() {
        try {
            JsonObject o = new JsonObject();
            o.addProperty("updatedAt", System.currentTimeMillis());
            o.addProperty("nodeId", currentNodeId);
            o.addProperty("nodeName", currentNodeName);
            JsonArray commits = new JsonArray();
            for (CommitItem it : checkedCommits()) {
                JsonObject c = new JsonObject();
                c.addProperty("sha", it.sha == null ? "" : it.sha);
                c.addProperty("note", it.note == null ? "" : it.note);
                c.addProperty("repo", it.repo == null ? "" : it.repo);
                c.addProperty("reviewStatus", it.reviewStatus == null ? "pending" : it.reviewStatus);
                commits.add(c);
            }
            o.add("checkedCommits", commits);
            JsonArray files = new JsonArray();
            if (aggregateFiles != null) {
                for (DiffOpener.FileDiff f : aggregateFiles) {
                    files.add(f.path);
                }
            }
            o.add("files", files);
            Path dir = java.nio.file.Paths.get(System.getProperty("user.home"), ".taskboard");
            Files.createDirectories(dir);
            Files.writeString(dir.resolve("current-review.json"), o.toString());
        } catch (Exception ignore) {
            // 上下文写入失败不影响 UI
        }
    }

    // ---------- Qoder 联动：派任务给 Qoder IDE（前台 Agent） ----------

    /** 派给 Qoder（IDE 前台）：生成任务提示词 → 打开 Qoder 面板 + 剪贴板就绪（⌘V+回车即发） */
    private void dispatchToQoder() {
        if (currentNodeId < 0) {
            reviewSummary.setText("请先从节点树进入一个节点");
            return;
        }
        final long nodeId = currentNodeId;
        final String nodeName = currentNodeName;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = api.nodeDocuments(nodeId);
                String prdUrl = null;
                try {
                    prdUrl = findPrdUrl(nodeId);
                } catch (Exception ignore) {
                    // 无 PRD 不阻断
                }
                String prompt = buildDispatchPrompt(nodeName, docs, prdUrl);
                SwingUtilities.invokeLater(() -> {
                    boolean ok = QoderOpener.dispatch(project, prompt);
                    reviewSummary.setText(ok
                            ? "已打开 Qoder 面板并复制任务提示词（" + nodeName + "）——粘贴（⌘V）+ 回车发送"
                            : "任务提示词已复制（" + nodeName + "）——请手动打开 Qoder 面板粘贴发送");
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("生成提示词失败：" + ex.getMessage()));
            }
        });
    }

    /** 生成派单提示词：任务上下文（文档/PRD/已登记提交/当前变更文件）+ 执行要求 */
    private String buildDispatchPrompt(String nodeName, JsonArray docs, String prdUrl) {
        StringBuilder md = new StringBuilder();
        md.append("你是 Qoder Agent。请执行下面来自 task-board 的任务。\n\n");
        md.append("# 任务：").append(nodeName).append("\n\n");
        if (prdUrl != null) {
            md.append("- PRD（飞书）：").append(prdUrl).append("\n\n");
        }
        if (docs != null) {
            for (JsonElement el : docs) {
                JsonObject d = el.getAsJsonObject();
                md.append("## ").append(str(d, "name", "文档")).append("\n\n");
                md.append(str(d, "content", "")).append("\n\n---\n\n");
            }
        }
        List<CommitItem> sel = checkedCommits();
        if (!sel.isEmpty()) {
            md.append("## 已登记提交（供参考）\n\n");
            for (CommitItem it : sel) {
                md.append("- `").append(it.sha == null ? "" : it.sha).append("` ")
                        .append(it.note == null ? "" : it.note)
                        .append("（").append(it.repo == null ? "" : it.repo).append("）\n");
            }
            md.append("\n");
        }
        if (aggregateFiles != null && !aggregateFiles.isEmpty()) {
            md.append("## 当前变更文件（").append(aggregateFiles.size()).append("）\n\n");
            for (DiffOpener.FileDiff f : aggregateFiles) {
                md.append("- ").append(f.path).append("\n");
            }
            md.append("\n");
        }
        md.append("## 要求\n\n先阅读相关代码与上述上下文，按需修改；完成后给出变更摘要。\n");
        md.append("\n（本提示词由 TaskBoard 插件生成，可继续在终端对话追问）\n");
        return md.toString();
    }

    /** 复制当前 review 上下文 markdown 到剪贴板（可粘贴到 Qoder 对话） */
    private void copyReviewContext() {
        try {
            StringBuilder md = new StringBuilder();
            md.append("## task-board 当前 review 上下文\n");
            md.append("- **节点**：").append(currentNodeName).append("（id=").append(currentNodeId).append("）\n");
            List<CommitItem> sel = checkedCommits();
            md.append("- **勾选提交（").append(sel.size()).append("）**\n");
            for (CommitItem it : sel) {
                String sha = it.sha == null ? "" : it.sha;
                md.append("  - `").append(sha.length() > 10 ? sha.substring(0, 10) : sha).append("` ")
                        .append(it.note == null ? "" : it.note)
                        .append("（").append(it.repo == null ? "" : it.repo).append("）\n");
            }
            int fileCount = aggregateFiles == null ? 0 : aggregateFiles.size();
            if (fileCount > 0) {
                md.append("- **变更文件（").append(fileCount).append("）**\n");
                for (DiffOpener.FileDiff f : aggregateFiles) {
                    md.append("  - ").append(f.path).append("\n");
                }
            }
            CopyPasteManager.getInstance().setContents(new StringSelection(md.toString()));
            reviewSummary.setText("已复制当前 review 上下文（" + sel.size() + " 提交 / " + fileCount
                    + " 文件），可直接粘贴给 Qoder");
        } catch (Throwable t) {
            reviewSummary.setText("复制失败：" + t.getMessage());
        }
    }

    /** diff 栏显隐（开关回调）：勾选=显示 */
    private void setDiffPaneVisible(boolean visible) {
        try {
            if (visible) {
                showDiffPane();
            } else {
                DiffOpener.closeCurrent(project);
                reviewSummary.setText("已隐藏 diff 栏（勾选「diff」可恢复）");
            }
        } catch (Exception ex) {
            reviewSummary.setText("切换 diff 栏失败：" + ex.getMessage());
        }
    }

    /** 显示 diff 栏：无并排布局时重铺对照布局；否则打开当前聚合变更 */
    private void showDiffPane() {
        try {
            FileEditorManagerEx fem = FileEditorManagerEx.getInstanceEx(project);
            // 已有实例：直接激活，避免在新组再开一份副本
            VirtualFile existing = DiffOpener.currentFile();
            if (existing != null && existing.isValid() && fem.getEditors(existing).length > 0) {
                fem.openFile(existing, true);
                reviewSummary.setText("已显示 diff 栏");
                return;
            }
            // 只开 diff（不重铺、不连带文档；需要完整布局时用「对照布局」）
            List<DiffOpener.FileDiff> files = aggregateFiles;
            if (files != null && !files.isEmpty()) {
                DiffOpener.openCombined(project, aggregateTitle, files, null);
            } else {
                CommitItem sel = selectedCommit();
                if (sel != null) {
                    DiffOpener.open(project, api, sel.cid, sel.sha, null);
                } else {
                    reviewSummary.setText("当前没有可展示的变更（先选节点/勾选提交）");
                    return;
                }
            }
            reviewSummary.setText("已显示 diff 栏");
        } catch (Exception ex) {
            reviewSummary.setText("显示 diff 失败：" + ex.getMessage());
        }
    }

    /** 诊断日志（/tmp/taskboard-plugin.log；定位 tab 残留问题用） */
    private static void diag(String msg) {
        try {
            Files.writeString(
                    java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"), "taskboard-plugin.log"),
                    "[" + java.time.LocalTime.now().withNano(0) + "] " + msg + "\n",
                    java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
        } catch (Throwable ignore) {
            // 诊断失败不影响业务
        }
    }

    /** 枚举当前所有编辑器组的文件（诊断用） */
    private String dumpWindows() {
        try {
            StringBuilder sb = new StringBuilder();
            FileEditorManagerEx femEx = FileEditorManagerEx.getInstanceEx(project);
            int i = 0;
            for (EditorWindow w : femEx.getWindows()) {
                sb.append("  [组").append(i++).append("] ");
                for (VirtualFile f : w.getFiles()) {
                    sb.append(f.getName()).append("(").append(f.getClass().getSimpleName()).append(") ");
                }
                sb.append("\n");
            }
            return sb.length() == 0 ? "  （无编辑器组）\n" : sb.toString();
        } catch (Throwable t) {
            return "  dump error: " + t + "\n";
        }
    }

    /** 文档窗口显隐（开关回调）：勾选=显示 */
    private void setDocsPaneVisible(boolean visible) {
        if (visible) {
            showDocsPane();
            return;
        }
        try {
            diag("hideDocsPane 开始：\n" + dumpWindows());
            FileEditorManagerEx fem = FileEditorManagerEx.getInstanceEx(project);
            String docsPath = java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"),
                    "taskboard-docs", "taskboard-需求概设.md").toString();
            VirtualFile docsVf = LocalFileSystem.getInstance().findFileByPath(docsPath);
            // 先定位"文档所在的编辑器组"（关内容前）
            EditorWindow docWin = null;
            VirtualFile prdBef = PrdOpener.currentFile();
            for (EditorWindow w : fem.getWindows()) {
                for (VirtualFile f : w.getFiles()) {
                    if ((docsVf != null && f.equals(docsVf))
                            || (prdBef != null && prdBef.isValid() && f.equals(prdBef))) {
                        docWin = w;
                        break;
                    }
                }
                if (docWin != null) {
                    break;
                }
            }
            if (docsVf != null) {
                fem.closeFile(docsVf);
            }
            PrdOpener.closeAll(project);
            diag("closeAll 完成：\n" + dumpWindows());
            // 清理：若该组里残留"我们的 diff 副本"，关掉它（避免收起文档后露出重复 diff）
            VirtualFile diff = DiffOpener.currentFile();
            if (docWin != null && diff != null && diff.isValid()) {
                try {
                    for (VirtualFile f : docWin.getFiles()) {
                        if (f.equals(diff)) {
                            fem.closeFile(diff, docWin);
                            break;
                        }
                    }
                } catch (Throwable ignore) {
                    // 组已失效等情况忽略
                }
            }
            // 该组已空则移除空分屏
            if (docWin != null) {
                try {
                    if (docWin.getFiles().length == 0) {
                        docWin.removeFromSplitter();
                    }
                } catch (Throwable ignore) {
                    // 平台可能已自动移除
                }
            }
            // 收起后把焦点落回 diff（避免平台跳到无关文件，如用户之前打开过的源码）
            try {
                VirtualFile diffKeep = DiffOpener.currentFile();
                if (diffKeep != null && diffKeep.isValid() && fem.getEditors(diffKeep).length > 0) {
                    fem.openFile(diffKeep, true);
                }
            } catch (Throwable ignore) {
                // 焦点恢复失败不影响主体
            }
            diag("hideDocsPane 完成：\n" + dumpWindows());
            reviewSummary.setText("已隐藏文档窗口（勾选「文档」可恢复）");
        } catch (Exception ex) {
            reviewSummary.setText("隐藏文档窗口失败：" + ex.getMessage());
        }
    }

    /** 显示文档窗口：重建右列（需求概设 + PRD 两个 tab，点 tab 切换） */
    private void showDocsPane() {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = currentNodeId >= 0 ? api.nodeDocuments(currentNodeId) : null;
                String prdUrl = null;
                try {
                    prdUrl = currentNodeId >= 0 ? findPrdUrl(currentNodeId) : null;
                } catch (Exception ignore) {
                    // 无 PRD 不阻断
                }
                final JsonArray finalDocs = docs;
                final String finalPrdUrl = prdUrl;
                SwingUtilities.invokeLater(() -> {
                    try {
                        if ((finalDocs == null || finalDocs.size() == 0) && finalPrdUrl == null) {
                            reviewSummary.setText("该节点暂无文档且未配置 PRD 链接");
                            if (reviewToolbar != null) {
                                reviewToolbar.updateActionsImmediately();
                            }
                            return;
                        }
                        FileEditorManagerEx fem = FileEditorManagerEx.getInstanceEx(project);
                        EditorWindow main = fem.getCurrentWindow();
                        EditorWindow docWin = null;
                        if (finalDocs != null && finalDocs.size() > 0 && main != null) {
                            VirtualFile vf = buildDocsFile(finalDocs, finalPrdUrl);
                            if (vf != null) {
                                docWin = main.split(JSplitPane.HORIZONTAL_SPLIT, true, vf, true);
                            }
                        }
                        if (finalPrdUrl != null) {
                            PrdVirtualFile prd = PrdOpener.prepare(project, finalPrdUrl, currentNodeName);
                            if (prd != null) {
                                if (docWin != null) {
                                    fem.openFile(prd, false);
                                } else {
                                    fem.openFile(prd, true);
                                }
                            }
                        }
                        // 宽度与「布局设置」一致
                        final EditorWindow mainRef = main;
                        Timer t = new Timer(400, ev -> {
                            ((Timer) ev.getSource()).stop();
                            applyTopSplitterProportion(mainRef, LayoutPrefs.diffRatio());
                        });
                        t.setRepeats(false);
                        t.start();
                        reviewSummary.setText("已显示文档窗口（需求概设/PRD 两个 tab，点 tab 切换）");
                    } catch (Exception ex) {
                        reviewSummary.setText("显示文档窗口失败：" + ex.getMessage());
                    }
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("显示文档窗口失败：" + ex.getMessage()));
            }
        });
    }

    /** 在「需求概设」与「飞书 PRD」之间切换（右列同一组内的两个 tab） */
    private void toggleDocsPrd() {
        if (currentNodeId < 0) {
            reviewSummary.setText("请先从节点树进入一个节点");
            return;
        }
        final long nodeId = currentNodeId;
        final String nodeName = currentNodeName;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = api.nodeDocuments(nodeId);
                String prdUrl = null;
                try {
                    prdUrl = findPrdUrl(nodeId);
                } catch (Exception ignore) {
                    // 无 PRD 不阻断
                }
                final JsonArray finalDocs = docs;
                final String finalPrdUrl = prdUrl;
                SwingUtilities.invokeLater(() -> {
                    try {
                        FileEditorManagerEx fem = FileEditorManagerEx.getInstanceEx(project);
                        String docsPath = java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"),
                                "taskboard-docs", "taskboard-需求概设.md").toString();
                        VirtualFile docsVf = LocalFileSystem.getInstance().findFileByPath(docsPath);
                        if (docsVf == null) {
                            docsVf = buildDocsFile(finalDocs, finalPrdUrl);
                        }
                        VirtualFile prdVf = PrdOpener.currentFile();
                        boolean prdActive = prdVf != null && isActiveFile(fem, prdVf);
                        boolean docsAvailable = docsVf != null;
                        if (!docsAvailable && (finalPrdUrl == null || !finalPrdUrl.isEmpty())) {
                            // 还可尝试开 PRD
                        }
                        if (!docsAvailable && finalPrdUrl == null) {
                            reviewSummary.setText("该节点暂无文档且未配置 PRD 链接");
                            return;
                        }
                        if (prdActive && docsAvailable) {
                            fem.openFile(docsVf, true);
                            reviewSummary.setText("已切换到：需求概设");
                            return;
                        }
                        // 切换到 PRD
                        if (prdVf == null || !prdVf.isValid()) {
                            if (finalPrdUrl == null) {
                                if (docsAvailable) {
                                    fem.openFile(docsVf, true);
                                    reviewSummary.setText("未配置 PRD 链接，保持需求概设");
                                }
                                return;
                            }
                            prdVf = PrdOpener.prepare(project, finalPrdUrl, nodeName);
                        }
                        if (prdVf != null) {
                            fem.openFile(prdVf, true);
                            reviewSummary.setText("已切换到：飞书 PRD");
                        } else if (docsAvailable) {
                            fem.openFile(docsVf, true);
                        }
                    } catch (Exception ex) {
                        reviewSummary.setText("切换失败：" + ex.getMessage());
                    }
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("切换失败：" + ex.getMessage()));
            }
        });
    }

    /** 指定文件是否当前激活 */
    private static boolean isActiveFile(FileEditorManagerEx fem, VirtualFile vf) {
        try {
            for (VirtualFile f : fem.getSelectedFiles()) {
                if (f == vf || f.equals(vf)) {
                    return true;
                }
            }
        } catch (Throwable ignore) {
            // 忽略
        }
        return false;
    }

    /** 把 TaskBoard 工具窗停靠到底部并占约配置比例高度（与上方 diff 形成上下结构） */
    private void applyTaskBoardBottom(Project project) {
        try {
            final com.intellij.openapi.wm.ToolWindow tw = com.intellij.openapi.wm.ToolWindowManager.getInstance(project)
                    .getToolWindow("TaskBoard");
            if (tw == null) {
                return;
            }
            if (tw.getAnchor() != com.intellij.openapi.wm.ToolWindowAnchor.BOTTOM) {
                // postRunnable：停靠完成后立即设一次高度
                tw.setAnchor(com.intellij.openapi.wm.ToolWindowAnchor.BOTTOM, () -> setToolWindowHeight(tw));
            }
            tw.show();
            // 停靠动画可能延迟回写尺寸：多个时间点重复设置高度
            for (int delay : new int[]{350, 1000, 1800, 2800}) {
                Timer t = new Timer(delay, ev -> {
                    ((Timer) ev.getSource()).stop();
                    setToolWindowHeight(tw);
                });
                t.setRepeats(false);
                t.start();
            }
        } catch (Throwable ignore) {
            // 工具窗停靠失败不阻断布局
        }
    }

    /** 按配置比例设置 TaskBoard 高度（仅当已停靠底部时生效） */
    private void setToolWindowHeight(com.intellij.openapi.wm.ToolWindow tw) {
        try {
            if (tw.getAnchor() != com.intellij.openapi.wm.ToolWindowAnchor.BOTTOM) {
                return;
            }
            if (tw instanceof com.intellij.openapi.wm.ex.ToolWindowEx twEx) {
                java.awt.Window win = SwingUtilities.getWindowAncestor(tw.getComponent());
                int frameH = win != null ? win.getHeight() : 900;
                int target = Math.max(200, (int) (frameH * LayoutPrefs.toolWindowRatio()));
                // 平台语义：stretchHeight 是「增量」（当前高度 + value）——因此传目标与当前的差值
                int current = tw.getComponent() != null ? tw.getComponent().getHeight() : 0;
                int delta = target - current;
                if (delta != 0) {
                    twEx.stretchHeight(delta);
                }
            }
        } catch (Throwable ignore) {
            // 忽略
        }
    }

    /** 把窗口所在最外层 Splitter 的比例设为 p（调整分屏宽度分配），失败静默 */
    private static void applyTopSplitterProportion(EditorWindow window, float p) {
        try {
            if (window == null) return;
            java.awt.Component c = window.getComponent$intellij_platform_ide_impl();
            com.intellij.openapi.ui.Splitter top = null;
            while (c != null) {
                if (c instanceof com.intellij.openapi.ui.Splitter s) {
                    top = s;
                }
                c = c.getParent();
            }
            if (top != null) {
                top.setProportion(p);
                // 记录并监听拖动（自动记住比例）
                lastTopSplitter = top;
                top.removePropertyChangeListener(RATIO_SAVER);
                top.addPropertyChangeListener(RATIO_SAVER);
            }
        } catch (Throwable ignore) {
            // 平台差异时忽略
        }
    }

    /** 布局比例设置：保存后即时应用到已铺布局 */
    private void openLayoutSettings() {
        new LayoutSettingsDialog(project, () -> {
            if (lastTopSplitter != null) {
                try {
                    lastTopSplitter.setProportion(LayoutPrefs.diffRatio());
                } catch (Throwable ignore) {
                    // 忽略
                }
            }
            applyTaskBoardBottom(project);
            reviewSummary.setText("布局比例已更新：diff " + Math.round(LayoutPrefs.diffRatio() * 100)
                    + "% / TaskBoard " + Math.round(LayoutPrefs.toolWindowRatio() * 100) + "%");
        }).show();
    }

    /** 上溯到需求节点取飞书 PRD 链接；节点（或需求节点）配置 prdAnchor 时拼接锚点 */
    private String findPrdUrl(long startId) throws Exception {
        long id = startId;
        for (int depth = 0; depth < 10 && id > 0; depth++) {
            JsonObject node = api.nodeGet(id);
            if ("requirement".equals(str(node, "type", ""))) {
                JsonObject reqAttrs = node.has("attrs") && node.get("attrs").isJsonObject()
                        ? node.getAsJsonObject("attrs") : null;
                String url = null;
                if (reqAttrs != null && reqAttrs.has("feishu_url") && !reqAttrs.get("feishu_url").isJsonNull()) {
                    url = reqAttrs.get("feishu_url").getAsString();
                }
                if (url == null) return null;
                String anchor = attr(startId, "prdAnchor");
                if (anchor == null) anchor = reqAttrs != null ? attrOf(reqAttrs, "prdAnchor") : null;
                if (anchor != null && !anchor.isEmpty()) {
                    url = url + (anchor.startsWith("#") ? anchor : "#" + anchor);
                }
                return url;
            }
            if (!node.has("parentId") || node.get("parentId").isJsonNull()) return null;
            id = node.get("parentId").getAsLong();
        }
        return null;
    }

    private String attr(long nodeId, String key) {
        try {
            JsonObject node = api.nodeGet(nodeId);
            if (node.has("attrs") && node.get("attrs").isJsonObject()) {
                return attrOf(node.getAsJsonObject("attrs"), key);
            }
        } catch (Exception ignore) {
            // 忽略
        }
        return null;
    }

    private static String attrOf(JsonObject attrs, String key) {
        return attrs != null && attrs.has(key) && !attrs.get(key).isJsonNull() ? attrs.get(key).getAsString() : null;
    }

    /** 构建合并 markdown（固定单文件，含 PRD 链接行与节点标题）并返回 VirtualFile；失败返回 null */
    private VirtualFile buildDocsFile(JsonArray docs, String prdUrl) {
        try {
            if (docs == null || docs.size() == 0) {
                return null;
            }
            StringBuilder md = new StringBuilder();
            md.append("# ").append(currentNodeName).append("\n\n");
            if (prdUrl != null) {
                md.append("> 📄 **PRD（飞书）**：[打开需求文档](").append(prdUrl).append(")　·　本节点对应章节：**")
                        .append(currentNodeName).append("**\n\n");
            }
            for (JsonElement el : docs) {
                JsonObject d = el.getAsJsonObject();
                md.append("## ").append(str(d, "name", "文档")).append("\n\n");
                md.append(str(d, "content", "")).append("\n\n---\n\n");
            }
            // 固定单文件（所有节点共用同一文件 → openFile 自动复用 tab，不会堆积）
            Path dir = java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"), "taskboard-docs");
            Files.createDirectories(dir);
            Path file = dir.resolve("taskboard-需求概设.md");
            Files.writeString(file, md.toString());
            return LocalFileSystem.getInstance().refreshAndFindFileByPath(file.toString());
        } catch (Exception ex) {
            reviewSummary.setText("构建文档失败：" + ex.getMessage());
            return null;
        }
    }

    // ---------- 网页 → IDEA 桥（轮询领取打开请求） ----------

    /** 每 3 秒轮询一次是否有网页发来的打开请求（本地轻量 GET，无请求时静默） */
    private void startIdeBridgePolling() {
        Timer timer = new Timer(3000, e -> pollIdeRequest());
        timer.setInitialDelay(1500);
        timer.start();
    }

    private void pollIdeRequest() {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject req = api.getNextIdeRequest();
                if (req == null || !req.has("id")) return;
                long id = req.get("id").getAsLong();
                SwingUtilities.invokeLater(() -> openIdeRequest(req));
                api.completeIdeRequest(id); // 请求已受理（打开动作已发起）
            } catch (Exception ignore) {
                // 服务不可用/网络异常：静默，下轮重试
            }
        });
    }

    /** 打开网页请求的 diff：单 commit 直接定位文件；多 commit 走合并变更链 */
    private void openIdeRequest(JsonObject req) {
        JsonArray cids = req.getAsJsonArray("cids");
        if (cids == null || cids.size() == 0) return;
        String path = str(req, "path", null);
        String title = str(req, "title", null);
        if (cids.size() == 1) {
            long cid = cids.get(0).getAsLong();
            String sha = "";
            JsonArray commits = req.getAsJsonArray("commits");
            if (commits != null && commits.size() > 0) {
                sha = str(commits.get(0).getAsJsonObject(), "sha", "");
            }
            DiffOpener.open(project, api, cid, sha, path);
            return;
        }
        long[] ids = new long[cids.size()];
        for (int i = 0; i < cids.size(); i++) ids[i] = cids.get(i).getAsLong();
        final String finalTitle = (title == null || title.isEmpty())
                ? "网页请求 · " + ids.length + " commits" : title;
        final String finalPath = path;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject res = api.combinedDiff(ids);
                List<DiffOpener.FileDiff> files = new ArrayList<>();
                JsonArray repos = res.getAsJsonArray("repos");
                if (repos != null) {
                    for (JsonElement rel : repos) {
                        JsonArray fs = rel.getAsJsonObject().getAsJsonArray("files");
                        if (fs == null) continue;
                        for (JsonElement fe : fs) {
                            JsonObject f = fe.getAsJsonObject();
                            if (f.has("binary") && f.get("binary").getAsBoolean()) continue;
                            files.add(new DiffOpener.FileDiff(
                                    f.get("path").getAsString(),
                                    str(f, "old", ""),
                                    str(f, "new", "")));
                        }
                    }
                }
                SwingUtilities.invokeLater(() -> DiffOpener.openCombined(project, finalTitle, files, finalPath));
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> Messages.showErrorDialog(project,
                        "打开网页请求的 diff 失败：" + ex.getMessage(), "TaskBoard"));
            }
        });
    }

    /** 上次铺设的顶层 Splitter（供实时应用/记忆比例用） */
    private static com.intellij.openapi.ui.Splitter lastTopSplitter;
    /** Review 工具条（开关点击后刷新勾选状态） */
    private ActionToolbar reviewToolbar;
    /** 选区捕获防抖定时器 */
    private Timer selectionTimer;
    /** 用户拖动分隔条时自动记住 diff 宽度比例 */
    private static final java.beans.PropertyChangeListener RATIO_SAVER = evt -> {
        if ("proportion".equals(evt.getPropertyName()) && evt.getSource() == lastTopSplitter
                && evt.getNewValue() instanceof Float f) {
            LayoutPrefs.setDiffRatio(f);
        }
    };

    /** 便捷：往动作组加一个带图标的开关（勾选=显示；点击后立即刷新工具条状态） */
    private void addToggle(DefaultActionGroup group, String text, String desc, Icon icon,
                           java.util.function.BooleanSupplier isOn,
                           java.util.function.Consumer<Boolean> setOn) {
        group.add(new ToggleAction(text, desc, icon) {
            @Override
            public boolean isSelected(@NotNull AnActionEvent e) {
                try {
                    return isOn.getAsBoolean();
                } catch (Throwable t) {
                    return false;
                }
            }

            @Override
            public void update(@NotNull AnActionEvent e) {
                super.update(e);
                // 勾选态可视化：☑/☐ 前缀 + 选中时的 Checked 图标
                boolean on = isSelected(e);
                e.getPresentation().setText((on ? "☑ " : "☐ ") + text);
                e.getPresentation().setIcon(on ? AllIcons.Actions.Checked : null);
            }

            @Override
            public void setSelected(@NotNull AnActionEvent e, boolean state) {
                setOn.accept(state);
                if (reviewToolbar != null) {
                    reviewToolbar.updateActionsImmediately();
                }
            }
        });
    }

    /** 便捷：往动作组加一个带图标动作 */
    private void addAction(DefaultActionGroup group, String text, String desc, Icon icon, Runnable runnable) {
        group.add(new AnAction(text, desc, icon) {
            @Override
            public void actionPerformed(@NotNull AnActionEvent e) {
                runnable.run();
            }
        });
    }

    // ================= 视图 A：节点选择 =================

    private JPanel buildSelectView() {
        JPanel p = new JPanel(new BorderLayout());

        DefaultActionGroup group = new DefaultActionGroup();
        addAction(group, "刷新", "重新加载需求树（" + api.base() + "）", AllIcons.Actions.Refresh, this::reloadTree);
        addAction(group, "拷贝上下文", "复制选中节点的上下文（节点信息+文档+PRD）到剪贴板", AllIcons.Actions.Copy, this::copySelectContext);
        addAction(group, "拷贝节点ID", "复制选中节点的 id 与名称（如 114 · 1.4 新增…）", AllIcons.Actions.Show, this::copySelectNodeId);
        addAction(group, "搜索", "按名称搜索节点并定位", AllIcons.Actions.Find, this::searchSelectNode);
        ActionToolbar toolbar = ActionManager.getInstance().createActionToolbar("TaskBoardSelect", group, true);
        toolbar.setTargetComponent(this);

        JPanel row1 = new JPanel(new BorderLayout(8, 0));
        row1.add(toolbar.getComponent(), BorderLayout.WEST);
        JPanel row2 = new JPanel(new BorderLayout(8, 0));
        row2.add(selectStatus, BorderLayout.WEST);
        JPanel north = new JPanel(new BorderLayout());
        north.add(row1, BorderLayout.NORTH);
        north.add(row2, BorderLayout.CENTER);
        p.add(north, BorderLayout.NORTH);

        selectTree.setRootVisible(false);
        selectTree.setShowsRootHandles(true);
        selectTree.getSelectionModel().setSelectionMode(TreeSelectionModel.SINGLE_TREE_SELECTION);
        selectTree.setCellRenderer(new SelectTreeRenderer());
        selectTree.setToolTipText("双击节点进入 Review");
        selectTree.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) enterReviewOnSelection();
            }
        });
        p.add(ScrollPaneFactory.createScrollPane(selectTree, true), BorderLayout.CENTER);
        return p;
    }

    /** Select 视图：当前选中的节点（未选中返回 null） */
    private NodeData selectedSelectNode() {
        Object o = selectTree.getLastSelectedPathComponent();
        if (o instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof NodeData d) {
            return d;
        }
        return null;
    }

    /** 拷贝选中节点 id（id · 名称） */
    private void copySelectNodeId() {
        NodeData d = selectedSelectNode();
        if (d == null) {
            selectStatus.setText("请先在树里选中一个节点");
            return;
        }
        CopyPasteManager.getInstance().setContents(new StringSelection(d.id + " · " + d.name));
        selectStatus.setText("已复制节点 ID：" + d.id + " · " + d.name);
    }

    /** 拷贝选中节点的上下文（节点 + 文档 + PRD） */
    private void copySelectContext() {
        final NodeData d = selectedSelectNode();
        if (d == null) {
            selectStatus.setText("请先在树里选中一个节点");
            return;
        }
        selectStatus.setText("正在生成上下文…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = api.nodeDocuments(d.id);
                String prdUrl = null;
                try {
                    prdUrl = findPrdUrl(d.id);
                } catch (Exception ignore) {
                    // 无 PRD 不阻断
                }
                StringBuilder md = new StringBuilder();
                md.append("## task-board 节点：").append(d.name).append("（id=").append(d.id).append("）\n");
                if (prdUrl != null) {
                    md.append("- PRD（飞书）：").append(prdUrl).append("\n");
                }
                if (docs != null) {
                    for (JsonElement el : docs) {
                        JsonObject doc = el.getAsJsonObject();
                        md.append("\n### ").append(str(doc, "name", "文档")).append("\n\n");
                        md.append(str(doc, "content", "")).append("\n");
                    }
                }
                final String text = md.toString();
                SwingUtilities.invokeLater(() -> {
                    CopyPasteManager.getInstance().setContents(new StringSelection(text));
                    selectStatus.setText("已复制「" + d.name + "」上下文（" + text.length() + " 字）——可直接粘贴给 Qoder");
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> selectStatus.setText("生成上下文失败：" + ex.getMessage()));
            }
        });
    }

    /** 搜索节点（按名称包含，定位并展开选中） */
    private void searchSelectNode() {
        String kw = Messages.showInputDialog(project, "输入节点名称关键词（支持部分匹配）：", "搜索节点", null);
        if (kw == null || kw.trim().isEmpty()) {
            return;
        }
        String k = kw.trim();
        List<TreePath> hits = new ArrayList<>();
        collectMatches(new TreePath(selectRoot), k, hits);
        if (hits.isEmpty()) {
            selectStatus.setText("未找到包含「" + k + "」的节点");
            return;
        }
        TreePath first = hits.get(0);
        selectTree.setSelectionPath(first);
        selectTree.scrollPathToVisible(first);
        String firstName = "";
        Object last = first.getLastPathComponent();
        if (last instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof NodeData nd) {
            firstName = nd.name;
        }
        selectStatus.setText("找到 " + hits.size() + " 个匹配，已定位到：「" + firstName + "」");
    }

    /** 递归收集名称包含关键词的节点路径 */
    private void collectMatches(TreePath path, String kw, List<TreePath> out) {
        Object last = path.getLastPathComponent();
        if (last instanceof DefaultMutableTreeNode n) {
            if (n.getUserObject() instanceof NodeData d && d.name != null && d.name.contains(kw)) {
                out.add(path);
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                collectMatches(path.pathByAddingChild(n.getChildAt(i)), kw, out);
            }
        }
    }

    public void reloadTree() {
        selectStatus.setText("加载中…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject res = api.tree();
                JsonArray nodes = res.getAsJsonArray("nodes");
                DefaultMutableTreeNode newRoot = new DefaultMutableTreeNode("task-board");
                if (nodes != null) {
                    for (JsonElement el : nodes) buildSelectNode(newRoot, el.getAsJsonObject());
                }
                SwingUtilities.invokeLater(() -> {
                    selectRoot.removeAllChildren();
                    while (newRoot.getChildCount() > 0) {
                        selectRoot.add((DefaultMutableTreeNode) newRoot.getChildAt(0));
                    }
                    selectModel.reload();
                    for (int i = 0; i < selectTree.getRowCount(); i++) selectTree.expandRow(i);
                    selectStatus.setText("就绪 · 共 " + countNodes(newRoot) + " 个节点（双击进入）");
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> selectStatus.setText(
                        "加载失败：" + e.getMessage() + "（task-board 服务是否已在 " + api.base() + " 运行？）"));
            }
        });
    }

    private int countNodes(DefaultMutableTreeNode n) {
        int c = n != selectRoot ? 1 : 0;
        for (int i = 0; i < n.getChildCount(); i++) c += countNodes((DefaultMutableTreeNode) n.getChildAt(i));
        return c;
    }

    private void buildSelectNode(DefaultMutableTreeNode parent, JsonObject o) {
        NodeData d = new NodeData();
        d.id = o.get("id").getAsLong();
        d.type = o.get("type").getAsString();
        d.name = o.get("name").getAsString();
        d.status = o.has("status") ? o.get("status").getAsString() : "";
        DefaultMutableTreeNode n = new DefaultMutableTreeNode(d);
        parent.add(n);
        if (o.has("children") && !o.get("children").isJsonNull()) {
            for (JsonElement c : o.getAsJsonArray("children")) buildSelectNode(n, c.getAsJsonObject());
        }
    }

    private void enterReviewOnSelection() {
        Object sel = selectTree.getLastSelectedPathComponent();
        if (sel instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof NodeData d) {
            enterReview(d);
        }
    }

    // ================= 视图 B：节点 Review =================

    private JPanel buildReviewView() {
        JPanel p = new JPanel(new BorderLayout());

        // ---- 顶部：平台工具栏 + 汇总 + 过滤 ----
        DefaultActionGroup group = new DefaultActionGroup();
        addAction(group, "退出", "返回节点选择", AllIcons.Actions.Back, () -> cardLayout.show(cards, CARD_SELECT));
        group.add(Separator.getInstance());
        group.add(new ToggleAction("提交列表", "展开/收起左侧 commit 列表（勾选/取消调整参与合并的范围）", AllIcons.Actions.ListFiles) {
            @Override
            public boolean isSelected(@NotNull AnActionEvent e) {
                return commitListVisible;
            }

            @Override
            public void setSelected(@NotNull AnActionEvent e, boolean state) {
                setCommitListVisible(state);
            }
        });
        group.add(Separator.getInstance());
        addAction(group, "标记通过", "对勾选的 commit 标记审查通过", AllIcons.Actions.Checked, () -> markChecked("approved", null));
        addAction(group, "标记有问题…", "对勾选的 commit 标记有问题（可填写意见）", AllIcons.Actions.Cancel, this::markCheckedWithNote);
        addAction(group, "重置待审", "对勾选的 commit 重置为待审", AllIcons.Actions.Rollback, () -> markChecked("pending", null));
        group.add(Separator.getInstance());
        addAction(group, "测试", "写提示词触发 agent（qodercli · DeepSeek-Flash）在关联仓库执行测试", AllIcons.Actions.Execute, () -> {
            if (currentNodeId < 0) {
                reviewSummary.setText("请先从节点树进入一个节点");
                return;
            }
            new TestRunnerDialog(project, api, currentNodeId, currentNodeName).show();
        });
        group.add(Separator.getInstance());
        addAction(group, "对照布局", "一键铺排：左 diff + 右列（需求概设⇄PRD） + TaskBoard底部（比例可在「布局设置」中调整）", AllIcons.Actions.SplitVertically, this::openReviewLayout);
        group.add(Separator.getInstance());
        addToggle(group, "diff", "勾选显示左侧 diff 栏；取消勾选则隐藏", AllIcons.Actions.Diff,
                () -> {
                    VirtualFile vf = DiffOpener.currentFile();
                    return vf != null && vf.isValid()
                            && FileEditorManagerEx.getInstanceEx(project).getEditors(vf).length > 0;
                },
                this::setDiffPaneVisible);
        addToggle(group, "文档", "勾选显示右侧文档窗口（需求概设/飞书 PRD）；取消勾选则隐藏", AllIcons.Actions.Preview,
                () -> {
                    FileEditorManagerEx fem = FileEditorManagerEx.getInstanceEx(project);
                    String docsPath = java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"),
                            "taskboard-docs", "taskboard-需求概设.md").toString();
                    VirtualFile docsVf = LocalFileSystem.getInstance().findFileByPath(docsPath);
                    if (docsVf != null && fem.getEditors(docsVf).length > 0) {
                        return true;
                    }
                    VirtualFile prdVf = PrdOpener.currentFile();
                    return prdVf != null && prdVf.isValid() && fem.getEditors(prdVf).length > 0;
                },
                this::setDocsPaneVisible);
        group.add(Separator.getInstance());
        addAction(group, "布局设置", "设置对照布局比例（diff 宽度 / TaskBoard 高度；拖动分隔条也会自动记住）", AllIcons.General.Settings, this::openLayoutSettings);
        addAction(group, "复制上下文", "复制当前任务+review 上下文（节点/勾选提交/变更文件）到剪贴板，可直接粘贴给 Qoder", AllIcons.Actions.Copy, this::copyReviewContext);
        addAction(group, "派给 Qoder", "生成任务提示词并打开 Qoder IDE 面板（提示词已复制，粘贴+回车即发送）", AllIcons.Actions.RunAll, this::dispatchToQoder);

        reviewToolbar = ActionManager.getInstance().createActionToolbar("TaskBoardReview", group, true);
        ActionToolbar toolbar = reviewToolbar;
        toolbar.setTargetComponent(this);

        onlyPending = new JBCheckBox("仅看待审");
        onlyPending.setToolTipText("只显示审查状态为「待审 ○」的提交（勾选/取消调整范围）");
        onlyPending.addActionListener(e -> rebuildReviewTree());

        JPanel north = new JPanel(new BorderLayout(8, 0));
        north.add(toolbar.getComponent(), BorderLayout.WEST);
        north.add(reviewSummary, BorderLayout.CENTER);
        north.add(onlyPending, BorderLayout.EAST);
        p.add(north, BorderLayout.NORTH);

        // ---- 左侧：commit 列表（默认收起） ----
        reviewTree = new CheckboxTree(new CheckboxTree.CheckboxTreeCellRenderer() {
            @Override
            public void customizeRenderer(JTree tree, Object value, boolean selected, boolean expanded,
                                          boolean leaf, int row, boolean hasFocus) {
                Object user = value instanceof DefaultMutableTreeNode n ? n.getUserObject() : null;
                if (user instanceof CommitItem ci) {
                    getTextRenderer().append(ci.display());
                }
            }
        }, reviewRoot);
        reviewTree.setRootVisible(false);
        reviewTree.setShowsRootHandles(true);
        reviewTree.addTreeSelectionListener(this::onCommitSelected);
        reviewTree.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) {
                    CommitItem ci = selectedCommit();
                    if (ci != null) DiffOpener.open(project, api, ci.cid, ci.sha);
                }
            }

            @Override
            public void mouseReleased(MouseEvent e) {
                if (checksDebounce == null) {
                    checksDebounce = new Timer(350, ev -> onChecksChanged());
                    checksDebounce.setRepeats(false);
                }
                checksDebounce.restart();
            }
        });
        commitScroll = ScrollPaneFactory.createScrollPane(reviewTree, true);

        // ---- 右侧：详情（文件变更树 + 信息） ----
        JPanel detailPanel = new JPanel(new BorderLayout());
        detailTree.setRootVisible(false);
        detailTree.setShowsRootHandles(true);
        detailTree.setCellRenderer(new DetailTreeRenderer());
        detailTree.setToolTipText("双击文件查看 IDEA Diff");
        detailTree.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() != 2) return;
                TreePath path = detailTree.getPathForLocation(e.getX(), e.getY());
                if (path == null) return;
                Object last = path.getLastPathComponent();
                if (last instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof FileNode fn) {
                    if (fn.oldText != null || fn.newText != null) {
                        // 聚合模式 → 打开整批合并变更的链 diff（定位到该文件，可上/下一文件切换）
                        DiffOpener.openCombined(project, aggregateTitle, aggregateFiles, fn.path);
                    } else {
                        DiffOpener.open(project, api, fn.cid, fn.sha, fn.path);
                    }
                }
            }
        });
        // 文件树（上）+ commit 信息区（下，独立滚动，可拖动分割）
        commitInfoPanel.setLayout(new BoxLayout(commitInfoPanel, BoxLayout.Y_AXIS));
        detailVertSplit = new JSplitPane(JSplitPane.VERTICAL_SPLIT,
                ScrollPaneFactory.createScrollPane(detailTree, true),
                ScrollPaneFactory.createScrollPane(commitInfoPanel, true));
        detailVertSplit.setResizeWeight(0.72);
        detailVertSplit.setDividerSize(6);
        detailVertSplit.setDividerLocation(0.72);
        detailPanel.add(detailVertSplit, BorderLayout.CENTER);

        reviewSplit = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, commitScroll, detailPanel);
        reviewSplit.setDividerSize(6);
        reviewSplit.setResizeWeight(0.0);
        p.add(reviewSplit, BorderLayout.CENTER);
        setCommitListVisible(false);
        return p;
    }

    /** 展开/收起左侧 commit 列表 */
    private void setCommitListVisible(boolean visible) {
        commitListVisible = visible;
        if (reviewSplit == null) return;
        commitScroll.setVisible(visible);
        reviewSplit.setDividerLocation(visible ? COMMIT_LIST_WIDTH : 0);
        reviewSplit.revalidate();
        reviewSplit.repaint();
    }

    private void enterReview(NodeData d) {
        currentNodeId = d.id;
        currentNodeName = d.name;
        // 切换节点时清空聚合缓存，避免对照布局误用上一个节点的数据
        aggregateFiles = new ArrayList<>();
        aggregateTitle = "";
        writeReviewContext();
        reviewSummary.setText("加载中…（" + d.name + "）");
        detailRoot.removeAllChildren();
        detailModel.reload();
        setCommitInfos(java.util.Collections.emptyList());
        diffCache.clear();
        // 默认收起 commit 列表（全勾选下直接看合并变更）；由用户点「提交列表」展开
        setCommitListVisible(false);
        cardLayout.show(cards, CARD_REVIEW);
        long token = ++requestToken;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject res = api.nodeTracks(d.id, "subtree");
                JsonArray items = res.getAsJsonArray("items");
                SwingUtilities.invokeLater(() -> {
                    if (token != requestToken) return;
                    commitItems.clear();
                    if (items != null) {
                        for (JsonElement el : items) commitItems.add(CommitItem.from(el.getAsJsonObject()));
                    }
                    rebuildReviewTree();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> {
                    if (token == requestToken) reviewSummary.setText("加载失败：" + e.getMessage());
                });
            }
        });
    }

    /** CheckboxTree 内部创建的 model（必须用它发变更通知，否则界面不刷新） */
    private DefaultTreeModel reviewModel() {
        return (DefaultTreeModel) reviewTree.getModel();
    }

    /** 重建 commit 列表（默认全部勾选；「仅看待审」过滤后同样全勾选） */
    private void rebuildReviewTree() {
        reviewRoot.removeAllChildren();
        for (CommitItem ci : commitItems) {
            if (onlyPending != null && onlyPending.isSelected() && !"pending".equals(ci.reviewStatus)) continue;
            CheckedTreeNode cn = new CheckedTreeNode(ci);
            cn.setChecked(true); // 默认全选 → 右侧直接展示全部合并变更
            reviewRoot.add(cn);
        }
        reviewModel().reload();
        updateReviewSummary(null);
        refreshDetailForChecked();
    }

    /** 勾选集合决定右侧：≥2 合并变更；1 该 commit；0 按当前选中 */
    private void refreshDetailForChecked() {
        List<CommitItem> checked = checkedCommits();
        if (checked.size() >= 2) {
            loadCombined(checked);
        } else if (checked.size() == 1) {
            showCommitDetail(checked.get(0));
        } else {
            CommitItem ci = selectedCommit();
            if (ci != null) {
                showCommitDetail(ci);
            } else {
                detailRoot.removeAllChildren();
                detailModel.reload();
                setCommitInfos(java.util.Collections.singletonList("<html><i>" + (commitItems.isEmpty() ? "暂无提交" : "未勾选任何提交") + "</i></html>"));
            }
        }
    }

    private void updateReviewSummary(String prefix) {
        long pending = 0, approved = 0, issue = 0;
        for (CommitItem ci : commitItems) {
            if ("approved".equals(ci.reviewStatus)) approved++;
            else if ("issue".equals(ci.reviewStatus)) issue++;
            else pending++;
        }
        reviewSummary.setText((prefix == null ? "" : prefix + " · ")
                + currentNodeName + " · 共 " + commitItems.size() + " 条 · ○" + pending + " / ✓" + approved + " / ✗" + issue);
    }

    private List<CommitItem> checkedCommits() {
        List<CommitItem> out = new ArrayList<>();
        Enumeration<?> e = reviewRoot.breadthFirstEnumeration();
        while (e.hasMoreElements()) {
            Object o = e.nextElement();
            if (o instanceof CheckedTreeNode cn && cn.isChecked() && cn.getUserObject() instanceof CommitItem ci) {
                out.add(ci);
            }
        }
        return out;
    }

    private CommitItem selectedCommit() {
        Object last = reviewTree.getLastSelectedPathComponent();
        if (last instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof CommitItem ci) return ci;
        return null;
    }

    private void markChecked(String statusValue, String note) {
        List<CommitItem> sel = checkedCommits();
        if (sel.isEmpty()) {
            reviewSummary.setText("请先在「提交列表」中勾选要操作的 commit");
            return;
        }
        int count = sel.size();
        reviewSummary.setText("更新审查状态中…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                for (CommitItem ci : sel) {
                    JsonObject res = api.updateCommitReview(ci.cid, statusValue, note);
                    ci.reviewStatus = res.has("reviewStatus") && !res.get("reviewStatus").isJsonNull()
                            ? res.get("reviewStatus").getAsString() : statusValue;
                    ci.reviewNote = res.has("reviewNote") && !res.get("reviewNote").isJsonNull()
                            ? res.get("reviewNote").getAsString() : ci.reviewNote;
                }
                SwingUtilities.invokeLater(() -> {
                    reviewModel().reload();
                    updateReviewSummary("已更新 " + count + " 条");
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("审查操作失败：" + e.getMessage()));
            }
        });
    }

    private void markCheckedWithNote() {
        if (checkedCommits().isEmpty()) {
            reviewSummary.setText("请先在「提交列表」中勾选要操作的 commit");
            return;
        }
        String note = JOptionPane.showInputDialog(reviewTree, "问题说明（可空）：", "标记有问题", JOptionPane.PLAIN_MESSAGE);
        if (note == null) return;
        markChecked("issue", note.isEmpty() ? null : note);
    }

    // ================= 详情区 =================

    private void onCommitSelected(TreeSelectionEvent e) {
        if (checkedCommits().size() >= 1) return; // 有勾选时由勾选决定右侧，选中不干扰
        CommitItem ci = selectedCommit();
        if (ci != null) showCommitDetail(ci);
    }

    /** 勾选变化（防抖后） */
    private void onChecksChanged() {
        refreshDetailForChecked();
        writeReviewContext();
    }

    // ---------- 多 commit 合并变更 ----------

    private void loadCombined(List<CommitItem> sel) {
        detailRoot.removeAllChildren();
        detailModel.reload();
        setCommitInfos(java.util.Collections.singletonList("<html><i>加载 " + sel.size() + " 个 commit 的合并变更…</i></html>"));
        long token = ++detailToken;
        long[] cids = new long[sel.size()];
        for (int i = 0; i < sel.size(); i++) cids[i] = sel.get(i).cid;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject res = api.combinedDiff(cids);
                SwingUtilities.invokeLater(() -> {
                    if (token != detailToken) return;
                    buildCombinedDetail(res, sel);
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> {
                    if (token == detailToken) {
                        setCommitInfos(java.util.Collections.singletonList("<html><font color='#D43A3A'>加载合并变更失败：" + esc(ex.getMessage()) + "</font></html>"));
                    }
                });
            }
        });
    }

    private void buildCombinedDetail(JsonObject res, List<CommitItem> sel) {
        DefaultMutableTreeNode root = new DefaultMutableTreeNode("root");
        JsonArray repos = res.getAsJsonArray("repos");
        int totalFiles = 0;
        aggregateTitle = "合并变更（" + sel.size() + " commits）";
        List<DiffOpener.FileDiff> agg = new ArrayList<>();
        if (repos != null) {
            for (JsonElement rel : repos) {
                JsonObject repoObj = rel.getAsJsonObject();
                String repoName = repoObj.getAsJsonObject("repo").get("name").getAsString();
                DefaultMutableTreeNode repoNode = new DefaultMutableTreeNode(new DirNode(repoName, true));
                root.add(repoNode);
                Map<String, DefaultMutableTreeNode> dirs = new LinkedHashMap<>();
                JsonArray files = repoObj.getAsJsonArray("files");
                if (files != null) {
                    for (JsonElement el : files) {
                        JsonObject f = el.getAsJsonObject();
                        FileNode fn = new FileNode();
                        fn.path = f.get("path").getAsString();
                        String[] parts = fn.path.split("/");
                        fn.name = parts[parts.length - 1];
                        fn.additions = f.has("additions") ? f.get("additions").getAsInt() : 0;
                        fn.deletions = f.has("deletions") ? f.get("deletions").getAsInt() : 0;
                        fn.binary = f.has("binary") && f.get("binary").getAsBoolean();
                        fn.title = aggregateTitle;
                        fn.oldText = f.has("old") && !f.get("old").isJsonNull() ? f.get("old").getAsString() : "";
                        fn.newText = f.has("new") && !f.get("new").isJsonNull() ? f.get("new").getAsString() : "";
                        if (!fn.binary) agg.add(new DiffOpener.FileDiff(fn.path, fn.oldText, fn.newText));
                        addFileUnder(repoNode, dirs, repoName, fn);
                        totalFiles++;
                    }
                }
                int cnt = 0;
                for (int i = 0; i < repoNode.getChildCount(); i++) {
                    DefaultMutableTreeNode c = (DefaultMutableTreeNode) repoNode.getChildAt(i);
                    if (isDirNode(c)) cnt += countAndCollapse(c);
                    else cnt++;
                }
                ((DirNode) repoNode.getUserObject()).fileCount = cnt;
            }
        }
        aggregateFiles = agg;
        writeReviewContext();
        detailRoot.removeAllChildren();
        while (root.getChildCount() > 0) detailRoot.add((DefaultMutableTreeNode) root.getChildAt(0));
        detailModel.reload();
        for (int i = 0; i < detailTree.getRowCount(); i++) detailTree.expandRow(i);

        // 信息区：列出参与合并的多个 commit（最新在前）
        JsonArray commits = res.getAsJsonArray("commits");
        List<String> infos = new ArrayList<>();
        if (commits != null) {
            for (int i = commits.size() - 1; i >= 0; i--) {
                JsonObject c = commits.get(i).getAsJsonObject();
                infos.add(commitInfoHtml(str(c, "note", ""), str(c, "sha", ""), str(c, "author", ""), str(c, "date", ""), c.getAsJsonArray("branches")));
            }
        }
        if (infos.isEmpty()) {
            infos.add("<html><i>合并变更 · 已选 " + sel.size() + " 个 commit · 共 " + totalFiles + " 个文件</i></html>");
        }
        setCommitInfos(infos);
    }

    private void showCommitDetail(CommitItem ci) {
        JsonObject cached = diffCache.get(ci.cid);
        if (cached != null) {
            buildDetail(cached, ci);
            return;
        }
        detailRoot.removeAllChildren();
        detailModel.reload();
        setCommitInfos(java.util.Collections.singletonList("<html><i>加载变更中… " + esc(ci.sha) + "</i></html>"));
        long token = ++detailToken;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject diff = api.commitDiff(ci.cid);
                SwingUtilities.invokeLater(() -> {
                    if (token != detailToken) return;
                    diffCache.put(ci.cid, diff);
                    buildDetail(diff, ci);
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> {
                    if (token == detailToken) {
                        setCommitInfos(java.util.Collections.singletonList("<html><font color='#D43A3A'>加载失败：" + esc(ex.getMessage()) + "</font></html>"));
                    }
                });
            }
        });
    }

    /** 构建 Git Log 式详情：目录层级文件树（路径压缩）+ commit 信息 */
    private void buildDetail(JsonObject diff, CommitItem ci) {
        String repoName = ci.repo == null || ci.repo.isEmpty() ? "changes" : ci.repo;
        DefaultMutableTreeNode root = new DefaultMutableTreeNode("root");
        DefaultMutableTreeNode repoNode = new DefaultMutableTreeNode(new DirNode(repoName, true));
        root.add(repoNode);
        Map<String, DefaultMutableTreeNode> dirs = new LinkedHashMap<>();
        JsonArray files = diff.getAsJsonArray("files");
        if (files != null) {
            for (JsonElement el : files) {
                JsonObject f = el.getAsJsonObject();
                FileNode fn = new FileNode();
                fn.cid = ci.cid;
                fn.sha = ci.sha;
                fn.path = f.get("path").getAsString();
                String[] parts = fn.path.split("/");
                fn.name = parts[parts.length - 1];
                fn.additions = f.has("additions") ? f.get("additions").getAsInt() : 0;
                fn.deletions = f.has("deletions") ? f.get("deletions").getAsInt() : 0;
                fn.binary = f.has("binary") && f.get("binary").getAsBoolean();
                addFileUnder(repoNode, dirs, repoName, fn);
            }
        }
        int total = 0;
        for (int i = 0; i < repoNode.getChildCount(); i++) {
            DefaultMutableTreeNode c = (DefaultMutableTreeNode) repoNode.getChildAt(i);
            if (isDirNode(c)) total += countAndCollapse(c);
            else total++;
        }
        ((DirNode) repoNode.getUserObject()).fileCount = total;

        detailRoot.removeAllChildren();
        while (root.getChildCount() > 0) detailRoot.add((DefaultMutableTreeNode) root.getChildAt(0));
        detailModel.reload();
        for (int i = 0; i < detailTree.getRowCount(); i++) detailTree.expandRow(i);

        setCommitInfos(java.util.Collections.singletonList(
                commitInfoHtml(ci.note, ci.sha, str(diff, "author", ""), str(diff, "date", ""), diff.getAsJsonArray("branches"))));
    }

    // ---------- 信息区（下方 commit 信息列表） ----------

    /** 展示一组 commit 信息（每项一段 HTML；空列表显示占位） */
    private void setCommitInfos(List<String> htmls) {
        commitInfoPanel.removeAll();
        if (htmls.isEmpty()) {
            JBLabel empty = new JBLabel(" ");
            empty.setBorder(BorderFactory.createEmptyBorder(6, 8, 6, 8));
            commitInfoPanel.add(empty);
        } else {
            for (int i = 0; i < htmls.size(); i++) {
                if (i > 0) {
                    JSeparator sep = new JSeparator();
                    sep.setMaximumSize(new Dimension(Integer.MAX_VALUE, sep.getPreferredSize().height));
                    commitInfoPanel.add(sep);
                }
                JBLabel label = new JBLabel(htmls.get(i));
                label.setBorder(BorderFactory.createEmptyBorder(6, 8, 6, 8));
                label.setVerticalAlignment(SwingConstants.TOP);
                commitInfoPanel.add(label);
            }
        }
        commitInfoPanel.revalidate();
        commitInfoPanel.repaint();
    }

    /** 单条 commit 信息 HTML：标题 / sha·作者·时间 / 分支 */
    private static String commitInfoHtml(String note, String sha, String author, String dateIso, JsonArray branches) {
        StringBuilder h = new StringBuilder("<html>");
        h.append("<b>").append(esc(note == null ? "" : note)).append("</b>");
        StringBuilder line2 = new StringBuilder();
        if (sha != null && !sha.isEmpty()) line2.append(sha.length() > 9 ? sha.substring(0, 9) : sha);
        if (author != null && !author.isEmpty()) {
            if (line2.length() > 0) line2.append("  ·  ");
            line2.append(esc(author));
        }
        String d = fmtDate(dateIso == null ? "" : dateIso);
        if (!d.isEmpty()) {
            if (line2.length() > 0) line2.append("  ·  ");
            line2.append(d);
        }
        if (line2.length() > 0) h.append("<br><font color='#808080'>").append(line2).append("</font>");
        if (branches != null && branches.size() > 0) {
            h.append("<br><font color='#5C6BC0'>🏷 ");
            for (int i = 0; i < Math.min(branches.size(), 4); i++) {
                if (i > 0) h.append("  ");
                h.append(esc(branches.get(i).getAsString()));
            }
            h.append("</font>");
        }
        h.append("</html>");
        return h.toString();
    }

    /** 按路径把文件挂到目录树（自动建目录节点） */
    private void addFileUnder(DefaultMutableTreeNode repoNode, Map<String, DefaultMutableTreeNode> dirs, String repoKey, FileNode fn) {
        String[] parts = fn.path.split("/");
        DefaultMutableTreeNode parent = repoNode;
        StringBuilder key = new StringBuilder(repoKey);
        for (int i = 0; i < parts.length - 1; i++) {
            key.append('/').append(parts[i]);
            DefaultMutableTreeNode dirNode = dirs.get(key.toString());
            if (dirNode == null) {
                dirNode = new DefaultMutableTreeNode(new DirNode(parts[i], false));
                parent.add(dirNode);
                dirs.put(key.toString(), dirNode);
            }
            parent = dirNode;
        }
        parent.add(new DefaultMutableTreeNode(fn));
    }

    private static boolean isDirNode(Object o) {
        return o instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof DirNode;
    }

    /** 递归：压缩单链目录（唯一子节点为目录且无文件时合并名称）+ 统计子树文件数 */
    private static int countAndCollapse(DefaultMutableTreeNode dirNode) {
        while (dirNode.getChildCount() == 1 && isDirNode(dirNode.getChildAt(0))) {
            DefaultMutableTreeNode child = (DefaultMutableTreeNode) dirNode.getChildAt(0);
            DirNode pd = (DirNode) dirNode.getUserObject();
            DirNode cd = (DirNode) child.getUserObject();
            dirNode.setUserObject(new DirNode(pd.name + "/" + cd.name, pd.repo));
            dirNode.removeAllChildren();
            while (child.getChildCount() > 0) dirNode.add((DefaultMutableTreeNode) child.getChildAt(0));
        }
        int count = 0;
        for (int i = 0; i < dirNode.getChildCount(); i++) {
            DefaultMutableTreeNode c = (DefaultMutableTreeNode) dirNode.getChildAt(i);
            if (isDirNode(c)) count += countAndCollapse(c);
            else count++;
        }
        ((DirNode) dirNode.getUserObject()).fileCount = count;
        return count;
    }

    private static String fmtDate(String iso) {
        if (iso == null || iso.length() < 16) return iso == null ? "" : iso;
        return iso.substring(0, 10).replace('-', '/') + " " + iso.substring(11, 16);
    }

    private static String str(JsonObject o, String key, String def) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : def;
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    // ================= 数据模型 =================

    private static class NodeData {
        long id;
        String type;
        String name;
        String status;

        @Override
        public String toString() {
            return name;
        }
    }

    private static class CommitItem {
        long cid;
        String sha;
        String note;
        String repo;
        String reviewStatus = "pending";
        String reviewNote;
        String reviewedBy;
        String test = "—";
        String pre = "—";
        String release = "—";

        static CommitItem from(JsonObject item) {
            CommitItem ci = new CommitItem();
            JsonObject c = item.getAsJsonObject("commit");
            ci.cid = c.get("id").getAsLong();
            ci.sha = c.get("sha").getAsString();
            ci.note = c.has("note") && !c.get("note").isJsonNull() ? c.get("note").getAsString() : "";
            ci.repo = c.has("repo") && !c.get("repo").isJsonNull() ? c.get("repo").getAsString() : "";
            ci.reviewStatus = c.has("reviewStatus") && !c.get("reviewStatus").isJsonNull()
                    ? c.get("reviewStatus").getAsString() : "pending";
            ci.reviewNote = c.has("reviewNote") && !c.get("reviewNote").isJsonNull() ? c.get("reviewNote").getAsString() : null;
            ci.reviewedBy = c.has("reviewedBy") && !c.get("reviewedBy").isJsonNull() ? c.get("reviewedBy").getAsString() : null;
            JsonObject track = item.has("track") && !item.get("track").isJsonNull() ? item.getAsJsonObject("track") : null;
            ci.test = stateOf(track, "test");
            ci.pre = stateOf(track, "pre");
            ci.release = stateOf(track, "release");
            return ci;
        }

        String reviewMark() {
            return switch (reviewStatus) {
                case "approved" -> "✓";
                case "issue" -> "✗";
                default -> "○";
            };
        }

        String display() {
            return reviewMark() + " " + sha + "  " + note;
        }

        String reviewTooltip() {
            StringBuilder sb = new StringBuilder();
            switch (reviewStatus) {
                case "approved" -> sb.append("已审查通过");
                case "issue" -> sb.append("审查有问题");
                default -> sb.append("待审查");
            }
            if (reviewedBy != null) sb.append(" · 审者: ").append(reviewedBy);
            if (reviewNote != null && !reviewNote.isEmpty()) sb.append(" · 意见: ").append(reviewNote);
            return sb.toString();
        }

        private static String stateOf(JsonObject track, String key) {
            if (track == null || !track.has(key) || track.get(key).isJsonNull()) return "—";
            JsonObject t = track.getAsJsonObject(key);
            if (!t.has("contained") || t.get("contained").isJsonNull()) return "—";
            return t.get("contained").getAsBoolean() ? "✓" : "✗";
        }
    }

    private static class DirNode {
        String name;
        final boolean repo;
        int fileCount;

        DirNode(String name, boolean repo) {
            this.name = name;
            this.repo = repo;
        }

        @Override
        public String toString() {
            return name;
        }
    }

    private static class FileNode {
        long cid;
        String sha;
        String path;
        String name;
        int additions;
        int deletions;
        boolean binary;
        // 聚合模式（多 commit 合并变更）：非 null 时直接打开本地 old/new，不再走 API
        String title;
        String oldText;
        String newText;

        @Override
        public String toString() {
            String stat = binary ? "  (二进制)" : "  (+" + additions + " / -" + deletions + ")";
            return name + stat;
        }
    }

    // ================= 渲染 =================

    private static class SelectTreeRenderer extends DefaultTreeCellRenderer {
        @Override
        public Component getTreeCellRendererComponent(JTree tree, Object value, boolean sel,
                                                      boolean expanded, boolean leaf, int row, boolean hasFocus) {
            super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, hasFocus);
            if (value instanceof DefaultMutableTreeNode n && n.getUserObject() instanceof NodeData d) {
                setText(d.name);
                setIcon(iconFor(d.type));
                setToolTipText("[" + d.type + "] " + d.name + "（双击进入 Review）");
            } else {
                setIcon(AllIcons.Nodes.Folder);
            }
            return this;
        }

        /** 按节点类型给平台图标（项目/需求/子需求/任务组/任务） */
        private static Icon iconFor(String type) {
            return switch (type) {
                case "project" -> AllIcons.Nodes.Project;
                case "requirement" -> AllIcons.Nodes.Module;
                case "subreq", "group" -> AllIcons.Nodes.Folder;
                case "task" -> AllIcons.General.TodoDefault;
                default -> AllIcons.Nodes.NodePlaceholder;
            };
        }
    }

    /** Git 风格渲染：原生文件夹/文件图标 + 灰色 N files + 绿加/红减统计 */
    private static class DetailTreeRenderer extends DefaultTreeCellRenderer {
        @Override
        public Component getTreeCellRendererComponent(JTree tree, Object value, boolean sel,
                                                      boolean expanded, boolean leaf, int row, boolean hasFocus) {
            super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, hasFocus);
            Object user = value instanceof DefaultMutableTreeNode n ? n.getUserObject() : null;
            if (user instanceof DirNode d) {
                setIcon(AllIcons.Nodes.Folder);
                String count = d.fileCount > 0
                        ? "&nbsp;&nbsp;<font color='#999999'>" + d.fileCount + " file" + (d.fileCount == 1 ? "" : "s") + "</font>"
                        : "";
                setText("<html>" + esc(d.name) + count + "</html>");
                setToolTipText(d.name);
            } else if (user instanceof FileNode f) {
                setIcon(FileTypeManager.getInstance().getFileTypeByFileName(f.name).getIcon());
                String stat = f.binary
                        ? ""
                        : "&nbsp;&nbsp;<font color='#57965C'>+" + f.additions + "</font> <font color='#C75450'>-" + f.deletions + "</font>";
                setText("<html>" + esc(f.name) + stat + "</html>");
                setToolTipText(f.path + "（双击查看 IDEA Diff）");
            }
            return this;
        }
    }
}
