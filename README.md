# 小浣熊移动端

商汤小浣熊的移动端客户端，直接对接官方云端接口，可打包成 APK。**手机号登录 + 多模型切换 + 推理强度 7 档 + 图片问答 + 文件导入 + 流式输出 + Markdown/代码块 + 多会话 + 提示词库 + 语音输入 + 朗读 + 云端备份**。

> v1.4 起 **App 自己直连官方**，手机上不需要再跑任何代理服务。

## 界面

设计方向是「纸与墨」，配色直接从应用图标里取样：纸白 `#FAF1EE`、墨 `#2E262C`、玫瑰 `#A5525D`、樱粉 `#CC838B`。

- AI 回答是一张摊开的白纸，左侧一道代表书写中笔迹的墨线；用户消息是右侧便签。
- 一套 1.6 描边的线性图标（30+ 个内联 SVG symbol），没有 emoji，没有渐变，没有彩色光晕。
- 底部标签栏（对话 / 记录 / 我的），弹层从底部升起。
- 深色模式是「夜间的纸」`#171315`，不是纯黑。
- 全套 `env(safe-area-inset-*)` 适配。

## 能力

| 能力 | 说明 |
| --- | --- |
| 推理强度 | 关闭 / 极简 / 轻量 / 标准 / 深入 / 更深 / 最强；模型不支持时入口自动禁用并说明原因 |
| 图片问答 | 拍照或相册，自动压到最长边 1400px，一次最多 6 张；点图片可全屏查看 |
| 文件导入 | `.txt/.md/.csv/.json` 等文本文件读入当前提问，单文件上限 200KB |
| 消息操作 | 长按：复制 / 重新生成 / 朗读 / 分享 / 编辑并重发 / 删除 |
| 朗读 | 系统 TTS，再点一次停止 |
| 提示词库 | 6 条内置 + 自定义，可新建删除，一键填入输入框 |
| 多会话 | 置顶 / 重命名 / 删除 / 按标题或内容搜索 |
| 主题与字号 | 跟随系统 / 浅色 / 深色；正文字号三档实时生效 |
| 云端备份 | 对话按账号存到自建代理，换手机或重装后可恢复 |
| 用量统计 | 每条回答显示 tokens 数 |
| 语音输入 | 系统 `SpeechRecognition`，不可用时自动隐藏 |

## 组成

| 路径 | 作用 |
| --- | --- |
| `public/index.html` | 结构 + 内联图标集 |
| `public/css/` | 设计令牌 / 基础层 / 界面层 |
| `public/js/core.js` | DOM、格式化、Toast、弹层、剪贴板 |
| `public/js/store.js` | 状态与持久化（会话、偏好、提示词） |
| `public/js/api.js` | 通道选择、模型归一化、流式对话 |
| `public/js/ui.js` | 壳：标签页、主题、字号、弹层装配 |
| `public/js/thread.js` | 消息渲染、流式、滚动、消息操作 |
| `public/js/composer.js` | 输入、附件、语音 |
| `public/js/settings.js` | 设置注册表、模型列表、思考档位、我的 |
| `public/js/prompts.js` | 提示词库 |
| `public/js/app.js` | 登录、发送、会话、导出、云同步、启动 |
| `public/direct.js` | 直连客户端：手机号 AES-128-CFB 加密、短信登录、流式对话 |
| `public/native.js` | 原生流式通道（绕开 WebView 跨域限制，App 内首选） |
| `public/markdown.js` | 本地 Markdown 渲染，无 CDN 依赖 |
| `public/img/` | 品牌图与 favicon |
| `assets/icons/` | Android 各密度图标源文件 |
| `scripts/inject-icon.py` | 构建时把图标注入 Android 工程 |
| `scripts/inject-native-plugin.py` | 构建时注入原生插件 |
| `lib/config.js` | 环境变量与常量 |
| `lib/util.js` | 响应 / 请求体 / 编码 |
| `lib/auth.js` | 登录态与登录流程 |
| `lib/upstream.js` | 官方接口客户端（逆向得到，改动需谨慎） |
| `lib/static.js` | 静态资源（ETag / gzip+brotli / 缓存） |
| `lib/sync.js` | 对话云同步 |
| `server.js` | 本地代理入口与路由 |
| `test/smoke.js` | 冒烟测试：自带假上游，不联网、不需要账号 |
| `test/direct-crypto.js` | 校验 AES-128-CFB 与 Node 实现逐字节一致 |

## 扩展方式

**加一项设置**：在 `public/js/settings.js` 的 `SETTINGS` 数组里加一条，界面自动渲染，不用碰 HTML。

```js
{
  id: 'myOption', group: '对话', label: '我的选项', icon: 'spark', type: 'switch',
  value: () => !!S.prefs.myOption,
  toggle: (v) => { S.prefs.myOption = v; RC.savePrefs(); },
}
```

`type` 支持 `switch`（开关）与 `cycle`（点击轮换取值）。

**加一个后端接口**：在 `server.js` 的路由里加分支即可，`lib/util.js` 提供 `sendJSON / readBody`，`lib/auth.js` 提供 `current()`。

## 快速开始

### APK（推荐）

构建后的 APK 打开即用：输入手机号 → 完成人机验证 → 收短信 → 登录。不配置任何地址。

