#!/bin/sh
# 小浣熊移动端 —— 启动脚本
#
# 只在本机用：
#   sh start.sh
#
# 给手机 / 局域网用（务必设访问密钥，否则同网段的人都能用你的账号）：
#   HOST=0.0.0.0 ACCESS_KEY=换成随机串 sh start.sh
#
# 后台常驻：
#   nohup sh start.sh > raccoon.log 2>&1 &
cd "$(dirname "$0")"
exec node server.js
