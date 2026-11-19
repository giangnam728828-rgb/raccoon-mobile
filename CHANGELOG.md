# 变更记录

## v1.5.0 —— 原生通道 + 补齐桌面端常用能力

### 修掉「发消息报连不上官方服务」

登录能过、模型列表和积分都正常，说明网络本身没问题，卡在聊天这一条请求上：它带十几个自定义头又是长连接，WebView 的跨域预检对它比对普通接口苛刻得多，真机上直接抛 `Failed to fetch`。

- **新增原生 HTTP 插件**（`android-ext/RaccoonHttpPlugin.java`）：用系统网络栈发请求，`OkHttp` 之外不引依赖，响应按行推回 JS。既绕开 CORS / 预检，又保持流式输出的手感，支持「停止生成」时真正断开连接。
- 插件由 `scripts/inject-native-plugin.py` 在 CI 里注入（`android/` 是每次重新生成的，不能直接提交），并在 `MainActivity.onCreate` 里 `super` 之前注册。
- 前端 `public/native.js` 直接走原生桥的 `nativePromise` / `addListener`，不依赖 `@capacitor/core` 的 `registerPlugin`。
- 原生请求会带上 WebView 里的 cookie，并把响应里的 `Set-Cookie` 写回，同时复用 WebView 的 UA —— 行为与浏览器一致，不会被网关当成爬虫或缺登录态。
- 诊断面板会显示当前实际走的是「原生通道」还是「浏览器通道」。
- **浏览器通道保留**：原生通道不可用时自动回退 `fetch`，并补了一次不带 cookie 的重试。

### 更像完整客户端

- **Markdown 渲染**：标题、列表、引用、表格、分隔线、行内代码、代码块（带语言标签 + 复制按钮），流式时按 90ms 节流重排，长回答不卡。渲染器是本地实现的（`public/markdown.js`），不依赖 CDN，断网也能看历史。
- **多会话**：新建 / 切换 / 删除，本地保存最近 60 个对话，标题取首条提问；每个会话有稳定的 session id，方便服务端串上下文。
- **消息操作**：回答下方「复制 / 重试」，重试会砍掉这条及之后的消息并重新生成。
- **系统提示词**：按对话生效，拼在 messages 最前面。
- **导出对话**：一键复制成 Markdown。

## v1.4.0 —— 直连官方，不再依赖本地代理

**为什么改**：上一版必须靠手机里跑 `node server.js`（127.0.0.1:8799）才能登录和聊天。代理没起来、端口不对、或者把地址填成了别的服务（比如 noVNC 的 6080），App 就只是「看起来连上了」，一点「获取验证码」只拿到一句「服务返回异常（HTTP 200）」。这次把代理那套逻辑整体搬进 App。

- **App 自己直连官方**。手机号加密、短信登录、会话建立、流式对话全部在 App 内完成，官方对 `https://localhost` 这个源放行了带 credentials 的 CORS（已逐项验证：`/api/iam/v1/sms/send`、`/api/web/auth/v1/user_info`、`/api/web/llm/v2/chat/completions`，以及自定义头的预检）。
- **AES-128-CFB 用纯 JS 重写**（Web Crypto 不支持 CFB）。`test/direct-crypto.js` 拿 Node 的 `crypto.createDecipheriv` 反向解密逐字节比对，已纳入 CI。
- **地址不再固定、也不用手填**。登录页底部显示「自动 · 直连官方」；确实要用代理时，在「诊断 → 改用代理」里输入或留空自动探测，**必须通过 `/api/health` 的暗号校验**（`ok:true` 且带 `upstream`/`service`）才允许保存，从根上避免再把返回 HTML 的服务当成代理。
- **旧地址自动作废**：`localStorage` 的键从 `raccoon.proxy` 改成 `raccoon.proxy.v2`，之前误存的 `192.168.x.x:6080` 不会被继承。
- **新增连接诊断面板**（登录页底部「诊断」）：连接方式、网络（带耗时）、登录态、最近一次错误，一眼看出卡在哪一步。
- **错误提示透传上游原因**：人机验证未通过与失效、验证码错误/过期、频率限制等直接显示，不再统一糊成「发送失败」；人机验证被风控拦下时会提示再点一次重试。
- CI 的 `proxy_url` 输入改为可选、默认空，不会再往包里塞一个 127.0.0.1 的地址。

## v1.3.1 —— 连接自查

