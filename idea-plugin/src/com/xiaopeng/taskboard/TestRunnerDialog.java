package com.xiaopeng.taskboard;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.List;

/**
 * 测试运行对话框：写提示词 → 触发 agent（qodercli · DeepSeek-Flash）→ 实时查看输出与历史。
 * 运行在节点关联仓库目录中执行，输出每 2 秒轮询刷新。
 */
public class TestRunnerDialog extends DialogWrapper {

    private final TaskBoardApi api;
    private final long nodeId;

    private final JTextArea promptArea = new JTextArea(4, 70);
    private final JTextArea outputArea = new JTextArea(18, 80);
    private final JComboBox<String> historyBox = new JComboBox<>();
    private final JLabel statusLabel = new JLabel(" ");
    private final JButton runButton = new JButton("▶ 运行（qodercli · DeepSeek-Flash）");
    private final List<RunItem> runs = new ArrayList<>();
    private Timer pollTimer;

    public TestRunnerDialog(Project project, TaskBoardApi api, long nodeId, String nodeName) {
        super(project);
        this.api = api;
        this.nodeId = nodeId;
        setTitle("测试运行 · " + nodeName);
        init();
        loadHistory();
    }

    @Override
    protected @Nullable JComponent createCenterPanel() {
        JPanel p = new JPanel(new BorderLayout(8, 8));

        JPanel top = new JPanel(new BorderLayout(4, 4));
        top.add(new JLabel("提示词（agent 将在该节点关联的仓库目录中执行）："), BorderLayout.NORTH);
        promptArea.setRows(4);
        promptArea.setLineWrap(true);
        promptArea.setWrapStyleWord(true);
        top.add(new JScrollPane(promptArea), BorderLayout.CENTER);
        JPanel runRow = new JPanel(new BorderLayout(8, 0));
        runRow.add(runButton, BorderLayout.WEST);
        runRow.add(statusLabel, BorderLayout.CENTER);
        top.add(runRow, BorderLayout.SOUTH);
        runButton.addActionListener(e -> startRun());
        p.add(top, BorderLayout.NORTH);

        JPanel center = new JPanel(new BorderLayout(4, 4));
        center.add(historyBox, BorderLayout.NORTH);
        historyBox.addActionListener(e -> showSelectedRun());
        outputArea.setEditable(false);
        outputArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));
        center.add(new JScrollPane(outputArea), BorderLayout.CENTER);
        p.add(center, BorderLayout.CENTER);

        p.setPreferredSize(new Dimension(880, 580));
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
        String status = "running";
        String prompt = "";
        String agent = "";
        String model = "";
        String cwd = "";
        String output = "";
        String startedAt = "";

        String label() {
            String st = switch (status) {
                case "success" -> "✓ 成功";
                case "failed" -> "✗ 失败";
                case "timeout" -> "⏱ 超时";
                default -> "… 运行中";
            };
            String ts = startedAt.length() >= 16 ? startedAt.substring(11, 16) : "";
            String pp = prompt.replace('\n', ' ');
            if (pp.length() > 46) pp = pp.substring(0, 46) + "…";
            return "#" + id + "   " + st + "   " + ts + "   " + pp;
        }
    }

    private static RunItem from(JsonObject o) {
        RunItem r = new RunItem();
        r.id = o.get("id").getAsLong();
        r.status = str(o, "status", "running");
        r.prompt = str(o, "prompt", "");
        r.agent = str(o, "agent", "");
        r.model = str(o, "model", "");
        r.cwd = str(o, "cwd", "");
        r.output = str(o, "output", "");
        r.startedAt = str(o, "startedAt", "");
        return r;
    }

    private static String str(JsonObject o, String key, String def) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : def;
    }

    // ---------- 加载与展示 ----------

    private void loadHistory() {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonArray arr = api.listAgentRuns(nodeId);
                List<RunItem> items = new ArrayList<>();
                if (arr != null) {
                    for (var el : arr) items.add(from(el.getAsJsonObject()));
                }
                SwingUtilities.invokeLater(() -> {
                    runs.clear();
                    runs.addAll(items);
                    refreshBox();
                    statusLabel.setText(runs.isEmpty() ? "暂无运行记录——写提示词后点「运行」" : "共 " + runs.size() + " 条记录");
                    syncPolling();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> statusLabel.setText("加载历史失败：" + e.getMessage()));
            }
        });
    }

    /** 重建下拉列表并尽量保持原选择 */
    private void refreshBox() {
        String sel = (String) historyBox.getSelectedItem();
        historyBox.removeAllItems();
        for (RunItem r : runs) historyBox.addItem(r.label());
        if (sel != null) {
            for (int i = 0; i < historyBox.getItemCount(); i++) {
                if (sel.equals(historyBox.getItemAt(i))) {
                    historyBox.setSelectedIndex(i);
                    return;
                }
            }
        }
        if (historyBox.getItemCount() > 0) historyBox.setSelectedIndex(0);
    }

    private RunItem selectedRun() {
        int i = historyBox.getSelectedIndex();
        return i >= 0 && i < runs.size() ? runs.get(i) : null;
    }

    private void showSelectedRun() {
        RunItem r = selectedRun();
        if (r == null) {
            outputArea.setText("");
            return;
        }
        outputArea.setText(r.output);
        outputArea.setCaretPosition(outputArea.getDocument().getLength());
        statusLabel.setText("#" + r.id + " · " + r.status + " · cwd: " + r.cwd);
    }

    // ---------- 运行 ----------

    private void startRun() {
        String prompt = promptArea.getText().trim();
        if (prompt.isEmpty()) {
            statusLabel.setText("请先输入提示词");
            return;
        }
        runButton.setEnabled(false);
        statusLabel.setText("提交中…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                JsonObject run = api.startAgentRun(nodeId, prompt);
                RunItem item = from(run);
                SwingUtilities.invokeLater(() -> {
                    runButton.setEnabled(true);
                    runs.add(0, item);
                    refreshBox();
                    historyBox.setSelectedIndex(0);
                    showSelectedRun();
                    syncPolling();
                });
            } catch (Exception e) {
                SwingUtilities.invokeLater(() -> {
                    runButton.setEnabled(true);
                    statusLabel.setText("启动失败：" + e.getMessage());
                });
            }
        });
    }

    // ---------- 轮询（2s） ----------

    private void syncPolling() {
        boolean anyRunning = false;
        for (RunItem r : runs) {
            if ("running".equals(r.status)) {
                anyRunning = true;
                break;
            }
        }
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
            if (!"running".equals(r.status)) continue;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                try {
                    JsonObject o = api.getAgentRun(r.id);
                    RunItem fresh = from(o);
                    SwingUtilities.invokeLater(() -> {
                        r.status = fresh.status;
                        r.output = fresh.output;
                        refreshBox();
                        showSelectedRun();
                        syncPolling();
                    });
                } catch (Exception ignore) {
                    // 单次轮询失败忽略，下次继续
                }
            });
        }
    }
}
