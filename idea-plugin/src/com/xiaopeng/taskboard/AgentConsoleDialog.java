package com.xiaopeng.taskboard;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.icons.AllIcons;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Agent 控制台（运行时 / 会话 / 任务 三层模型，风格对齐 multica）
 *
 * 顶部：运行时状态条（在线运行时数 + 派单目标）
 * 中部：会话选择（自动复用活动会话 / 新建 / 续跑同一 CLI 会话）+ 提示词 + 派单按钮
 * 底部：任务列表（状态胶囊 + attempt + 失败原因）与消息流（按 seq 增量拉取）
 *
 * 与旧 TestRunnerDialog 的差别：从「一堆孤立的运行记录」升级成
 * 「会话内可续跑的任务链」，并能取消 / 重试。
 */
public class AgentConsoleDialog extends DialogWrapper {

    private final Project project;
    private final TaskBoardApi api;
    private final long nodeId;

    private final JTextArea promptArea = new JTextArea(4, 70);
    private final JTextArea streamArea = new JTextArea(18, 80);
    private final JComboBox<RunItem> runBox = new JComboBox<>();
    private final JComboBox<SessionItem> sessionBox = new JComboBox<>();
    private final JCheckBox resumeBox = new JCheckBox("续跑会话（--resume）");
    private final JBLabel statusLabel = new JBLabel(" ");
    private final JBLabel runtimeLabel = new JBLabel(" ");
    private final JButton runButton = new JButton("▶ 后台运行（qodercli）");
    private final JButton qoderButton = new JButton("⚡ 在 Qoder IDE 运行（前台）");
    private final JButton newSessionButton = new JButton("新会话");
    private final JButton cancelButton = new JButton("取消任务");
    private final JButton retryButton = new JButton("重试");

    private final List<RunItem> runs = new ArrayList<>();
    private final List<SessionItem> sessions = new ArrayList<>();
    private Timer pollTimer;
    private long streamedSeq = 0;

    public AgentConsoleDialog(Project project, TaskBoardApi api, long nodeId, String nodeName) {
        super(project);
        this.project = project;
        this.api = api;
        this.nodeId = nodeId;
        setTitle("Agent 控制台 · " + nodeName);
        init();
        loadRuntimes();
        loadSessions(this::loadHistory);
    }