### 网页版

```bash
node server.js          # 无需 npm install，零第三方依赖
```

浏览器打开 `http://127.0.0.1:8799`。这个地址下前端同源访问 `server.js`，由它代为请求官方接口。

## 登录方式

### 手机号 + 短信验证码（默认）

流程与官方网页端完全一致：

1. 点「获取验证码」时，页面加载阿里云人机验证 SDK（`o.alicdn.com`）。
2. 大部分情况下风控会放行（无痕验证），你不用点任何东西；命中风控才会弹滑块。
3. 拿到 `captcha_token` 后，App 把手机号按官方算法加密（AES-128-CFB）并请求 `/api/iam/v1/sms/send`。
4. 输入收到的验证码，请求 `/api/iam/v1/auth/login/sms` 换取 `access_token`，保存在本机 `localStorage`。

> 验证码只能由浏览器里的阿里云 SDK 换取，服务端伪造不了，所以这一步必须在页面里完成。
> 如果验证码一直加载失败，先用 Token 登录兜底。

### Token 登录（保留）

登录页「使用 Token 登录」，粘贴 `access_token` 即可。会先拿它请求一次 `user_info` 验证，失效的 token 不会被保存。

## 连接诊断

登录页底部固定显示「自动 · 直连官方」，点「诊断」可以看到：

- 连接方式（直连 / 代理）
- 网络（请求官方接口的往返耗时）
- 登录态（本地是否存有 token）
- 最近一次错误

确实需要用代理时，在诊断面板点「改用代理」：地址留空会自动探测本机 `8799`，**并且必须通过 `/api/health` 的暗号校验**（返回 `ok:true` 且带 `upstream`/`service`）才会被保存 —— 避免再把返回 HTML 的服务误当成代理。

## 代理模式（可选）

只有这些情况才需要：想给桌面浏览器用、想跨设备共享一个登录态、或者所在网络直连官方不通。

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

构建脚本会：注入地址与密钥 → 生成 Android 工程 → 打开明文 HTTP 开关 → 注入固定签名 → 打包 **release APK**。构建前会先跑一遍 `npm test`，测试不过就不出包。

### 固定签名（覆盖安装的前提）

APK 用固定的 release 密钥签名，密钥存在 GitHub Actions Secrets 里，不进仓库：

| Secret | 内容 |
| --- | --- |
| `KEYSTORE_BASE64` | `raccoon-release.jks` 的 base64 |
| `KEYSTORE_PASSWORD` | keystore 密码 |
| `KEY_ALIAS` | `raccoon` |
| `KEY_PASSWORD` | 与 keystore 密码相同 |

证书 SHA-256 指纹（workflow 里会强制校验，对不上直接让构建失败）：

```
11:BC:39:DC:78:50:2E:5F:4B:C7:3F:05:88:5E:DC:7C:5D:E8:DA:41:D9:DA:5B:C5:A1:7E:0F:E8:FD:E8:0C:B6
```

有效期到 **2056-11-11**。密钥文件与密码的备份在资料库（不在本仓库，公开仓库放 keystore 等于把签名权交出去）。

> 从旧版 debug 包升级时，因为签名换了，**必须先卸载旧版再装**，一次即可。之后每次构建的 `versionCode` 取 CI 运行序号，递增，可以正常覆盖升级。

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
| 「连不上 http://127.0.0.1:8799（网络不可达）」 | 代理没起、端口不一致，或被 VPN 接管。见下面的「连接自检」 |
| 「需要访问密钥」 | 服务端设了 `ACCESS_KEY`，构建时没填或填错 |
| 「人机验证组件加载失败」 | 访问不到 `o.alicdn.com`；换网络或用 Token 登录 |
| 「人机验证未通过或已失效」 | 验证码过了但上游判定无效，通常是风控（模拟器、被标记的 IP）。换网络重试，或先用 Token 登录 |
| 登录后立刻退回登录页 | token 失效，重新登录；代理日志里会有上游 401 |
| 提示积分不足 | 小浣熊账号额度用完，去官网领每日积分或充值 |

### 连接自检

App 连不上时，先分清是「代理没跑」还是「App 找错地方」：

1. 打开 App 登录页，最底部会显示它当前请求的地址，例如 `http://127.0.0.1:8799`。点旁边的 **修改** 可以直接换地址，改完立即生效，不用重新打包。
2. 手机浏览器（不是 App）打开 `http://127.0.0.1:8799/api/health`：
   - 返回 `{"ok":true,...}` → 代理活着，问题在 App 侧，用第 1 步改地址；
   - 打不开 → 代理没跑，去 proot 里 `node server.js`。
3. 在 proot 里自测：`curl -sS http://127.0.0.1:8799/api/health`。
4. 如果系统开了 VPN，先关掉再试 —— 部分 VPN 的 TUN 模式会吞掉 loopback 流量。

登录后，设置抽屉的「连接」分组里也能看到当前地址和连接状态，点一下可重新检测。

## 说明

- 登录态只保存在代理服务本机，不上传任何第三方服务器。
- 对话消耗小浣熊账号额度，额度不足时在设置里领每日积分。
- 本项目是非官方客户端，接口由官方网页端推导而来，官方改版后可能需要跟着调整。
