#!/bin/bash
# task-board ⇄ Qoder hook 桥的启动包装：兜底定位 node（IDE 的 hook 环境 PATH 可能不含 nvm）
LOG=/tmp/taskboard-qoder-bridge.log
NODE_BIN="$(command -v node 2>/dev/null)"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(ls -t "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)"
fi
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(ls -t /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -1)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] wrapper: node not found (PATH=$PATH)" >> "$LOG"
  exit 0
fi
exec "$NODE_BIN" "$(cd "$(dirname "$0")" && pwd)/qoder-bridge.mjs"
