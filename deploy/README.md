# 手机端代理开机自启（proot）

APK 里的 `API_BASE` 是 `http://127.0.0.1:8799`，指向手机本机的 Node 代理。
手机重启后 proot 里的 `node server.js` 不会自己起来，APP 就会一直转圈。
这里给一套开机自启方案。

---

## 一、准备（只做一次）

| 项 | 说明 |
| --- | --- |
| Termux | 从 **F-Droid** 装，不要用 Play 商店版（已停更、包名冲突） |
| Termux:Boot | F-Droid 装，**装完手动打开一次**，否则收不到开机广播 |
| proot-distro | Termux 里执行 `pkg install proot-distro` |
| Ubuntu | `proot-distro install ubuntu` |
| Node | 见下方「在 proot 里装 Node」 |

### 关闭电池优化（关键）

Android 会把后台进程冻死，自启也白搭。设置路径大致是：

```
设置 → 应用 → Termux → 电池 → 无限制 / 允许后台活动
设置 → 应用 → Termux:Boot → 电池 → 无限制
```

各家 ROM 位置不同（小米在「省电策略 → 无限制」，华为在「应用启动管理 → 手动管理」）。
不开这个，锁屏几分钟后代理就被杀了。

### 在 proot 里装 Node

```bash
proot-distro login ubuntu
apt update && apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v        # 应输出 v20.x
```

把仓库放进 proot（两种都行）：

```bash
# 方式 A：proot 内直接 clone
git clone https://github.com/giangnam728828-rgb/raccoon-mobile.git /root/workspace/raccoon-mobile

# 方式 B：从手机存储拷进去（Termux 里执行）
proot-distro login ubuntu -- bash -c \
  'mkdir -p /root/workspace && cp -r /sdcard/Download/raccoon-mobile /root/workspace/'
```

---

## 二、放脚本

**Termux 侧**（不是 proot 里）：

```bash
mkdir -p ~/.termux/boot
cp ~/raccoon-mobile/deploy/termux-boot.sh ~/.termux/boot/raccoon-proxy.sh
chmod +x ~/.termux/boot/raccoon-proxy.sh
```

**proot 侧**：

```bash
proot-distro login ubuntu
cp /root/workspace/raccoon-mobile/deploy/start-raccoon.sh /root/start-raccoon.sh
chmod +x /root/start-raccoon.sh
exit
```

如果仓库不在 `/root/workspace/raccoon-mobile`，改 `start-raccoon.sh` 顶部的 `APP_DIR`。

---

## 三、验证

先手动跑一次，确认能起来：

```bash
# Termux 里
proot-distro login ubuntu -- /root/start-raccoon.sh
```

另开一个 Termux 会话：

```bash
curl -s http://127.0.0.1:8799/api/health
# 期望: {"ok":true,"upstream":"https://xiaohuanxiong.com","loggedIn":false}
```

再测开机自启：

```bash
# 重启手机后等 30 秒，Termux 里执行
cat ~/raccoon-boot.log
curl -s http://127.0.0.1:8799/api/health
```

`~/raccoon-boot.log` 里应该能看到 `boot start` → `network ok` → `proot launched`。

---

## 四、常见问题

**Q：重启后端口没起来，日志里只有 `boot start`**

`proot-distro login` 没跑起来。检查：Termux:Boot 是否真的打开过一次；
`~/.termux/boot/` 里的脚本是否有 `+x`；Termux 是否被电池优化杀了。

**Q：日志显示 `EADDRINUSE`**

上一次的 node 还活着。`pkill -f "node server.js"` 再重试，或者直接重启手机。
脚本本身不会重复拉起（启动前会先探 health）。

**Q：APP 提示「无法连接代理」**

1. `curl 127.0.0.1:8799/api/health` 通不通
2. 通了但 APP 不通 → APK 里的地址写错了（重新构建时传 `proxy_url`）
3. 都不通 → proot 里的 node 挂了，看 `/root/raccoon-proxy.log`

**Q：用一段时间手机发烫 / 耗电**

proot + Node 常驻本身有成本。如果只是偶尔用，可以不用开机自启，
改成用的时候手动 `proot-distro login ubuntu -- /root/start-raccoon.sh`。

**Q：想换端口**

`start-raccoon.sh` 里的 `PORT` 改掉，同时 APK 构建时的 `proxy_url` 也要跟着改。

---

## 五、可选：加个桌面快捷方式

在 Termux 里装 `Termux:Widget`，然后：

```bash
mkdir -p ~/.shortcuts
cat > ~/.shortcuts/启动小浣熊 <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
proot-distro login ubuntu -- /root/start-raccoon.sh
EOF
chmod +x ~/.shortcuts/启动小浣熊
```

桌面添加 Termux:Widget 组件，就能一键启动。
