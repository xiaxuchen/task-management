package com.xiaopeng.taskboard;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** task-board 本地服务 HTTP 客户端（127.0.0.1:3210） */
public class TaskBoardApi {
    public static final String DEFAULT_BASE = "http://127.0.0.1:3210";

    private final String base;
    private final HttpClient http;

    public TaskBoardApi(String base) {
        this.base = base;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build();
    }

    public String base() {
        return base;
    }

    private JsonObject getJson(String path) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + path))
                .timeout(Duration.ofSeconds(180))
                .GET()
                .build();
        return send(req);
    }

    /** 更新 commit 审查结果（pending / approved / issue） */
    public JsonObject updateCommitReview(long cid, String reviewStatus, String note) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("reviewStatus", reviewStatus);
        if (note != null) body.addProperty("note", note);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/commits/" + cid))
                .timeout(Duration.ofSeconds(30))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    private JsonElement sendAny(HttpRequest req) throws Exception {
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() >= 400) {
            String msg = "HTTP " + resp.statusCode();
            try {
                JsonObject err = JsonParser.parseString(resp.body()).getAsJsonObject().getAsJsonObject("error");
                if (err != null && err.has("message")) msg += ": " + err.get("message").getAsString();
            } catch (Exception ignore) {
                // 保持原始状态码
            }
            throw new IllegalStateException(msg);
        }
        return JsonParser.parseString(resp.body());
    }

    private JsonObject send(HttpRequest req) throws Exception {
        return sendAny(req).getAsJsonObject();
    }

    // ---------- nodes / documents（登记缺陷等） ----------

    /**
     * 审批合并：把当前节点（子任务）的开发分支合入所属子需求的「需求分支」（主仓库执行）。
     * 服务端会做安全判定：已合入→跳过；有未解决冲突→拒绝。
     */
    public JsonObject mergeNode(long nodeId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/merge"))
                .timeout(Duration.ofSeconds(120))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build();
        return send(req);
    }

    /**
     * 上跳合并：子需求「需求分支」→ 集成分支（默认 feature-merge）。
     * 可增量重复合：已合入跳过；有新内容→再 merge。
     */
    public JsonObject mergeUpstream(long nodeId, String targetBranch) throws Exception {
        JsonObject body = new JsonObject();
        if (targetBranch != null && !targetBranch.isEmpty()) {
            body.addProperty("targetBranch", targetBranch);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/merge-upstream"))
                .timeout(Duration.ofSeconds(180))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    /** 合并预览（MR 式）：将合入的变更统计 + 冲突预判 */
    public JsonObject mergePreview(long nodeId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/merge-preview"))
                .timeout(Duration.ofSeconds(120))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build();
        return send(req);
    }

    /** 合入状态（组/子需求级）：子任务的开发分支是否已合入需求分支 */
    public JsonObject mergeStatus(long nodeId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/merge-status"))
                .timeout(Duration.ofSeconds(90))
                .header("x-taskboard-actor", "idea")
                .GET()
                .build();
        return send(req);
    }

    /** 创建节点（如缺陷：type=defect） */
    public JsonObject createNode(long parentId, String type, String name) throws Exception {
        JsonObject body = new JsonObject();
        if (parentId > 0) {
            body.addProperty("parentId", parentId);
        }
        body.addProperty("type", type);
        body.addProperty("name", name);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes"))
                .timeout(Duration.ofSeconds(15))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    /** 读取提示词模板（/api/config 的 promptTemplates 段） */
    public JsonObject getPromptTemplates() throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/config"))
                .timeout(Duration.ofSeconds(10))
                .header("x-taskboard-actor", "idea")
                .GET()
                .build();
        JsonObject cfg = send(req);
        return cfg.has("promptTemplates") && cfg.get("promptTemplates").isJsonObject()
                ? cfg.getAsJsonObject("promptTemplates") : new JsonObject();
    }

    /** 写入/覆盖节点文档 */
    public JsonObject upsertDocument(long nodeId, String name, String content) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("name", name);
        body.addProperty("content", content);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/documents/upsert"))
                .timeout(Duration.ofSeconds(15))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    // ---------- comments（diff 行级评论） ----------

    /** 添加 diff 行级评论 */
    public JsonObject addComment(long nodeId, String filePath, String commitSha,
                                 int lineStart, int lineEnd, String snippet, String content) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("filePath", filePath);
        if (commitSha != null && !commitSha.isEmpty()) {
            body.addProperty("commitSha", commitSha);
        }
        body.addProperty("lineStart", lineStart);
        body.addProperty("lineEnd", lineEnd);
        if (snippet != null && !snippet.isEmpty()) {
            body.addProperty("snippet", snippet);
        }
        body.addProperty("content", content);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/comments"))
                .timeout(Duration.ofSeconds(15))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    /** 列出某节点的评论 */
    public JsonArray listComments(long nodeId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/comments"))
                .timeout(Duration.ofSeconds(15))
                .header("x-taskboard-actor", "idea")
                .GET()
                .build();
        return sendAny(req).getAsJsonArray();
    }

    /** 按文件（可选 sha）查评论 */
    public JsonArray listCommentsByFile(String filePath, String commitSha) throws Exception {
        String url = base + "/api/comments?filePath="
                + java.net.URLEncoder.encode(filePath, java.nio.charset.StandardCharsets.UTF_8);
        if (commitSha != null && !commitSha.isEmpty()) {
            url += "&commitSha=" + commitSha;
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .header("x-taskboard-actor", "idea")
                .GET()
                .build();
        return sendAny(req).getAsJsonArray();
    }

    /** 更新评论状态（open/resolved） */
    public JsonObject updateComment(long id, String status) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("status", status);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/comments/" + id))
                .timeout(Duration.ofSeconds(15))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .method("PATCH", HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    /** 触发 agent 运行（异步；默认 qodercli + DeepSeek-Flash） */
    public JsonObject startAgentRun(long nodeId, String prompt) throws Exception {
        return startAgentRun(nodeId, prompt, false);
    }

    /** ideMode=true：只创建运行记录（由 Qoder IDE 前台会话执行），不后台 spawn */
    public JsonObject startAgentRun(long nodeId, String prompt, boolean ideMode) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("prompt", prompt);
        if (ideMode) {
            body.addProperty("ideMode", true);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/agent-runs"))
                .timeout(Duration.ofSeconds(30))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    /** 节点 agent 运行历史（倒序） */
    public JsonArray listAgentRuns(long nodeId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/agent-runs"))
                .timeout(Duration.ofSeconds(30))
                .GET()
                .build();
        return sendAny(req).getAsJsonArray();
    }

    /** 多 commit 合并变更（MR 式）：按仓库分组、文件并集、净 old/new */
    public JsonObject combinedDiff(long[] cids) throws Exception {
        JsonArray arr = new JsonArray();
        for (long c : cids) arr.add(c);
        JsonObject body = new JsonObject();
        body.add("cids", arr);
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/commits/combined-diff"))
                .timeout(Duration.ofSeconds(180))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return send(req);
    }

    /** 单个节点（含 attrs / parentId） */
    public JsonObject nodeGet(long nodeId) throws Exception {
        return getJson("/api/nodes/" + nodeId);
    }

    /** 节点文档列表（含正文） */
    public JsonArray nodeDocuments(long nodeId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/nodes/" + nodeId + "/documents"))
                .timeout(Duration.ofSeconds(30))
                .GET()
                .build();
        return sendAny(req).getAsJsonArray();
    }

    /** 轮询领取下一个 IDE 打开请求（无则返回 null） */
    public JsonObject getNextIdeRequest() throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/ide/requests/next"))
                .timeout(Duration.ofSeconds(15))
                .GET()
                .build();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (resp.statusCode() == 204 || resp.body() == null || resp.body().isBlank()) return null;
        if (resp.statusCode() >= 400) throw new IllegalStateException("HTTP " + resp.statusCode());
        JsonElement el = JsonParser.parseString(resp.body());
        return el.isJsonObject() ? el.getAsJsonObject() : null;
    }

    /** 回报 IDE 请求完成 */
    public void completeIdeRequest(long id) throws Exception {
        JsonObject body = new JsonObject();
        body.addProperty("status", "done");
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/ide/requests/" + id + "/complete"))
                .timeout(Duration.ofSeconds(15))
                .header("content-type", "application/json")
                .header("x-taskboard-actor", "idea")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        send(req);
    }

    /** 单条 agent 运行（轮询用） */
    public JsonObject getAgentRun(long runId) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/api/agent-runs/" + runId))
                .timeout(Duration.ofSeconds(30))
                .GET()
                .build();
        return send(req);
    }

    /** 树：{revision, nodes:[...]} */
    public JsonObject tree() throws Exception {
        return getJson("/api/tree");
    }

    /** 节点提交聚合（含合并状态）：{scope, count, items:[{commit, repo, track, error}]} */
    public JsonObject nodeTracks(long nodeId, String scope) throws Exception {
        return getJson("/api/nodes/" + nodeId + "/tracks?scope=" + scope);
    }

    /** 单 commit diff：{commit, repo, sha, subject, files:[{path, old, new, patch, ...}]} */
    public JsonObject commitDiff(long cid) throws Exception {
        return getJson("/api/commits/" + cid + "/diff");
    }

    public JsonObject health() throws Exception {
        return getJson("/api/health");
    }
}
