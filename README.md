# 小浣熊移动端

商汤小浣熊的移动端客户端，直接对接官方云端接口，支持**多模型切换 + 深度思考 + 语音输入**，可打包成 APK。

## 组成

- `server.js` — 本地代理服务。负责拼官方客户端请求头、转发对话流、保管登录态。前端只与它通信，它再连 `xiaohuanxiong.com`。
- `public/` — 移动端前端（登录页 + 聊天页）。
- `capacitor.config.json` — Capacitor 配置，把前端打包成 Android APK。
- `.github/workflows/build-apk.yml` — GitHub Actions，自动构建 APK。

## 本地运行（Web 版）

```bash
npm install
node server.js
```

浏览器打开 `http://127.0.0.1:8799`，微信扫码登录即可使用。

## 构建 APK（GitHub Actions）

推送到仓库后，Actions 会自动构建。也可在 Actions 页面手动触发（可自定义代理地址）。

构建产物：`android/app/build/outputs/apk/debug/*.apk`，在 Actions 的 artifacts 里下载。

**代理地址**：APK 内的前端默认调用 `http://127.0.0.1:8799`。构建时可用 `proxy_url` 输入覆盖。运行时需保证该地址的 `server.js` 代理在运行。

## 使用说明

1. 先运行本地代理 `node server.js`（APK 需要它来转发请求）。
2. 安装 APK，打开「小浣熊」。
3. 微信扫码登录。
4. 顶部选择模型，打开「深度思考」开关，开始对话。
5. 输入框左侧麦克风可语音输入。

## 说明

- 登录态保存在代理服务本机（`data/auth.json`），不上传任何服务器。
- 对话消耗小浣熊账号积分，额度不足时重新登录或领取每日积分。
