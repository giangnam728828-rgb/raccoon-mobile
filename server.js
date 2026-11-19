// 小浣熊移动端 —— 本地代理 + 静态服务
// 把商汤小浣熊（xiaohuanxiong.com）的云端对话能力，包成一个手机端可用的本地服务。
// 前端只跟本服务说话；本服务负责拼上游请求头、转发对话流、保管登录态。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const UPSTREAM = 'https://xiaohuanxiong.com';
const PORT = process.env.PORT || 8799;
const DATA_DIR = path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

// ---- 上游常量（与官方客户端一致）----
const CLIENT_NAME = 'raccoon-ai';
const CLIENT_VERSION = '1.0.35';
const WEB_CLIENT_VERSION = 'v1.1.3';
const MOBILE_PLATFORM = 'app-android';
const MOBILE_CLIENT_VERSION = 'v1.0.3';
const OS_VERSION = '10.0.26200';
const CHANNEL = 'stable';
const QR_APP_NAME = '商汤小浣熊官网';

// ---- 登录态 ----
let auth = null;
try {
  if (fs.existsSync(AUTH_FILE)) auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
} catch { auth = null; }

function saveAuth() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  } catch { /* 忽略落盘失败 */ }
}

function clearAuth() {
  auth = null;
  try { if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE); } catch {}
}

// ---- 工具 ----
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function decodeUID(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return payload.sub || payload.uid || payload.id || '';
  } catch { return ''; }
}

function deriveDeviceID(uid) {
  const seed = crypto.createHash('sha256').update('agenthub:raccoon:' + (uid || 'anon')).digest('hex');
  return seed.slice(0, 8) + '-' + seed.slice(8, 12) + '-4' + seed.slice(13, 16) + '-a' + seed.slice(17, 20) + '-' + seed.slice(20, 32);
}

function newTurnID() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hx = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < b.length; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += hx[b[i] >> 4] + hx[b[i] & 0xf];
  }
  return out;
}

function sessionID(uid, seedText) {
  const s = crypto.createHash('sha256').update('raccoon:' + (uid || 'anon') + ':' + seedText).digest('hex');
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32);
}

