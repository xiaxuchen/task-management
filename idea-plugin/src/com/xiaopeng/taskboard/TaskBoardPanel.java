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
        cards.add(buildSelectView(), CARD_SELECT);
        cards.add(buildReviewView(), CARD_REVIEW);
        add(cards, BorderLayout.CENTER);
        startIdeBridgePolling();
    }

    // ---------- 需求 + 概设 / PRD ----------

    /** 一键对照布局：左侧 diff（当前聚合或选中提交） + 右侧 需求+概设文档（含 PRD 链接）分屏 */
    private void openReviewLayout() {
        if (currentNodeId < 0) {
            reviewSummary.setText("请先从节点树进入一个节点");
            return;
        }
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = api.nodeDocuments(currentNodeId);
                String prdUrl = null;
                try {
                    prdUrl = findPrdUrl(currentNodeId);
                } catch (Exception ignore) {
                    // 无 PRD 链接不阻断
                }
                final JsonArray finalDocs = docs;
                final String finalPrdUrl = prdUrl;
                SwingUtilities.invokeLater(() -> {
                    // 1) 左侧：diff（优先当前聚合变更，其次选中 commit）
                    List<DiffOpener.FileDiff> files = aggregateFiles;
                    if (files != null && !files.isEmpty()) {
                        DiffOpener.openCombined(project, aggregateTitle, files, null);
                    } else {
                        CommitItem sel = selectedCommit();
                        if (sel != null) DiffOpener.open(project, api, sel.cid, sel.sha, null);
                    }
                    // 2) 右侧：需求+概设文档（含 PRD 链接）分屏
                    openDocsBesideWith(finalDocs, finalPrdUrl);
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("铺布局失败：" + ex.getMessage()));
            }
        });
    }

    /** 打开需求 PRD：编辑器区新开一个 JCEF tab（形如普通文件），首次需在 tab 内登录飞书，登录态持久 */
    private void openPrd() {
        if (currentNodeId < 0) {
            reviewSummary.setText("请先从节点树进入一个节点");
            return;
        }
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                String url = findPrdUrl(currentNodeId);
                if (url == null) {
                    SwingUtilities.invokeLater(() -> Messages.showInfoMessage(project,
                            "未找到 PRD 链接（在需求节点属性 feishu_url 中配置）", "PRD"));
                    return;
                }
                final String u = url;
                SwingUtilities.invokeLater(() -> {
                    PrdOpener.open(project, u, currentNodeName);
                    reviewSummary.setText("已在编辑器区打开 PRD（新 tab）：" + u);
                });
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("打开 PRD 失败：" + ex.getMessage()));
            }
        });
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

    /** 把当前节点的全部文档（需求内容/设计方案）合并为 markdown，在旁侧编辑器打开对照 diff */
    private void openDocsBeside() {
        if (currentNodeId < 0) {
            reviewSummary.setText("请先从节点树进入一个节点");
            return;
        }
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray docs = api.nodeDocuments(currentNodeId);
                String prdUrl = null;
                try {
                    prdUrl = findPrdUrl(currentNodeId);
                } catch (Exception ignore) {
                    // 无 PRD 链接不阻断文档打开
                }
                final JsonArray finalDocs = docs;
                final String finalPrdUrl = prdUrl;
                SwingUtilities.invokeLater(() -> openDocsBesideWith(finalDocs, finalPrdUrl));
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> reviewSummary.setText("打开文档失败：" + ex.getMessage()));
            }
        });
    }

    /** 构建合并 markdown（含 PRD 链接行）并在右侧分屏打开（EDT 调用） */
    private void openDocsBesideWith(JsonArray docs, String prdUrl) {
        try {
            if (docs == null || docs.size() == 0) {
                Messages.showInfoMessage(project, "该节点暂无文档（需求内容 / 设计方案）", "需求+概设");
                return;
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
            VirtualFile vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(file.toString());
            if (vf == null) {
                reviewSummary.setText("打开文档失败（临时文件未刷新）");
                return;
            }
            FileEditorManagerEx fem = FileEditorManagerEx.getInstanceEx(project);
            EditorWindow window = fem.getCurrentWindow();
            if (window != null) {
                // 分屏（左右），并在新分屏中打开合并文档 → 与 diff 并排对照
                window.split(JSplitPane.HORIZONTAL_SPLIT, true, vf, true);
            } else {
                new OpenFileDescriptor(project, vf).navigate(true);
            }
            reviewSummary.setText("已打开「" + currentNodeName + "」文档（" + docs.size() + " 份），可与 diff 对照查看");
        } catch (Exception ex) {
            reviewSummary.setText("打开文档失败：" + ex.getMessage());
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
        ActionToolbar toolbar = ActionManager.getInstance().createActionToolbar("TaskBoardSelect", group, true);
        toolbar.setTargetComponent(this);

        JPanel north = new JPanel(new BorderLayout(8, 0));
        north.add(toolbar.getComponent(), BorderLayout.WEST);
        north.add(selectStatus, BorderLayout.CENTER);
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
        addAction(group, "需求+概设", "在旁侧编辑器打开该节点的需求内容/设计方案，与 diff 对照查看", AllIcons.Actions.Preview, this::openDocsBeside);
        addAction(group, "PRD", "在编辑器区打开该需求对应的飞书 PRD（节点属性 prdAnchor 可配锚点）", AllIcons.General.Web, this::openPrd);
        addAction(group, "对照布局", "一键铺排：左侧 diff（当前变更） + 右侧 PRD 分屏对照", AllIcons.Actions.SplitVertically, this::openReviewLayout);
        ActionToolbar toolbar = ActionManager.getInstance().createActionToolbar("TaskBoardReview", group, true);
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
