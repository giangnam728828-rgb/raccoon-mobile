#!/bin/sh
# 小浣熊移动端 —— 启动脚本
# 用法：sh start.sh   （前台运行）/  nohup sh start.sh & （后台）
cd "$(dirname "$0")"
exec node server.js