    @Override
    protected @Nullable JComponent createCenterPanel() {
        JPanel p = new JPanel(new BorderLayout(8, 8));
        p.setBorder(JBUI.Borders.empty(8));

        // ---- 顶部：运行时状态 + 派单目标 ----
        JPanel top = new JPanel(new BorderLayout(8, 6));
        top.add(runtimeLabel, BorderLayout.NORTH);

        promptArea.setRows(4);
        promptArea.setLineWrap(true);
        promptArea.setWrapStyleWord(true);
        top.add(new JBScrollPane(promptArea), BorderLayout.CENTER);

        JPanel ctl = new JPanel(new BorderLayout(8, 0));
        JPanel left = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        left.add(new JBLabel("会话："));
        sessionBox.setPreferredSize(new Dimension(280, sessionBox.getPreferredSize().height));
        left.add(sessionBox);
        left.add(newSessionButton);
        left.add(resumeBox);
        ctl.add(left, BorderLayout.WEST);
        JPanel btnRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        btnRow.add(runButton);
        btnRow.add(qoderButton);
        btnRow.add(cancelButton);
        btnRow.add(retryButton);
        ctl.add(btnRow, BorderLayout.CENTER);
        top.add(ctl, BorderLayout.SOUTH);
        p.add(top, BorderLayout.NORTH);

        newSessionButton.addActionListener(e -> newSession());
        runButton.addActionListener(e -> startRun(false));
        qoderButton.addActionListener(e -> startRun(true));
        cancelButton.addActionListener(e -> cancelSelected());
        retryButton.addActionListener(e -> retrySelected());
        sessionBox.addActionListener(e -> loadHistory());
        runBox.addActionListener(e -> renderSelectedRun());

        // ---- 底部：任务列表 + 消息流 ----
        JPanel center = new JPanel(new BorderLayout(6, 6));
        JPanel runRow = new JPanel(new BorderLayout(8, 0));
        runRow.add(runBox, BorderLayout.CENTER);
        runRow.add(statusLabel, BorderLayout.EAST);
        center.add(runRow, BorderLayout.NORTH);

        streamArea.setEditable(false);
        streamArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));
        streamArea.setLineWrap(true);
        streamArea.setWrapStyleWord(false);
        JBScrollPane sp = new JBScrollPane(streamArea);
        sp.setPreferredSize(new Dimension(900, 320));
        center.add(sp, BorderLayout.CENTER);
        p.add(center, BorderLayout.CENTER);

        p.setPreferredSize(new Dimension(960, 620));
        return p;
    }

    @Override
    protected Action @NotNull [] createActions() {
        return new Action[]{ getCancelAction() };
    }

    @Override
    protected void dispose() {
        if (pollTimer != null) pollTimer.stop();
        super.dispose();
    }

    // ---------- 数据模型 ----------

    private static class RunItem {
        long id;
        long sessionId;
        String status = "running";
        String prompt = "";
        String agent = "";
        String model = "";
        String cwd = "";
        String output = "";
        String startedAt = "";
        int attempt = 1;
        String failureReason = null;
        boolean resumed = false;

        /** 状态胶囊文案（与 multica 的 task-status-pill 口径一致） */
        String label() {
            String badge = switch (status) {
                case "success" -> "✓ 成功";
                case "failed" -> "✗ 失败";
                case "timeout" -> "⏱ 超时";
                case "cancelled" -> "⊘ 已取消";
                default -> "… 运行中";
            };
            String ts = startedAt.length() >= 16 ? startedAt.substring(11, 16) : "";
            String pp = prompt.replace('\n', ' ');
            if (pp.length() > 40) pp = pp.substring(0, 40) + "…";
            String attemptTag = attempt > 1 ? "  ·#" + attempt : "";
            String resumeTag = resumed ? "  ·续跑" : "";
            return "#" + id + "  " + badge + attemptTag + resumeTag + "  " + ts + "  " + pp;
        }

        boolean isActive() {
            return "running".equals(status);
        }

        @Override
        public String toString() {
            return label();
        }
    }

    private static class SessionItem {
        long id;
        String agent = "";
        String title = "";
        String cliSessionId = null;
        int runCount = 0;
        String status = "active";

        boolean canResume() {
            return cliSessionId != null && !cliSessionId.isEmpty();
        }

        @Override
        public String toString() {
            String t = title == null || title.isEmpty() ? ("会话 #" + id) : title;
            String resume = canResume() ? "  ·可续跑" : "";
            String archived = "archived".equals(status) ? "  ·已归档" : "";
            return t + "  （" + agent + "， " + runCount + " 次）" + resume + archived;
        }
    }

    private static String str(JsonObject o, String key, String def) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : def;
    }

    private static long lng(JsonObject o, String key, long def) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsLong() : def;
    }

    private static boolean bool(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() && o.get(key).getAsBoolean();
    }

    private static RunItem runFrom(JsonObject o) {
        RunItem r = new RunItem();
        r.id = lng(o, "id", -1);
        r.sessionId = lng(o, "sessionId", -1);
        r.status = str(o, "status", "running");
        r.prompt = str(o, "prompt", "");
        r.agent = str(o, "agent", "");
        r.model = str(o, "model", "");
        r.cwd = str(o, "cwd", "");
        r.output = str(o, "output", "");
        r.startedAt = str(o, "startedAt", "");
        r.attempt = (int) lng(o, "attempt", 1);
        r.failureReason = str(o, "failureReason", null);
        r.resumed = bool(o, "resumed");
        return r;
    }

    private static SessionItem sessionFrom(JsonObject o) {
        SessionItem s = new SessionItem();
        s.id = lng(o, "id", -1);
        s.agent = str(o, "agent", "");
        s.title = str(o, "title", "");
        s.cliSessionId = str(o, "cliSessionId", null);
        s.runCount = (int) lng(o, "runCount", 0);
        s.status = str(o, "status", "active");
        return s;
    }

    // ---------- 加载 ----------

    /** 运行时状态条：在线运行时数 + 本机是否有可用目标 */
    private void loadRuntimes() {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject res = api.listRuntimes();
                JsonObject summary = res.has("summary") && res.get("summary").isJsonObject()
                        ? res.getAsJsonObject("summary") : new JsonObject();
                long total = lng(summary, "runtimes", 0);
                long online = lng(summary, "online", 0);
                SwingUtilities.invokeLater(() -> {
                    if (total == 0) {
                        runtimeLabel.setText("运行时：无（派单时会自动注册本机 qodercli）");
                        runtimeLabel.setIcon(null);
                    } else {
                        runtimeLabel.setText("运行时：" + online + "/" + total + " 在线");
                        runtimeLabel.setIcon(online > 0 ? AllIcons.General.InspectionsOK : AllIcons.General.Warning);
                    }
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> runtimeLabel.setText("运行时：读取失败（" + e.getMessage() + "）"));
            }
        });
    }

    private void loadSessions(Runnable then) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray arr = api.listAgentSessions(nodeId);
                List<SessionItem> items = new ArrayList<>();
                if (arr != null) {
                    for (var el : arr) items.add(sessionFrom(el.getAsJsonObject()));
                }
                SwingUtilities.invokeLater(() -> {
                    sessions.clear();
                    sessions.addAll(items);
                    refreshSessionBox();
                    if (then != null) then.run();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> {
                    statusLabel.setText("加载会话失败：" + e.getMessage());
                    if (then != null) then.run();
                });
            }
        });
    }

    private void refreshSessionBox() {
        SessionItem keep = selectedSession();
        sessionBox.removeAllItems();
        for (SessionItem s : sessions) sessionBox.addItem(s);
        if (keep != null) {
            for (int i = 0; i < sessionBox.getItemCount(); i++) {
                if (sessionBox.getItemAt(i).id == keep.id) {
                    sessionBox.setSelectedIndex(i);
                    return;
                }
            }
        }
        if (sessionBox.getItemCount() > 0) sessionBox.setSelectedIndex(0);
    }

    private SessionItem selectedSession() {
        Object o = sessionBox.getSelectedItem();
        return o instanceof SessionItem s ? s : null;
    }

    private void loadHistory() {
        SessionItem s = selectedSession();
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray arr = api.listAgentRuns(nodeId);
                List<RunItem> items = new ArrayList<>();
                if (arr != null) {
                    for (var el : arr) {
                        RunItem r = runFrom(el.getAsJsonObject());
                        if (s != null && r.sessionId != s.id) continue;
                        items.add(r);
                    }
                }
                SwingUtilities.invokeLater(() -> {
                    runs.clear();
                    runs.addAll(items);
                    refreshRunBox();
                    statusLabel.setText(runs.isEmpty() ? "暂无任务——写提示词后点「运行」" : "共 " + runs.size() + " 个任务");
                    syncPolling();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> statusLabel.setText("加载任务失败：" + e.getMessage()));
            }
        });
    }

    private void refreshRunBox() {
        RunItem keep = selectedRun();
        runBox.removeAllItems();
        for (RunItem r : runs) runBox.addItem(r);
        if (keep != null) {
            for (int i = 0; i < runBox.getItemCount(); i++) {
                if (runBox.getItemAt(i).id == keep.id) {
                    runBox.setSelectedIndex(i);
                    return;
                }
            }
        }
        if (runBox.getItemCount() > 0) runBox.setSelectedIndex(0);
        updateActionButtons();
    }

    private RunItem selectedRun() {
        Object o = runBox.getSelectedItem();
        return o instanceof RunItem r ? r : null;
    }

    private void updateActionButtons() {
        RunItem r = selectedRun();
        cancelButton.setEnabled(r != null && r.isActive());
        retryButton.setEnabled(r != null && !r.isActive());
        SessionItem s = selectedSession();
        resumeBox.setEnabled(s != null && s.canResume());
        if (s == null || !s.canResume()) resumeBox.setSelected(false);
    }

    // ---------- 渲染 ----------

    /** 渲染选中任务：任务头信息 + 消息流（按 seq 增量拉取，避免整块重读） */
    private void renderSelectedRun() {
        RunItem r = selectedRun();
        updateActionButtons();
        if (r == null) {
            streamArea.setText("");
            return;
        }
        StringBuilder head = new StringBuilder();
        head.append("#").append(r.id).append("  ").append(r.status);
        head.append("  ·  ").append(r.agent).append("/").append(r.model);
        head.append("  ·  cwd: ").append(r.cwd);
        head.append("  ·  attempt ").append(r.attempt);
        if (r.failureReason != null && !r.failureReason.isEmpty()) {
            head.append("  ·  ").append(r.failureReason);
        }
        head.append("\n").append("-".repeat(80)).append("\n");
        streamArea.setText(head.toString());
        statusLabel.setText("#" + r.id + " · " + r.status + " · 会话 " + r.sessionId);

        // 切换任务时重置流位置，从 0 重新拉这条任务的消息流
        streamedSeq = 0;
        pullMessages(r);
    }

    /** 拉取新消息并追加到消息流末尾（按 seq 增量） */
    private void pullMessages(RunItem r) {
        long runId = r.id;
        long since = streamedSeq;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray arr = api.listAgentRunMessages(runId, since);
                if (arr == null || arr.size() == 0) return;
                SwingUtilities.invokeLater(() -> {
                    // 用户可能已切走这条任务：丢弃过期批次
                    RunItem cur = selectedRun();
                    if (cur == null || cur.id != runId) return;
                    StringBuilder sb = new StringBuilder();
                    for (var el : arr) {
                        JsonObject m = el.getAsJsonObject();
                        long seq = lng(m, "seq", 0);
                        if (seq > streamedSeq) streamedSeq = seq;
                        sb.append(formatMessage(m)).append("\n");
                    }
                    streamArea.append(sb.toString());
                    streamArea.setCaretPosition(streamArea.getDocument().getLength());
                });
            } catch (Exception ignore) {
                // 单次拉取失败忽略，下次轮询继续
            }
        });
    }

    /** 消息流一行的展示（对标 multica 的 task_message type/tool/content/output） */
    private static String formatMessage(JsonObject m) {
        String type = str(m, "type", "text");
        String content = str(m, "content", "");
        if (content == null || content.isEmpty()) content = str(m, "output", "");
        String tool = str(m, "tool", null);
        String prefix = switch (type) {
            case "error" -> "✗ ";
            case "tool_use" -> "⚙ " + (tool == null ? "tool" : tool) + " ";
            case "tool_result" -> "↳ ";
            case "thinking" -> "… ";
            default -> "";
        };
        return prefix + (content == null ? "" : content);
    }

    // ---------- 会话 ----------

    private void newSession() {
        newSessionButton.setEnabled(false);
        statusLabel.setText("新建会话…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                api.startAgentSession(nodeId);
                loadSessions(() -> {
                    SwingUtilities.invokeLater(() -> newSessionButton.setEnabled(true));
                    statusLabel.setText("已新建会话");
                    loadHistory();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> {
                    newSessionButton.setEnabled(true);
                    statusLabel.setText("新建会话失败：" + e.getMessage());
                });
            }
        });
    }

    // ---------- 派单 ----------

    /** 派单：ideMode=true = Qoder IDE 前台（只建记录），false = 后台 qodercli 执行 */
    private void startRun(boolean ideMode) {
        String prompt = promptArea.getText().trim();
        if (prompt.isEmpty()) {
            statusLabel.setText("请先输入提示词");
            return;
        }
        SessionItem s = selectedSession();
        Long sessionId = s == null ? null : s.id;
        boolean resume = resumeBox.isSelected() && s != null && s.canResume();
        runButton.setEnabled(false);
        qoderButton.setEnabled(false);
        statusLabel.setText(ideMode ? "提交给 Qoder IDE…" : "提交中…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject run = ideMode
                        ? api.startAgentRun(nodeId, prompt, true, sessionId)
                        : api.startAgentRun(nodeId, prompt, null, "qodercli", sessionId, resume, null);
                RunItem item = runFrom(run);
                SwingUtilities.invokeLater(() -> {
                    runButton.setEnabled(true);
                    qoderButton.setEnabled(true);
                    runs.add(0, item);
                    refreshRunBox();
                    runBox.setSelectedIndex(0);
                    renderSelectedRun();
                    syncPolling();
                    loadRuntimes();
                    if (ideMode) {
                        String fullPrompt = buildQoderPrompt(prompt, item.id);
                        boolean ok = QoderOpener.dispatch(project, fullPrompt);
                        statusLabel.setText(ok
                                ? "已在 Qoder 打开（任务 #" + item.id + "）——粘贴（⌘V）+ 回车发送"
                                : "提示词已复制（任务 #" + item.id + "）——请手动打开 Qoder 面板粘贴发送");
                    }
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> {
                    runButton.setEnabled(true);
                    qoderButton.setEnabled(true);
                    statusLabel.setText("启动失败：" + e.getMessage());
                });
            }
        });
    }

    /** 给 Qoder Agent 的完整提示词（附带任务编号与回写说明） */
    private String buildQoderPrompt(String userPrompt, long runId) {
        return userPrompt
                + "\n\n---\n（本条任务对应 task-board 任务 #" + runId
                + "。完成后请调用 task-board MCP 工具 agent_run_update（id=" + runId
                + "，status=success/failed，output=结论摘要，cliSessionId=本次 CLI 会话号）回写结果。）";
    }

    private void cancelSelected() {
        RunItem r = selectedRun();
        if (r == null || !r.isActive()) return;
        int ok = Messages.showYesNoDialog(project,
                "取消任务 #" + r.id + "？服务端会终止本地子进程。", "取消任务", Messages.getQuestionIcon());
        if (ok != Messages.YES) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                api.cancelAgentRun(r.id);
                SwingUtilities.invokeLater(() -> {
                    statusLabel.setText("已取消任务 #" + r.id);
                    loadHistory();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> statusLabel.setText("取消失败：" + e.getMessage()));
            }
        });
    }

    private void retrySelected() {
        RunItem r = selectedRun();
        if (r == null || r.isActive()) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                api.retryAgentRun(r.id);
                SwingUtilities.invokeLater(() -> {
                    statusLabel.setText("已创建重试任务（原任务 #" + r.id + "）");
                    loadHistory();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> statusLabel.setText("重试失败：" + e.getMessage()));
            }
        });
    }

    // ---------- 轮询（2s） ----------

    private void syncPolling() {
        boolean anyRunning = runs.stream().anyMatch(RunItem::isActive);
        if (anyRunning) {
            if (pollTimer == null) {
                pollTimer = new Timer(2000, e -> pollOnce());
                pollTimer.start();
            } else if (!pollTimer.isRunning()) {
                pollTimer.start();
            }
        } else if (pollTimer != null) {
            pollTimer.stop();
        }
    }

    private void pollOnce() {
        for (RunItem r : new ArrayList<>(runs)) {
            if (!r.isActive()) continue;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                try {
                    JsonObject o = api.getAgentRun(r.id);
                    RunItem fresh = runFrom(o);
                    SwingUtilities.invokeLater(() -> {
                        r.status = fresh.status;
                        r.output = fresh.output;
                        r.failureReason = fresh.failureReason;
                        refreshRunBox();
                        RunItem cur = selectedRun();
                        if (cur != null && cur.id == r.id) pullMessages(r);
                        syncPolling();
                    });
                } catch (Exception ignore) {
                    // 单次轮询失败忽略，下次继续
                }
            });
        }
    }
}
