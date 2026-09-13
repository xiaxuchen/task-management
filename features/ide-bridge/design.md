# 设计 · IDE 桥

## 设计要点

- 表 `ide_requests`（kind=open-diff、payload JSON、status、created_at、handled_at）
- 写入（网页）：`POST /api/ide/open-diff {cids, path?, title?}`——创建时**自动补全 commits 明细**
  （cid/sha/repo/note，供插件直接使用）
- 领取（插件轮询）：`GET /api/ide/requests/next`——原子 claim：置 `processing` 并返回；
  领取前先重置**卡住的 processing**（>30s 回 pending）与**过期请求**（>10min → expired）；空队列 204
- 完成回报：`POST /api/ide/requests/:id/complete {status: done|failed}`
- 插件侧：TaskBoardPanel 每 3s 轮询（javax.swing.Timer，本地轻量）；单 commit → DiffOpener.open(定位文件)；
  多 commit → combinedDiff 拉取后 openCombined（合并变更链）
- 该桥属 UI 间通信，不进 TOOLS 清单（同 health 处理）