function latinTitle(title) {
  let out = '';
  for (const ch of title) {
    if (ch >= ' ' && ch <= '~') { out += ch; continue; }
    for (const by of Buffer.from(String(ch), 'utf8')) {
      out += '%' + by.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

function isTeam(officeIdentity) {
  const oi = (officeIdentity || '').trim();
  return oi !== '' && oi !== 'personal';
}

// ---- 上游请求 ----
function upstreamRequest(method, urlPath, { token, headers = {}, body = null, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = UPSTREAM + urlPath;
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(url, {
      method,
      headers: {
        ...headers,
        ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
      },
    }, (res) => {
      if (raw) { resolve(res); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 对话请求头
function chatHeaders(token, idn, sessionIDVal, turnID, title) {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer ' + token,
    'x-client-name': CLIENT_NAME,
    'x-client-platform': idn.platform,
    'x-client-version': CLIENT_VERSION,
    'x-client-os-version': idn.osVersion,
    'x-client-channel': idn.clientChannel,
    'x-client-device-id': idn.deviceID,
    'X-RACCOON-Session-ID': sessionIDVal,
    'X-RACCOON-Turn-ID': turnID,
    'X-RACCOON-Title': latinTitle(title),
    'X-RACCOON-Call-Kind': 'chat',
  };
  if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
  return h;
}

// 渲染层请求头（余额/目录/用户信息）
function webHeaders(token, idn, platform = '') {
  if (!platform) platform = idn.platformNoArch;
  const h = {
    'content-type': 'application/json',
    accept: 'application/json',
    'X-Client-Platform': platform,
    'X-Client-Version': WEB_CLIENT_VERSION,
    'X-Client-Device-ID': idn.deviceID,
    'X-Raccoon-Language': idn.language || 'zh',
  };
  if (token) h.authorization = 'Bearer ' + token;
  if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
  return h;
}

function mobileHeaders(token, idn) {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: 'Bearer ' + token,
    'X-Client-Platform': MOBILE_PLATFORM,
    'X-Client-Version': MOBILE_CLIENT_VERSION,
  };
  if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
  return h;
}

function identityFor(uid) {
  const did = deriveDeviceID(uid);
  return {
    deviceID: did,
    osVersion: OS_VERSION,
    platform: 'desktop-windows-x64',
    platformNoArch: 'desktop-windows',
    clientChannel: CHANNEL,
    officeIdentity: (auth && auth.officeIdentity) || '',
    language: 'zh',
  };
}

// ---- 模型家族与深度思考归一化（复刻 raccoon-relay 逻辑）----
function modelBaseName(model) {
  let m = (model || '').trim();
  const i = m.lastIndexOf('/');
  if (i >= 0) m = m.slice(i + 1);
  return m.toLowerCase();
}
function familyOf(model) {
  const name = modelBaseName(model).replace(/\./g, '-');
  if (name.startsWith('sn-deepseek-') || name.startsWith('deepseek-')) return 'thinking';
  if (name.startsWith('sn-glm-5-3') || name.startsWith('glm-5-3') || name.startsWith('sn-kimi-k3') || name.startsWith('kimi-k3')) return 'low_high';
  if (name.startsWith('sn-sensenova-') || name.startsWith('raccoon-')) return 'effort';
  return '';
}
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
function normalizeReasoning(body, model) {
  if (body.reasoningEffort !== undefined && body.reasoning_effort === undefined) {
    body.reasoning_effort = body.reasoningEffort;
    delete body.reasoningEffort;
  }
  const kind = familyOf(model);
  if (!kind) return body;
  const effort = body.reasoning_effort;
  const hasThinking = body.thinking !== undefined;
  const off = effort === 'off' || effort === 'none';
  if (kind === 'thinking') {
    if (!hasThinking && off) { delete body.reasoning_effort; body.thinking = { type: 'disabled' }; return body; }
    if (!hasThinking && EFFORTS.includes(effort)) { delete body.reasoning_effort; body.thinking = { type: 'enabled' }; }
    return body;
  }
  if (kind === 'low_high') {
    if (body.thinking && body.thinking.type === 'disabled') { delete body.thinking; body.reasoning_effort = 'low'; return body; }
    if (EFFORTS.includes(effort)) body.reasoning_effort = EFFORTS.indexOf(effort) <= 1 ? 'low' : 'high';
    else if (off) body.reasoning_effort = 'low';
    return body;
  }
  if (kind === 'effort') {
    if (EFFORTS.includes(effort)) {
      const r = EFFORTS.indexOf(effort);
      body.reasoning_effort = r <= 1 ? 'low' : r === 2 ? 'medium' : 'high';
    } else if (off) { delete body.reasoning_effort; }
    return body;
  }
  return body;
}

function prepareChatBody(model, inBody, defaultModel) {
  const out = { ...inBody };
  const m = (model || '').trim();
  out.model = m || defaultModel || 'raccoon-chat-ml-5-5';
  out.stream = true;
  if (!out.stream_options) out.stream_options = {};
  out.stream_options.include_usage = true;
  if (!out.max_tokens || out.max_tokens === 0) out.max_tokens = out.max_completion_tokens || 80000;
  delete out.max_completion_tokens;
  delete out.conversation_id;
  delete out.conversationId;
  delete out.prompt_cache_key;
  return normalizeReasoning(out, out.model);
}

// ---- 静态文件 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, 'public', p);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- 读取请求体 ----
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { resolve({}); }
    });
  });
}

function sendJSON(res, obj, status = 200) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

// ---- 路由 ----
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  // CORS：APK 内 WebView 以 file:// 加载，调用本代理是跨域，必须放行
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 静态
  if (method === 'GET' && (url === '/' || url.startsWith('/static') || url.endsWith('.html') || url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.ico'))) {
    return serveStatic(req, res);
  }

  try {
    // ---- 登录：微信扫码 ----
    if (url === '/api/qrcode' && method === 'POST') {
      const code = crypto.randomBytes(16).toString('hex');
      const qrUrl = UPSTREAM + '/login/mp?code=' + code + '&appname=' + encodeURIComponent(QR_APP_NAME);
      const dataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 });
      return sendJSON(res, { code, url: qrUrl, qr: dataUrl });
    }

    // ---- 登录：轮询扫码结果 ----
    if (url === '/api/login/poll' && method === 'POST') {
      const body = await readBody(req);
      const code = body.code;
      if (!code) return sendJSON(res, { ok: false, message: '缺少 code' });
      const r = await upstreamRequest('POST', '/api/web/auth/v1/login_with_qrcode_code', {
        headers: { 'content-type': 'application/json' },
        body: { qrcode_code: code },
      });
      const d = (r.json && r.json.data) || r.json || {};
      const token = d.access_token || d.accessToken || d.token;
      if (token) {
        const uid = decodeUID(token);
        auth = {
          token,
          refreshToken: d.refresh_token || d.refreshToken || '',
          officeIdentity: d.office_identity || d.officeIdentity || '',
          uid,
        };
        saveAuth();
        return sendJSON(res, { ok: true, token, uid, officeIdentity: auth.officeIdentity, refreshToken: auth.refreshToken });
      }
      return sendJSON(res, { ok: false, message: (r.json && (r.json.message || r.json.msg)) || '等待扫码', pending: true });
    }

    // ---- 登录：授权码兑换 ----
    if (url === '/api/login/exchange' && method === 'POST') {
      const body = await readBody(req);
      const code = body.code;
      if (!code) return sendJSON(res, { ok: false, message: '缺少授权码' });
      const r = await upstreamRequest('POST', '/api/web/auth/v1/login_with_authorization_code', {
        headers: { 'content-type': 'application/json' },
        body: { authorization_code: code },
      });
      const d = (r.json && r.json.data) || r.json || {};
      const token = d.access_token || d.accessToken;
      if (token) {
        const uid = decodeUID(token);
        auth = { token, refreshToken: d.refresh_token || d.refreshToken || '', officeIdentity: d.office_identity || d.officeIdentity || '', uid };
        saveAuth();
        return sendJSON(res, { ok: true, token, uid, officeIdentity: auth.officeIdentity, refreshToken: auth.refreshToken });
      }
      return sendJSON(res, { ok: false, message: (r.json && (r.json.message || r.json.msg)) || '兑换失败' });
    }

    // ---- 登录：直接粘贴 token ----
    if (url === '/api/login/token' && method === 'POST') {
      const body = await readBody(req);
      const token = (body.token || '').trim();
      if (!token) return sendJSON(res, { ok: false, message: '缺少 token' });
      const uid = decodeUID(token);
      if (!uid) return sendJSON(res, { ok: false, message: 'token 无法解析出账号 ID' });
      auth = { token, refreshToken: body.refreshToken || '', officeIdentity: body.officeIdentity || '', uid };
      saveAuth();
      return sendJSON(res, { ok: true, uid, officeIdentity: auth.officeIdentity });
    }

    // ---- 登出 ----
    if (url === '/api/logout' && method === 'POST') {
      clearAuth();
      return sendJSON(res, { ok: true });
    }

    // ---- 需要登录态的接口 ----
    if (!auth || !auth.token) {
      if (url.startsWith('/api/')) return sendJSON(res, { ok: false, auth: false, message: '未登录' }, 401);
      return serveStatic(req, res);
    }

    const idn = identityFor(auth.uid);

    // ---- 用户信息 + 余额 ----
    if (url === '/api/me' && method === 'GET') {
      const [u, b] = await Promise.all([
        upstreamRequest('GET', '/api/web/auth/v1/user_info', { token: auth.token, headers: webHeaders(auth.token, idn) }),
        upstreamRequest('GET', '/api/web/points/v1/balance', { token: auth.token, headers: webHeaders(auth.token, idn) }),
      ]);
      const ud = (u.json && u.json.data) || u.json || {};
      const bd = (b.json && b.json.data) || b.json || {};
      return sendJSON(res, {
        ok: true,
        uid: auth.uid,
        name: ud.name || ud.nickname || ud.user_name || '',
        points: bd.available_points != null ? bd.available_points : (bd.availablePoints || 0),
        officeIdentity: auth.officeIdentity,
      });
    }

    // ---- 模型目录 ----
    if (url === '/api/catalog' && method === 'GET') {
      const r = await upstreamRequest('GET', '/api/web/llm/v2/model_catalog', { token: auth.token, headers: webHeaders(auth.token, idn) });
      const raw = (r.json && r.json.data) ? r.json.data : r.json;
      const models = parseCatalog(raw);
      return sendJSON(res, { ok: true, models });
    }

    // ---- 刷新 token ----
    if (url === '/api/refresh' && method === 'POST') {
      if (!auth.refreshToken) return sendJSON(res, { ok: false, message: '没有 refresh_token，请重新登录' });
      const r = await upstreamRequest('POST', '/api/web/auth/v1/refresh', {
        headers: { 'content-type': 'application/json', 'X-Client-Platform': idn.platformNoArch, 'X-Client-Version': WEB_CLIENT_VERSION, 'X-Client-Device-ID': idn.deviceID },
        body: { refresh_token: auth.refreshToken },
      });
      const d = (r.json && r.json.data) || r.json || {};
      const token = d.access_token || d.accessToken || d.token;
      if (token) {
        auth.token = token;
        if (d.refresh_token || d.refreshToken) auth.refreshToken = d.refresh_token || d.refreshToken;
        saveAuth();
        return sendJSON(res, { ok: true, token });
      }
      return sendJSON(res, { ok: false, message: '刷新失败，请重新登录' });
    }

    // ---- 对话（流式代理）----
    if (url === '/api/chat' && method === 'POST') {
      const body = await readBody(req);
      const messages = body.messages || [];
      const title = (messages.find((m) => m.role === 'user') || {}).content || '';
      const titleTrim = title.replace(/\s+/g, ' ').trim().slice(0, 20);
      const sess = sessionID(auth.uid, title);
      const turn = newTurnID();
      const finalBody = prepareChatBody(body.model, body, 'raccoon-chat-ml-5-5');
      const data = Buffer.from(JSON.stringify(finalBody));

      const upstreamReq = http.request(UPSTREAM + '/api/web/llm/v2/chat/completions', {
        method: 'POST',
        headers: {
          ...chatHeaders(auth.token, idn, sess, turn, titleTrim),
          'content-type': 'application/json',
          'content-length': data.length,
        },
      }, (upRes) => {
        res.writeHead(upRes.statusCode, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        upRes.pipe(res);
      });
      upstreamReq.on('error', (e) => {
        if (!res.headersSent) sendJSON(res, { ok: false, message: '上游连接失败: ' + e.message }, 502);
        else res.end();
      });
      upstreamReq.write(data);
      upstreamReq.end();
      return;
    }

    // ---- 每日签到 ----
    if (url === '/api/checkin' && method === 'POST') {
      await upstreamRequest('GET', '/api/web/office/v3/setting_info', { token: auth.token, headers: webHeaders(auth.token, idn, 'web') });
      const r = await upstreamRequest('POST', '/api/web/desktop/v1/login/points/grant', { token: auth.token, headers: webHeaders(auth.token, idn), body: {} });
      const d = (r.json && r.json.data) || r.json || {};
      return sendJSON(res, { ok: true, granted: d.granted, message: d.granted ? '已领取每日积分' : '今日已领取过' });
    }

    // ---- 手机端首登奖 ----
    if (url === '/api/onboarding' && method === 'POST') {
      const r = await upstreamRequest('POST', '/api/web/mobile/v1/login/points/grant', { token: auth.token, headers: mobileHeaders(auth.token, idn), body: {} });
      const d = (r.json && r.json.data) || r.json || {};
      return sendJSON(res, { ok: true, granted: d.granted, message: d.granted ? '已领取新手奖励' : '此前已领取' });
    }

    // 兜底
    if (url.startsWith('/api/')) return sendJSON(res, { ok: false, message: '未知接口: ' + url }, 404);
    return serveStatic(req, res);
  } catch (e) {
    return sendJSON(res, { ok: false, message: '服务错误: ' + (e && e.message) }, 500);
  }
});

