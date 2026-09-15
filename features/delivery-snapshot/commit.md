# 提交记录：交付证据快照

- feat(delivery-snapshot): 交付证据快照——显式冻结当前 delivery_gate 的完整依据与 SHA-256 指纹，后续读取实时核对并返回 current / drifted，历史结论不可变；新增 delivery_snapshots 表与 v6 迁移、store 三类能力、HTTP / CLI / MCP 三入口 1:1、renderDeliverySnapshotMd 与 NodeDrawer「交付」页冻结入口；补齐 store actor 白名单中的 mcp / system，修复 MCP 操作者被降级为 user 的审计缺口；新增 9 条回归覆盖不可变性、漂移、scope、revision、级联和三入口
