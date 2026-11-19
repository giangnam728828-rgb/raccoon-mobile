# 变更记录

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
