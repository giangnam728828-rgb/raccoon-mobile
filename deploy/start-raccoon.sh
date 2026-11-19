#!/bin/bash
# ============================================================
# proot 容器内的守护脚本
# 放置位置：/root/start-raccoon.sh（proot Ubuntu 内）
# 作用：崩溃自动重启、限制日志体积、启动即监听
# ============================================================

APP_DIR="${APP_DIR:-/root/workspace/raccoon-mobile}"
PORT="${PORT:-8799}"
LOG="/root/raccoon-proxy.log"
MAX_LOG=$((2 * 1024 * 1024))   # 2MB 后轮转

export PORT
export HOST=0.0.0.0
export ACCESS_KEY="${ACCESS_KEY:-}"     # 需要鉴权就填一个随机串

cd "$APP_DIR" || { echo "目录不存在: $APP_DIR"; exit 1; }

echo "[$(date '+%F %T')] 守护启动 app=$APP_DIR port=$PORT"

while true; do
  # 日志超过上限就截断，避免长期跑把手机存储写满
  if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt "$MAX_LOG" ]; then
    mv -f "$LOG" "$LOG.1"
  fi

  echo "[$(date '+%F %T')] node server.js 启动" >> "$LOG"
  node server.js >> "$LOG" 2>&1
  code=$?
  echo "[$(date '+%F %T')] 退出 code=$code，3 秒后重启" >> "$LOG"
  sleep 3
done
