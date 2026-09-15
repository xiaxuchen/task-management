# 图片上传功能提交记录

> 状态：**已实现**（计划 5）。

- docs(uploads): 建立功能文档 —— prd（需求 + 接口表 + 验收标准）、design（base64 JSON / 落盘命名 / 校验顺序 / Vditor handler）
- feat(uploads): 图片上传闭环——新增 server/uploads.mjs 共享核心（扩展名白名单 + ≤10 MB + 魔数交叉校验，改名/伪装一律拦下，落盘 <时间戳>-<随机>.<真实扩展名> 不覆盖）；HTTP POST /api/uploads（201）+ /uploads 静态托管挂在 createApp 内（先于 SPA 回退）；CLI upload <路径> / --name+--data；MCP upload_image（纳入 TOOLS 能力清单）；DocPane 接入 Vditor upload.handler（粘贴/拖拽/工具栏）+ 立即落库；13 条 UT 覆盖核心校验、三入口 1:1 与四入口落盘语义一致；npm test 257/257，npm run build 通过
