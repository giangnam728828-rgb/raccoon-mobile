# 小浣熊移动端

商汤小浣熊的移动端客户端，直接对接官方云端接口，支持**手机号登录 + 多模型切换 + 深度思考 + 语音输入**，可打包成 APK。

## 组成

| 文件 | 作用 |
| --- | --- |
| `server.js` | 本地代理。负责手机号登录、保管登录态、拼官方客户端请求头、转发流式对话 |
| `public/` | 移动端前端（登录页 + 聊天页），纯静态，无需构建 |
| `test/smoke.js` | 冒烟测试：自带假上游，不联网、不需要账号 |
| `deploy/` | 手机端 proot 代理的开机自启脚本与说明 |
| `capacitor.config.json` | Capacitor 配置，把前端装进 Android WebView |
| `.github/workflows/build-apk.yml` | GitHub Actions，自动构建 APK |

前端只跟 `server.js` 说话，`server.js` 再去连 `xiaohuanxiong.com`。

## 快速开始（Web 版）

```bash
node server.js          # 无需 npm install，零第三方依赖
```

浏览器打开 `http://127.0.0.1:8799`，输入手机号 → 获取验证码 → 登录。

## 登录方式

### 手机号 + 短信验证码（默认）

流程与官方网页端完全一致：

1. 点「获取验证码」时，页面加载阿里云人机验证 SDK（`o.alicdn.com`）。
2. 大部分情况下风控会放行（无痕验证），你不用点任何东西；命中风控才会弹滑块。
3. 拿到 `captcha_token` 后提交给代理，代理把手机号按官方算法加密（AES-128-CFB）后请求 `/api/iam/v1/sms/send`。
4. 输入收到的验证码，代理请求 `/api/iam/v1/auth/login/sms` 换取 `access_token`，并落盘保存。

> 验证码只能由浏览器里的阿里云 SDK 换取，服务端伪造不了，所以这一步必须在页面里完成。
> 如果验证码一直加载失败，先用 Token 登录兜底。

### Token 登录（保留）

设置页以外的登录面板里有「使用 Token 登录」，粘贴 `access_token` 即可。代理会先拿它请求一次 `user_info` 验证，失效的 token 不会写进登录态。

## 部署给 APK 用

APK 里没有 Node 运行时，`server.js` 必须跑在**手机能访问到的机器**上（VPS / 家里电脑 / 云函数），然后在构建时把地址写进 APK。

```bash
# 跑在一台服务器上，监听所有网卡
HOST=0.0.0.0 PORT=8799 ACCESS_KEY=你的随机密钥 node server.js
```

强烈建议：

- 前面挂一层 HTTPS 反代（Caddy / Nginx），否则手机网络下明文 HTTP 可能被拦截；
- 一定设置 `ACCESS_KEY`，否则同网段任何人都能用你的账号烧积分（前端会把密钥一起打进 APK）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8799` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址。要让手机/局域网访问改成 `0.0.0.0` |
| `ACCESS_KEY` | 空 | 设置后所有 `/api/*` 需带 `x-access-key` |
| `DATA_DIR` | `./data` | 登录态落盘目录（`auth.json`，权限 600） |
| `UPSTREAM` | `https://xiaohuanxiong.com` | 上游地址，仅测试用 |
| `CAPTCHA_SCENE` / `CAPTCHA_PREFIX` / `CAPTCHA_REGION` | 官方网页端的公开配置 | 一般不用改 |

## 构建 APK（GitHub Actions）

推送到仓库后自动构建，也可以在 Actions 页面手动触发，填两个参数：

- `proxy_url`：代理地址，如 `https://raccoon.example.com`
- `access_key`：代理的访问密钥（没设就留空）

产物在 Actions 的 artifacts 里：`raccoon-mobile-apk`。

构建脚本会：注入地址与密钥 → 生成 Android 工程 → 打开明文 HTTP 开关 → 打包 debug APK。构建前会先跑一遍 `npm test`，测试不过就不出包。

## 手机端自启（proot）

APK 通过 `127.0.0.1:8799` 连本机代理。手机重启后 proot 里的 Node 不会自动起来，
APP 会一直转圈。自启方案见 **[deploy/README.md](deploy/README.md)**，核心是：

```bash
# Termux 侧
cp deploy/termux-boot.sh ~/.termux/boot/raccoon-proxy.sh && chmod +x ~/.termux/boot/raccoon-proxy.sh
# proot 侧
cp deploy/start-raccoon.sh /root/start-raccoon.sh && chmod +x /root/start-raccoon.sh
```

需要 Termux:Boot，并且把 Termux 的电池优化设为「无限制」。

## 测试

```bash
npm test
```

自带假上游，覆盖：发码参数校验、手机号加密、验证码校验、登录态落盘、`/api/me`、模型目录、SSE 透传、Token 登录、访问密钥、目录穿越等。

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 「连不上代理服务」 | `server.js` 没起，或 APK 里的 `proxy_url` 写错 |
| 「需要访问密钥」 | 服务端设了 `ACCESS_KEY`，构建时没填或填错 |
| 「人机验证组件加载失败」 | 访问不到 `o.alicdn.com`；换网络或用 Token 登录 |
| 登录后立刻退回登录页 | token 失效，重新登录；代理日志里会有上游 401 |
| 提示积分不足 | 小浣熊账号额度用完，去官网领每日积分或充值 |

## 说明

- 登录态只保存在代理服务本机，不上传任何第三方服务器。
- 对话消耗小浣熊账号额度，额度不足时在设置里领每日积分。
- 本项目是非官方客户端，接口由官方网页端推导而来，官方改版后可能需要跟着调整。