- **代理地址可在 App 内修改**。登录页底部与设置抽屉的「连接」分组都会显示当前实际请求的地址，点「修改」即可换成别的地址，存在 `localStorage`，无需重新打包。
- **错误提示带上地址**。原来只说「连不上代理服务」，现在会显示 `连不上 http://127.0.0.1:8799（网络不可达）`，一眼能看出是地址不对还是代理没跑。
- **新增连接状态检测**。设置抽屉里点「连接状态」会单独请求 `/api/health`，显示已连接 / 超时 / 连不上，超时 6 秒。
- 登录页底部由「登录态只保存在代理服务本机」改为显示代理地址 + 修改入口。
- README 增加「连接自检」四步排查。

## v1.3.0 —— 固定签名

- **APK 改用固定 release 签名**。之前每次构建都由 CI 临时生成 debug 密钥，每个包的签名都不一样，导致新包无法覆盖安装，必须卸载重装。现在统一用仓库里的固定密钥（有效期到 2056 年），一次卸载之后就能正常覆盖升级。
- **密钥不进仓库**：`raccoon-release.jks` 以 base64 存在 GitHub Actions Secrets（`KEYSTORE_BASE64` 等四项），仓库的 `.gitignore` 另外忽略 `*.jks` / `*.keystore`。
- **构建后强制验签**：新增一步比对证书 SHA-256，与 workflow 里写死的期望值不一致直接让构建失败，避免哪天悄悄回退成临时签名。
- **`versionCode` 递增**：取 CI 运行序号，`versionName` 同步为 `1.2.<run>`，保证每次出的包都能覆盖上一个。
- **新增 `scripts/inject-signing.py`**：往 Capacitor 生成的 `build.gradle` 注入 `signingConfigs.release`，密码全部从环境变量读，可重复执行。
- **新增 `scripts/set-version.py`**：写入版本号。
- 构建类型从 `assembleDebug` 改为 `assembleRelease`（跳过 `lintVitalRelease`）；产物体积由 3.77 MB 降到 2.86 MB。
- 未配置签名密钥的仓库仍会回退成 debug 构建，但会打印警告。

## v1.2.0 —— UI 精修 + 手机端自启

### 视觉

- **重做 logo**：原来是一个黑圆底加两只橙色眼睛，像眼罩。改为完整浣熊脸（耳朵、深色面罩、高光瞳孔、琥珀鼻），登录页与空状态共用同一图形。
- **AI 消息重新分层**：给 AI 气泡加了深色渐变底与内高光，之前气泡背景 `--surface-2` 和页面底色几乎同色，视觉上气泡是「消失」的，只剩一个思考块浮着。
- **思考块改为旁注**：从「卡片套卡片」的双层圆角改成左侧琥珀竖线，仍可折叠，但不再抢正文的层级。
- **滚动边缘渐隐**：消息区上下用 `mask-image` 做 18px 渐隐，快速滚动时不会出现被顶栏硬切的半截气泡。
- **空状态建议卡**：彩色 emoji 换成线性 SVG 图标 + 琥珀底托，文案拆成「标题 / 说明」两行。
- **发送按钮禁用态**改为灰色，之前是降低透明度的暗琥珀色，容易被误认为「坏掉的按钮」。
- **登录页**：「未登录」这类状态提示改中性灰（原来用错误红），Token 面板加浅底卡片区分层级。
- **设置抽屉**加分组标题（账号信息 / 积分），不再是一堆平铺的行。

### 交互

- 弹层支持 **Esc 关闭**（外接键盘或桌面调试时，原来按 Esc 没反应，遮罩会一直挡住点击）。
- 建议卡点击后自动聚焦输入框。

### 新增 `deploy/`

- `termux-boot.sh`：Termux:Boot 开机脚本，等网络就绪后拉起 proot。
- `start-raccoon.sh`：proot 内的守护循环，崩溃 3 秒后重启，日志超 2MB 自动轮转。
- `README.md`：从装 Termux 到验证自启的完整步骤，含电池优化、`EADDRINUSE`、连不上等排查。

> 手机重启后 proot 里的 Node 不会自己起来，APK 会一直转圈——这是之前没覆盖的场景。

## v1.1.0 —— 登录改造 + 全量排障

### 登录方式