function parseCatalog(raw) {
  if (!raw) return [];
  const out = [];
  const seen = {};
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const id = it.name || it.id || it.model || it.model_name;
      if (!id || seen[id]) continue;
      if (it.visible === false) continue;
      seen[id] = true;
      let imgs = false;
      if (it.supportsImages != null) imgs = it.supportsImages;
      else if (it.supportImage != null) imgs = it.supportImage;
      else if (Array.isArray(it.tags) && it.tags.some((t) => /image|vision/i.test(t))) imgs = true;
      out.push({
        id,
        name: it.display_name || (it.description || '').slice(0, 64) || id,
        contextLength: it.context_window || (it.params && it.params.context_window) || 0,
        maxOutputTokens: it.max_tokens || (it.params && it.params.max_tokens) || 0,
        supportsImages: imgs,
        supportsReasoning: it.supports_reasoning,
      });
    }
  };
  if (raw.models) collect(raw.models);
  if (!out.length && raw.categories) {
    for (const cat of raw.categories) {
      if (cat.type && cat.type !== 'chat') continue;
      collect(cat.models);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('小浣熊移动端已启动: http://127.0.0.1:' + PORT);
  console.log('上游: ' + UPSTREAM);
  if (auth) console.log('已保存登录态, uid=' + auth.uid);
});
