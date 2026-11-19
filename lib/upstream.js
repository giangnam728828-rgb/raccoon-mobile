'use strict';

/**
 * 上游客户端：官方接口的请求、信封解析、错误翻译、客户端请求头、推理参数归一化。
 *
 * 这里的逻辑是从官方网页端逆向得到的，改动要非常谨慎：
 *   - README / 测试依赖这些请求头与参数形态
 *   - 手机号必须用官方 AES-128-CFB 密钥加密
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const config = require('./config');
const util = require('./util');

const {
  UPSTREAM, CLIENT_NAME, CLIENT_VERSION, WEB_CLIENT_VERSION,
  MOBILE_PLATFORM, MOBILE_CLIENT_VERSION, OS_VERSION, CHANNEL, PHONE_CIPHER_KEY,
} = config;

/** 当前登录态由 auth 模块注入，这里只读 token / officeIdentity */
let authRef = { current: () => null };
function bindAuth(getter) {
  authRef = { current: getter };
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

function deriveDeviceID(key) {
  return util.uuidLike(util.sha256Hex('agenthub:raccoon:' + (key || 'anon')));
}

function sessionID(key, seedText) {
  return util.uuidLike(util.sha256Hex('raccoon:' + (key || 'anon') + ':' + seedText));
}

const newTurnID = util.uuidV4;

const latinTitle = util.latinTitle;

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


// ---------- 账号维度 ----------
function accountKey() {
  const a = authRef.current();
  if (!a) return 'anon';
  return a.uid || 'tok-' + util.sha256Hex(a.token).slice(0, 16);
}

function identityFor(key) {
  const a = authRef.current();
  const did = deriveDeviceID(key);
  return {
    deviceID: did,
    osVersion: OS_VERSION,
    platform: 'desktop-windows-x64',
    platformNoArch: 'desktop-windows',
    clientChannel: CHANNEL,
    officeIdentity: (a && a.officeIdentity) || '',
    language: 'zh',
  };
}

module.exports = {
  bindAuth,
  accountKey,
  identityFor,
  isTeam,
  encryptPhone,
  deriveDeviceID,
  sessionID,
  newTurnID,
  latinTitle,
  request,
  envelope,
  friendlyError,
  chatHeaders,
  webHeaders,
  mobileHeaders,
  familyOf,
  normalizeReasoning,
  prepareChatBody,
  modelBaseName,
};
