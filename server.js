'use strict';

/**
 * 小浣熊移动端 —— 本地代理 + 静态服务
 *
 * 前端只跟本服务说话；本服务负责：
 *   1. 手机号验证码登录（对接官方 IAM：/api/iam/v1）
 *   2. 保存登录态，代替浏览器持有 access_token
 *   3. 拼官方客户端请求头，转发流式对话
 *
 * 环境变量：
 *   PORT         监听端口，默认 8799
 *   HOST         监听地址，默认 127.0.0.1（要让手机通过局域网访问才改成 0.0.0.0）
 *   ACCESS_KEY   可选。设置后所有 /api/* 都需要带 x-access-key，防止同网段的人蹭你的额度
 *   UPSTREAM     上游地址，默认 https://xiaohuanxiong.com（仅测试时改）
 *   DATA_DIR     登录态落盘目录，默认 ./data
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPSTREAM = (process.env.UPSTREAM || 'https://xiaohuanxiong.com').replace(/\/+$/, '');
const PORT = Number(process.env.PORT) || 8799;
const HOST = process.env.HOST || '127.0.0.1';
const ACCESS_KEY = (process.env.ACCESS_KEY || '').trim();

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- 上游常量（与官方客户端 / 网页端一致）----
const CLIENT_NAME = 'raccoon-ai';
const CLIENT_VERSION = '1.0.35';
const WEB_CLIENT_VERSION = 'v1.1.3';
const MOBILE_PLATFORM = 'app-android';
const MOBILE_CLIENT_VERSION = 'v1.0.3';
const OS_VERSION = '10.0.26200';
const CHANNEL = 'stable';

// 官方网页端提交手机号前会用 AES-128-CFB 加密：key 为下面这串 16 字节，密文 = iv(16B) + ciphertext，整体 base64
const PHONE_CIPHER_KEY = 'senseraccoon2023';

// 阿里云人机验证（官方登录页公开配置）。真正换取 captcha_token 必须由浏览器里的 SDK 完成。
const CAPTCHA = {
  scene: process.env.CAPTCHA_SCENE || '1pkmy0x3',
  prefix: process.env.CAPTCHA_PREFIX || 'hk1r5l',
  region: process.env.CAPTCHA_REGION || 'cn',
};

const NATION_CODES = [
  { code: '+86', label: '中国大陆' },
  { code: '+852', label: '中国香港' },
  { code: '+853', label: '中国澳门' },
  { code: '+886', label: '中国台湾' },
];

// ---- 登录态 ----
let auth = null;
try {
  if (fs.existsSync(AUTH_FILE)) {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (raw && typeof raw.token === 'string' && raw.token) auth = raw;
  }
} catch {
  auth = null;
}

function saveAuth() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn('[auth] 登录态落盘失败:', e.message);
  }
}

function clearAuth() {
  auth = null;
  try {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  } catch {}
}

// ---- 小工具 ----
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function decodeUID(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return payload.sub || payload.uid || payload.user_id || payload.id || '';
  } catch {
    return '';
  }
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// 账号维度的稳定 ID：JWT 能解出 sub 就用它，解不出（不透明 token）就用 token 指纹
function accountKey() {
  if (!auth) return 'anon';
  return auth.uid || 'tok-' + sha256Hex(auth.token).slice(0, 16);
}

function uuidLike(seed, at12, at16) {
  return (
    seed.slice(0, 8) + '-' + seed.slice(8, 12) + '-' + at12 + seed.slice(13, 16) + '-' +
    at16 + seed.slice(17, 20) + '-' + seed.slice(20, 32)
  );
}

function deriveDeviceID(key) {
  return uuidLike(sha256Hex('agenthub:raccoon:' + (key || 'anon')), '4', 'a');
}

function sessionID(key, seedText) {
  return uuidLike(sha256Hex('raccoon:' + (key || 'anon') + ':' + seedText), '4', 'a');
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

// 头部只能放 ASCII，中文标题按 UTF-8 百分号编码
function latinTitle(title) {
  let out = '';
  for (const ch of String(title || '')) {
    if (ch >= ' ' && ch <= '~') {
      out += ch;
      continue;
    }
    for (const by of Buffer.from(ch, 'utf8')) {
      out += '%' + by.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

function isTeam(officeIdentity) {
  const oi = (officeIdentity || '').trim();
  return oi !== '' && oi !== 'personal';
}

function encryptPhone(phone) {
  const key = Buffer.from(PHONE_CIPHER_KEY, 'utf8');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cfb', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(String(phone), 'utf8')), cipher.final()]);
  return Buffer.concat([iv, ct]).toString('base64');
}

function normalizePhone(input) {
  return String(input || '').replace(/[\s\-()]/g, '');
}

function normalizeNation(input) {
  let n = String(input || '+86').trim();
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}

function isValidPhone(nation, phone) {
  if (!/^\+[0-9]{1,4}$/.test(nation)) return false;
  if (!/^[0-9]{5,15}$/.test(phone)) return false;
  if (nation === '+86') return /^1[3-9][0-9]{9}$/.test(phone);
  return true;
}

// ---- 上游请求（http / https 都走这里）----
function request(method, urlPath, opts = {}) {
  const { token, headers = {}, body = null, timeout = 30000, cookie = '' } = opts;

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(UPSTREAM + urlPath);
    } catch {
      return reject(new Error('上游地址不合法: ' + UPSTREAM + urlPath));
    }
    const lib = url.protocol === 'https:' ? https : http;
    const data = body === null || body === undefined ? null : Buffer.from(JSON.stringify(body));

    const h = { accept: 'application/json', ...headers };
    if (data) {
      h['content-type'] = 'application/json';
      h['content-length'] = String(data.length);
    }
    if (token) h.authorization = 'Bearer ' + token;
    if (cookie) h.cookie = cookie;

    const req = lib.request(url, { method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
      });
    });

    req.setTimeout(timeout, () => req.destroy(new Error('上游请求超时')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 官方业务接口的 { code, message, data } 信封
function envelope(r) {
  const j = r.json || {};
  const code = j.code;
  const ok = r.status >= 200 && r.status < 300 && (code === 0 || code === undefined || code === 'OK');
  return {
    ok,
    status: r.status,
    code,
    message: j.message || j.msg || j.details || '',
    data: j.data !== undefined ? j.data : j,
  };
}

const IAM_ERROR_MESSAGES = {
  CAPTCHA_FAILED: '人机验证未通过，请重试',
  CAPTCHA_EXPIRED: '人机验证已过期，请重试',
  CAPTCHA_TOKEN_EXPIRED: '人机验证已过期，请重试',
  COMMON_INVALID_ARGUMENT: '参数有误，请检查手机号',
  COMMON_RATE_LIMITED: '操作太频繁，请稍后再试',
  AUTH_SMS_VERIFICATION_EXPIRED: '验证码已过期，请重新获取',
  AUTH_SMS_VERIFICATION_INVALID: '验证码不正确',
  AUTH_SMS_VERIFICATION_ATTEMPTS_EXCEEDED: '验证次数过多，请重新获取验证码',
  AUTH_SMS_VERIFICATION_LOCKED: '验证失败次数过多，请稍后再试',
};

function friendlyError(r, fallback) {
  const code = String((r.json && r.json.code) || '');
  const raw = String((r.json && (r.json.message || r.json.details)) || '');

  // 上游把很多原因都塞进 COMMON_INVALID_ARGUMENT，先按具体字段判断
  if (/captcha/i.test(raw)) return '人机验证未通过或已失效，请重试';
  if (/phone/i.test(raw)) return '手机号格式不正确';
  if (/verification_code/i.test(raw)) return '验证码不正确';
  if (/verification_id/i.test(raw)) return '验证码已失效，请重新获取';

  if (IAM_ERROR_MESSAGES[code]) return IAM_ERROR_MESSAGES[code];
  if (code.startsWith('AUTH_SMS_VERIFICATION_')) return '验证码不正确或已过期';
  if (code.startsWith('CAPTCHA')) return '人机验证未通过，请重试';
  if (r.status === 429) return '操作太频繁，请稍后再试';
  if (r.status === 401 || r.status === 403) return '登录状态无效，请重新登录';
  if (r.status >= 500) return '上游服务异常（HTTP ' + r.status + '）';
  return raw && raw !== 'success' ? raw : fallback;
}

// ---- 请求头 ----
function identityFor(key) {
  const did = deriveDeviceID(key);
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

function chatHeaders(token, idn, sess, turn, title) {
  const h = {
    accept: 'application/json, text/event-stream',
    'x-client-name': CLIENT_NAME,
    'x-client-platform': idn.platform,
    'x-client-version': CLIENT_VERSION,
    'x-client-os-version': idn.osVersion,
    'x-client-channel': idn.clientChannel,
    'x-client-device-id': idn.deviceID,
    'X-RACCOON-Session-ID': sess,
    'X-RACCOON-Turn-ID': turn,
    'X-RACCOON-Title': latinTitle(title),
    'X-RACCOON-Call-Kind': 'chat',
  };
  if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
  return h;
}

// 渲染层请求头（余额 / 目录 / 用户信息）
function webHeaders(token, idn, platform) {
  const h = {
    accept: 'application/json',
    'X-Client-Platform': platform || idn.platformNoArch,
    'X-Client-Version': WEB_CLIENT_VERSION,
    'X-Client-Device-ID': idn.deviceID,
    'X-Raccoon-Language': idn.language || 'zh',
  };
  if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
  return h;
}

function mobileHeaders(idn) {
  const h = {
    accept: 'application/json',
    'X-Client-Platform': MOBILE_PLATFORM,
    'X-Client-Version': MOBILE_CLIENT_VERSION,
    'X-Client-Device-ID': idn.deviceID,
  };
  if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
  return h;
}

// ---- 模型家族与深度思考归一化 ----
function modelBaseName(model) {
  let m = (model || '').trim();
  const i = m.lastIndexOf('/');
  if (i >= 0) m = m.slice(i + 1);
  return m.toLowerCase();
}

function familyOf(model) {
  const name = modelBaseName(model).replace(/\./g, '-');
  if (name.startsWith('sn-deepseek-') || name.startsWith('deepseek-')) return 'thinking';
  if (
    name.startsWith('sn-glm-5-3') ||
    name.startsWith('glm-5-3') ||
    name.startsWith('sn-kimi-k3') ||
    name.startsWith('kimi-k3')
  )
    return 'low_high';
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
    if (!hasThinking && off) {
      delete body.reasoning_effort;
      body.thinking = { type: 'disabled' };
      return body;
    }
    if (!hasThinking && EFFORTS.includes(effort)) {
      delete body.reasoning_effort;
      body.thinking = { type: 'enabled' };
    }
    return body;
  }
  if (kind === 'low_high') {
    if (body.thinking && body.thinking.type === 'disabled') {
      delete body.thinking;
      body.reasoning_effort = 'low';
      return body;
    }
    if (EFFORTS.includes(effort)) body.reasoning_effort = EFFORTS.indexOf(effort) <= 1 ? 'low' : 'high';
    else if (off) body.reasoning_effort = 'low';
    return body;
  }
  if (kind === 'effort') {
    if (EFFORTS.includes(effort)) {
      const r = EFFORTS.indexOf(effort);
      body.reasoning_effort = r <= 1 ? 'low' : r === 2 ? 'medium' : 'high';
    } else if (off) {
      delete body.reasoning_effort;
    }
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
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  let p;
  try {
    p = decodeURIComponent(String(req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('bad request');
  }
  if (p === '/' || p === '') p = '/index.html';
  if (p.indexOf('\0') >= 0) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('bad request');
  }

  const file = path.resolve(PUBLIC_DIR, '.' + (p.startsWith('/') ? p : '/' + p));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

// ---- 请求体 ----
const MAX_BODY = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) {
        done = true;
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

function sendJSON(res, obj, status = 200) {
  if (res.headersSent) return res.end();
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

// ---- 登录后的业务会话 ----
// 官方网页端拿到 IAM token 后，会调一次 iam/confirm 建立业务会话（种 xhx_token cookie）。
// 这里尽力而为：成功就把 cookie 存下来，后续请求一起带上，兼容只认 cookie 的接口。
async function confirmSession(token) {
  try {
    const r = await request('POST', '/api/web/auth/v1/iam/confirm', { token, body: {}, timeout: 15000 });
    const setCookie = r.headers && r.headers['set-cookie'];
    return Array.isArray(setCookie)
      ? setCookie
          .map((c) => String(c).split(';')[0])
          .filter(Boolean)
          .join('; ')
      : '';
  } catch {
    return '';
  }
}

function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

async function establishLogin(token, extra) {
  const uid = decodeUID(token);
  auth = {
    token,
    refreshToken: extra.refreshToken || '',
    officeIdentity: extra.officeIdentity || '',
    uid,
    phone: extra.phone || '',
    name: '',
    cookie: '',
    savedAt: Date.now(),
  };
  const cookie = await confirmSession(token);
  if (cookie) auth.cookie = cookie;
  saveAuth();
  return auth;
}

async function fetchProfile() {
  const key = accountKey();
  const idn = identityFor(key);
  const headers = webHeaders(auth.token, idn);
  const [u, b] = await Promise.all([
    request('GET', '/api/web/auth/v1/user_info', { token: auth.token, headers, cookie: auth.cookie }),
    request('GET', '/api/web/points/v1/balance', { token: auth.token, headers, cookie: auth.cookie }).catch(() => null),
  ]);
  return { user: envelope(u), balance: b ? envelope(b) : null, status: u.status };
}

// 本机兜底限流（上游自己还有 retry_after）
const lastSmsAt = new Map();

// ---- 路由 ----
const server = http.createServer(async (req, res) => {
  const rawUrl = String(req.url || '/');
  const url = rawUrl.split('?')[0];
  const search = new URLSearchParams(rawUrl.split('?')[1] || '');
  const method = req.method || 'GET';
  const isApi = url.startsWith('/api/');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // ---- 公开接口 ----
    if (url === '/api/health' && method === 'GET') {
      return sendJSON(res, { ok: true, upstream: UPSTREAM, loggedIn: !!(auth && auth.token) });
    }

    if (url === '/api/login/config' && method === 'GET') {
      return sendJSON(res, {
        ok: true,
        captcha: CAPTCHA,
        nationCodes: NATION_CODES,
        keyRequired: !!ACCESS_KEY,
      });
    }

    // ---- 访问密钥（设置 ACCESS_KEY 后生效）----
    if (isApi && ACCESS_KEY) {
      const provided = req.headers['x-access-key'] || search.get('key') || '';
      if (provided !== ACCESS_KEY) {
        return sendJSON(res, { ok: false, auth: false, keyRequired: true, message: '需要访问密钥' }, 401);
      }
    }

    if (!isApi) {
      if (method === 'GET' || method === 'HEAD') return serveStatic(req, res);
      res.writeHead(405);
      return res.end();
    }

    // ================= 登录 =================
    if (url === '/api/login/sms/send' && method === 'POST') {
      const body = await readBody(req);
      const nation = normalizeNation(body.nationCode);
      const phone = normalizePhone(body.phone);
      const captchaToken = String(body.captchaToken || '').trim();

      if (!isValidPhone(nation, phone)) return sendJSON(res, { ok: false, message: '手机号格式不正确' }, 400);
      if (!captchaToken) return sendJSON(res, { ok: false, message: '请先完成人机验证' }, 400);

      const now = Date.now();
      const last = lastSmsAt.get(phone) || 0;
      if (now - last < 5000) {
        return sendJSON(
          res,
          { ok: false, message: '发送太频繁，请稍后再试', retryAfter: Math.ceil((5000 - (now - last)) / 1000) },
          429
        );
      }

      const r = await request('POST', '/api/iam/v1/sms/send', {
        body: {
          nation_code: nation,
          phone: encryptPhone(phone),
          captcha_token: captchaToken,
          scene: 'login',
        },
        timeout: 20000,
      });

      const env = envelope(r);
      const d = env.data || {};
      if (!env.ok || !d.verification_id) {
        return sendJSON(res, { ok: false, message: friendlyError(r, '验证码发送失败'), code: env.code });
      }

      lastSmsAt.set(phone, now);
      return sendJSON(res, {
        ok: true,
        verificationId: d.verification_id,
        expiresIn: Number(d.expires_in) || 300,
        retryAfter: Number(d.retry_after) || 60,
      });
    }

    if (url === '/api/login/sms/verify' && method === 'POST') {
      const body = await readBody(req);
      const nation = normalizeNation(body.nationCode);
      const phone = normalizePhone(body.phone);
      const verificationId = String(body.verificationId || '').trim();
      const code = String(body.code || '').trim();

      if (!isValidPhone(nation, phone)) return sendJSON(res, { ok: false, message: '手机号格式不正确' }, 400);
      if (!verificationId) return sendJSON(res, { ok: false, message: '请先获取验证码' }, 400);
      if (!/^[0-9]{4,8}$/.test(code)) return sendJSON(res, { ok: false, message: '验证码格式不正确' }, 400);

      const r = await request('POST', '/api/iam/v1/auth/login/sms', {
        body: {
          nation_code: nation,
          phone: encryptPhone(phone),
          verification_id: verificationId,
          verification_code: code,
        },
        timeout: 20000,
      });

      const env = envelope(r);
      const d = env.data || {};
      const token = d.access_token || d.accessToken;
      if (!env.ok || !token) {
        return sendJSON(res, { ok: false, message: friendlyError(r, '登录失败'), code: env.code });
      }

      const saved = await establishLogin(token, {
        refreshToken: d.refresh_token || d.refreshToken || '',
        officeIdentity: d.office_identity || d.officeIdentity || '',
        phone,
      });
      return sendJSON(res, { ok: true, uid: saved.uid, phone: maskPhone(phone) });
    }

    if (url === '/api/login/token' && method === 'POST') {
      const body = await readBody(req);
      const token = String(body.token || '')
        .trim()
        .replace(/^Bearer\s+/i, '');
      if (!token) return sendJSON(res, { ok: false, message: '缺少 token' }, 400);
      if (token.length < 20) return sendJSON(res, { ok: false, message: 'token 格式不正确' }, 400);

      // 先拿它去问一次上游，避免把乱码存成登录态
      let probe;
      try {
        probe = await request('GET', '/api/web/auth/v1/user_info', {
          token,
          headers: webHeaders(token, identityFor(decodeUID(token) || 'probe')),
          timeout: 15000,
        });
      } catch (e) {
        return sendJSON(res, { ok: false, message: '无法连接上游：' + e.message }, 502);
      }
      if (probe.status === 401 || probe.status === 403) {
        return sendJSON(res, { ok: false, message: 'token 无效或已过期' });
      }
      if (probe.status >= 500) {
        return sendJSON(res, { ok: false, message: '上游服务异常（HTTP ' + probe.status + '）' }, 502);
      }

      const saved = await establishLogin(token, {
        refreshToken: String(body.refreshToken || '').trim(),
        officeIdentity: String(body.officeIdentity || '').trim(),
      });
      return sendJSON(res, { ok: true, uid: saved.uid });
    }

    if (url === '/api/logout' && method === 'POST') {
      const token = auth && auth.token;
      clearAuth();
      if (token) {
        // 尽力吊销，失败不影响本地登出
        request('POST', '/api/iam/v1/auth/logout', { token, body: {}, timeout: 8000 }).catch(() => {});
      }
      return sendJSON(res, { ok: true });
    }

    // ================= 以下都要登录 =================
    if (!auth || !auth.token) {
      return sendJSON(res, { ok: false, auth: false, message: '未登录' }, 401);
    }

    const key = accountKey();
    const idn = identityFor(key);

    if (url === '/api/me' && method === 'GET') {
      const { user, balance, status } = await fetchProfile();
      if (!user.ok) {
        if (status === 401 || status === 403) {
          clearAuth();
          return sendJSON(res, { ok: false, auth: false, message: '登录已失效，请重新登录' }, 401);
        }
        return sendJSON(res, { ok: false, message: user.message || '获取账号信息失败' });
      }
      const ud = user.data || {};
      const bd = (balance && balance.data) || {};
      const name = ud.name || ud.nickname || ud.user_name || '';
      if (name && auth) {
        auth.name = name;
        saveAuth();
      }
      return sendJSON(res, {
        ok: true,
        uid: auth.uid || '',
        name,
        phone: maskPhone(auth.phone || ud.phone || ''),
        points:
          bd.available_points != null
            ? bd.available_points
            : bd.availablePoints != null
              ? bd.availablePoints
              : bd.points != null
                ? bd.points
                : 0,
        officeIdentity: auth.officeIdentity || '',
      });
    }

    if (url === '/api/catalog' && method === 'GET') {
      const r = await request('GET', '/api/web/llm/v2/model_catalog', {
        token: auth.token,
        headers: webHeaders(auth.token, idn),
        cookie: auth.cookie,
      });
      const env = envelope(r);
      if (!env.ok) return sendJSON(res, { ok: false, message: friendlyError(r, '获取模型列表失败') });
      return sendJSON(res, { ok: true, models: parseCatalog(env.data) });
    }

    if (url === '/api/refresh' && method === 'POST') {
      if (!auth.refreshToken) return sendJSON(res, { ok: false, message: '没有 refresh_token，请重新登录' });
      const r = await request('POST', '/api/web/auth/v1/refresh', {
        headers: {
          'X-Client-Platform': idn.platformNoArch,
          'X-Client-Version': WEB_CLIENT_VERSION,
          'X-Client-Device-ID': idn.deviceID,
        },
        body: { refresh_token: auth.refreshToken },
        timeout: 15000,
      });
      const d = (r.json && r.json.data) || {};
      const token = d.access_token || d.accessToken || d.token;
      if (!token) return sendJSON(res, { ok: false, message: friendlyError(r, '刷新失败，请重新登录') });
      auth.token = token;
      if (d.refresh_token || d.refreshToken) auth.refreshToken = d.refresh_token || d.refreshToken;
      auth.uid = decodeUID(token) || auth.uid;
      saveAuth();
      return sendJSON(res, { ok: true });
    }

    // ---- 对话（流式代理）----
    if (url === '/api/chat' && method === 'POST') {
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) return sendJSON(res, { ok: false, message: '消息为空' }, 400);

      const firstUser = messages.find((m) => m && m.role === 'user');
      const titleSource = (firstUser && typeof firstUser.content === 'string' ? firstUser.content : '') || '';
      const title = titleSource.replace(/\s+/g, ' ').trim().slice(0, 20);

      const finalBody = prepareChatBody(body.model, body, 'raccoon-chat-ml-5-5');
      const payload = Buffer.from(JSON.stringify(finalBody));

      const headers = {
        ...chatHeaders(auth.token, idn, sessionID(key, titleSource.slice(0, 200)), newTurnID(), title),
        authorization: 'Bearer ' + auth.token,
        'content-type': 'application/json',
        'content-length': String(payload.length),
      };
      if (auth.cookie) headers.cookie = auth.cookie;

      let pair;
      try {
        pair = await new Promise((resolve, reject) => {
          const u = new URL(UPSTREAM + '/api/web/llm/v2/chat/completions');
          const lib = u.protocol === 'https:' ? https : http;
          const upReq = lib.request(u, { method: 'POST', headers }, (r) => resolve({ res: r, req: upReq }));
          upReq.setTimeout(120000, () => upReq.destroy(new Error('上游响应超时')));
          upReq.on('error', reject);
          upReq.write(payload);
          upReq.end();
        });
      } catch (e) {
        return sendJSON(res, { ok: false, message: '上游连接失败：' + e.message }, 502);
      }

      const upRes = pair.res;

      if (upRes.statusCode === 401 || upRes.statusCode === 403) {
        upRes.resume();
        clearAuth();
        return sendJSON(res, { ok: false, auth: false, message: '登录已失效，请重新登录' }, 401);
      }

      if (upRes.statusCode !== 200) {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let j = null;
          try {
            j = JSON.parse(text);
          } catch {}
          sendJSON(
            res,
            { ok: false, message: (j && (j.message || j.msg || j.details)) || '上游返回 HTTP ' + upRes.statusCode },
            200
          );
        });
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      // 客户端断开会话时，把上游也掐掉，避免白烧额度
      const abortUpstream = () => pair.req.destroy();
      req.on('aborted', abortUpstream);
      res.on('close', abortUpstream);

      upRes.pipe(res);
      return;
    }

    // ---- 每日签到 ----
    if (url === '/api/checkin' && method === 'POST') {
      const r = await request('POST', '/api/web/desktop/v1/login/points/grant', {
        token: auth.token,
        headers: webHeaders(auth.token, idn),
        cookie: auth.cookie,
        body: {},
        timeout: 20000,
      });
      const env = envelope(r);
      const d = env.data || {};
      const granted = d.granted != null ? !!d.granted : env.ok;
      return sendJSON(res, {
        ok: env.ok,
        granted,
        message: env.ok ? (granted ? '已领取每日积分' : '今日已领取过') : friendlyError(r, '领取失败'),
      });
    }

    // ---- 手机端首登奖 ----
    if (url === '/api/onboarding' && method === 'POST') {
      const r = await request('POST', '/api/web/mobile/v1/login/points/grant', {
        token: auth.token,
        headers: mobileHeaders(idn),
        cookie: auth.cookie,
        body: {},
        timeout: 20000,
      });
      const env = envelope(r);
      const d = env.data || {};
      const granted = d.granted != null ? !!d.granted : env.ok;
      return sendJSON(res, {
        ok: env.ok,
        granted,
        message: env.ok ? (granted ? '已领取新手奖励' : '此前已领取') : friendlyError(r, '领取失败'),
      });
    }

    return sendJSON(res, { ok: false, message: '未知接口: ' + url }, 404);
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 500;
    if (status === 500) console.error('[server]', e && e.stack ? e.stack : e);
    return sendJSON(res, { ok: false, message: status === 500 ? '服务错误：' + (e && e.message) : e.message }, status);
  }
});

function parseCatalog(raw) {
  if (!raw) return [];
  const out = [];
  const seen = {};
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it) continue;
      const id = it.name || it.id || it.model || it.model_name;
      if (!id || seen[id]) continue;
      if (it.visible === false) continue;
      seen[id] = true;
      let imgs = false;
      if (it.supportsImages != null) imgs = it.supportsImages;
      else if (it.supportImage != null) imgs = it.supportImage;
      else if (Array.isArray(it.tags) && it.tags.some((t) => /image|vision/i.test(String(t)))) imgs = true;
      out.push({
        id,
        name: it.display_name || it.displayName || (it.description || '').slice(0, 64) || id,
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

const serverInstance = server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log('小浣熊移动端已启动: http://' + shown + ':' + PORT);
  console.log('上游: ' + UPSTREAM);
  console.log('访问密钥: ' + (ACCESS_KEY ? '已开启' : '未设置（仅建议本机使用）'));
  if (auth) console.log('已保存登录态, uid=' + (auth.uid || '(不透明 token)'));
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。换个端口：PORT=8800 node server.js');
  } else if (e.code === 'EACCES') {
    console.error('没有权限监听 ' + HOST + ':' + PORT + '（1024 以下端口需要 root）');
  } else {
    console.error('服务启动失败：', e.message);
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log('\n收到 ' + signal + '，正在退出…');
  serverInstance.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