- **新增：手机号 + 短信验证码登录**，对接官方新 IAM 接口：
  - 发码 `POST /api/iam/v1/sms/send`，登录 `POST /api/iam/v1/auth/login/sms`
  - 手机号按官方算法加密后再提交（AES-128-CFB，key 见 `server.js` 的 `PHONE_CIPHER_KEY`）
  - 人机验证在浏览器里用阿里云 SDK 完成，风控放行时无感通过，命中风控才弹滑块
- **移除：微信扫码登录**。原因不是接口下线——实测 `POST /api/web/auth/v1/login_with_qrcode_code` 仍返回 200。真正的问题是两点：
  1. 二维码落地页 `https://xiaohuanxiong.com/login/mp?code=...` 现在是 **404**，微信扫码打开就是「页面不存在」；
  2. 官方已改为**服务端签发** `qrcode_code`（`POST /api/iam/v1/auth/mp/qrcode` 返回 `qr-<uuid>`），旧代码用 `crypto.randomBytes` 自己生成 code，服务端不认识，轮询永远 `pending`。

  即使修好协议 bug，这两道墙也过不去，所以移除。
- **移除：授权码登录**。`/api/web/auth/v1/login_with_authorization_code` 接口仍在（返回 `200035 authorization_code_not_found_error`），但 APK 里拿不到微信 OAuth 的 `authorization_code`（需要公众号 AppID 与签名），移动端无法闭环，故移除。
- **保留：Token 登录**，并补了一次 `user_info` 校验，失效 token 不再被写进登录态。

### 修复的 Bug

| # | 位置 | 问题 | 影响 |
| --- | --- | --- | --- |
| 1 | `server.js` 全部上游请求 | 用 `http.request()` 请求 `https://` 地址，Node 直接抛 `ERR_INVALID_PROTOCOL` | **致命**：对话、余额、模型目录、刷新 token 全部失败，只有本地校验的 Token 登录「看起来能用」 |
| 2 | `public/style.css` | `#chat-view` 漏了 `flex-direction: column` | 顶栏/模型栏/消息区/输入框横着排，整个聊天页错位 |
| 3 | `public/app.js` | 流式输出时每个分片都重建整条消息 DOM | 打字闪烁、深度思考折叠块被强制收起、长文卡顿 |
| 4 | `public/app.js` | 所有 `[data-back]` 按钮都只关二维码面板 | 授权码 / Token 面板的 ✕ 关不掉 |
| 5 | `public/app.js` | `empty-state` 在 HTML 和 JS 里各生成一次，id 重复 | 选择器命中不确定 |
| 6 | `server.js` `/api/chat` | 不处理上游 401，也不处理客户端断开 | token 过期只能看到气泡里的报错，退不出去；关掉页面后上游还在生成，白烧额度 |
| 7 | `server.js` 签到/新手奖 | 无论上游成功失败都回 `ok:true` | 失败也提示「已领取」 |
| 8 | `server.js` 静态服务 | 只做 `startsWith(public)` 判断 | `/public-xxx` 这类同前缀目录可被读取（目录穿越） |
| 9 | `server.js` `readBody` | 不限制请求体大小 | 大包可打爆内存 |
| 10 | `server.js` | 默认监听 `0.0.0.0` 且无任何鉴权 | 同网段的人可以直接用你的账号烧积分 |
| 11 | `.github/workflows` | 没有处理 Android 明文 HTTP | Android 9+ 上 APK 调 `http://` 代理可能被拦 |
| 12 | `server.js` 静态服务 | 没有 `Cache-Control` | 改了 `app.js` 手机上还是旧的 |
| 13 | `server.js` 错误处理 | 上游业务错误码被当成成功数据 | 余额显示 0、模型列表为空且没有任何提示 |
| 14 | `public/app.js` | 网络错误直接抛 `Failed to fetch` | 用户看不懂 |
| 15 | `package.json` | 依赖里还留着 `qrcode` | 扫码删除后成了无用依赖 |

### 其它改进

- 代理零第三方依赖（`node server.js` 即可运行），`qrcode` 已移除。
- 新增 `npm test`：自带假上游，18 条断言覆盖登录、加密、鉴权、SSE 透传、目录穿越等，CI 里先跑测试再打包。
- 新增 `ACCESS_KEY`：给代理加访问密钥，构建 APK 时一并写入。
- 新增 `/api/health`、`/api/login/config`。
- 前端支持停止生成、自动滚动不打断阅读、错误信息中文化。
- 登录态文件权限改为 600。
