# 功能：MR 自动拉取

## 所属计划

计划 5。

## 需求

- 子需求按「GitLab 项目 + 分支」调用 GitLab API 拉取 **MR 列表与状态**（只读，不创建 MR）
- **前置**：已配置 `gitlab.base_url` + `token`；节点为 `subreq`，且 `branch`、`gitlab_project` 属性非空
- 调用 `GET {base_url}/api/v4/projects/{urlencode(project)}/merge_requests?source_branch={branch}&state=all&per_page=100`，带 `PRIVATE-TOKEN` 头；**分页最多 3 页（300 条）**
- 映射：`iid` / `title` / `state` / `source_branch` / `web_url` / `updated_at`
- 按 `(node_id, project, iid)` **upsert**；本次未返回的既有记录**保留不删**，前端以「上次拉取时间」提示可能过期
- 任何失败都**不改动既有 MR 数据**

## 接口（设计文档 §6）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/nodes/:id/mrs` | 该节点已拉取的 MR 列表 |
| POST | `/api/nodes/:id/mrs/refresh` | 拉取 MR → `{pulled, created, updated, errors[]}` |
| POST | `/api/config/gitlab/test` | GitLab 连通性测试（返回当前用户与项目可达性）|

## 验收标准

- 未配置 → 400 `GITLAB_NOT_CONFIGURED` + 引导去设置页
- 401 → 502 `GITLAB_AUTH_FAILED`（提示 token 无效）；404 → 502 `GITLAB_PROJECT_NOT_FOUND`（提示项目路径错）
- 网络异常 / 超时（10s）→ 502 `GITLAB_UNAVAILABLE`，**既有 MR 数据不变**
- 重复刷新幂等（同 `project + iid` 更新而非新增）
- `branch` 或 `gitlab_project` 为空 → 返回提示要求先补填属性