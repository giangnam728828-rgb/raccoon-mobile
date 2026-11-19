#!/data/data/com.termux/files/usr/bin/sh
# ============================================================
# Termux:Boot 开机自启脚本
# 放置位置：~/.termux/boot/raccoon-proxy.sh
# 前置条件：安装 Termux:Boot（F-Droid），并至少手动打开一次 App
# ============================================================

# 防止 CPU 休眠时被杀
termux-wake-lock 2>/dev/null

LOG="$HOME/raccoon-boot.log"
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

log "boot start"

# 等待网络就绪（最多 60 秒），否则首次请求会失败
i=0
while [ $i -lt 30 ]; do
  if ping -c 1 -W 1 223.5.5.5 >/dev/null 2>&1; then
    log "network ok after ${i}x2s"
    break
  fi
  i=$((i + 1))
  sleep 2
done

# 已在运行就不要重复拉起
if curl -s --max-time 3 http://127.0.0.1:8799/api/health >/dev/null 2>&1; then
  log "already running, skip"
  exit 0
fi

# 进入 proot 分发版并启动守护脚本
# 如果分发版名字不是 ubuntu，改这里
DISTRO="ubuntu"
log "starting proot:$DISTRO"
proot-distro login "$DISTRO" -- /root/start-raccoon.sh >> "$LOG" 2>&1 &
log "proot launched pid=$!"
