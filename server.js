'use strict';

/**
 * 小浣熊移动端 —— 本地代理 + 静态服务（入口与路由）
 *
 * 模块：
 *   lib/config.js     环境变量与常量
 *   lib/util.js       响应 / 请求体 / 编码
 *   lib/auth.js       登录态与登录流程
 *   lib/upstream.js   官方接口客户端（逆向得到，改动需谨慎）
 *   lib/static.js     静态资源（ETag / 压缩 / 缓存）
 *   lib/sync.js       对话云同步
 *
 * 环境变量：
 *   PORT         监听端口，默认 8799
 *   HOST         监听地址，默认 127.0.0.1（要让手机通过局域网访问才改成 0.0.0.0）
 *   ACCESS_KEY   可选。设置后所有 /api/* 都需要带 x-access-key
 *   UPSTREAM     上游地址，默认 https://xiaohuanxiong.com（仅测试时改）
 *   DATA_DIR     数据落盘目录，默认 ./data
 */

const http = require('http');
const https = require('https');

const config = require('./lib/config');
const util = require('./lib/util');
const authStore = require('./lib/auth');
const upstream = require('./lib/upstream');
const staticSrv = require('./lib/static');
const sync = require('./lib/sync');

const {
  UPSTREAM, PORT, HOST, ACCESS_KEY, MAX_BODY, MAX_SYNC_BYTES,
  CAPTCHA, NATION_CODES, WEB_CLIENT_VERSION,
} = config;

const { sendJSON, readBody } = util;

// 登录态与上游模块解耦：上游只读当前账号
upstream.bindAuth(() => authStore.current());

// 本机兜底限流（上游自己还有 retry_after）
const lastSmsAt = new Map();

// ============================================================
// 模型目录解析
// ============================================================
function parseCatalog(raw) {
  if (!raw) return [];
  const out = [];
  const seen = new Set();

  function collect(arr) {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it) continue;
      const id = it.name || it.id || it.model || it.model_name;
      if (!id || seen.has(id)) continue;
      if (it.visible === false) continue;
      seen.add(id);

      let imgs = false;
      if (it.supportsImages != null) imgs = it.supportsImages;
      else if (it.supportImage != null) imgs = it.supportImage;
      else if (Array.isArray(it.tags)) {
        imgs = it.tags.some((t) => /image|vision/i.test(String(t)));
      }

      let reason = it.supports_reasoning;
      if (reason == null) reason = it.supportsReasoning;
      if (reason == null && Array.isArray(it.tags)) {
        reason = it.tags.some((t) => /reason|think/i.test(String(t)));
      }

      out.push({
        id,
        name: it.display_name || it.displayName || String(it.description || '').slice(0, 64) || id,
        contextLength: it.context_window || (it.params && it.params.context_window) || 0,
        maxOutputTokens: it.max_tokens || (it.params && it.params.max_tokens) || 0,
        supportsImages: !!imgs,
        supportsReasoning: !!reason,
      });
    }
  }

  collect(raw.models);
  if (!out.length && raw.categories) {
    for (const cat of raw.categories) {
      if (cat.type && cat.type !== 'chat') continue;
      collect(cat.models);
    }
  }
  return out;
}

// ============================================================
// 路由
// ============================================================
const server = http.createServer(async (req, res) => {
  const rawUrl = String(req.url || '/');
  const url = rawUrl.split('?')[0];
  const search = new URLSearchParams(rawUrl.split('?')[1] || '');
  const method = req.method || 'GET';
  const isApi = url.startsWith('/api/');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // ================= 公开 =================
    if (url === '/api/health' && method === 'GET') {
      const a = authStore.current();
      return sendJSON(res, {
        ok: true,
        upstream: UPSTREAM,
        service: 'raccoon-mobile',
        loggedIn: !!(a && a.token),
        uptime: Math.round(process.uptime()),
        cache: staticSrv.cacheStats(),
      });
    }

    if (url === '/api/login/config' && method === 'GET') {
      return sendJSON(res, {
        ok: true,
        captcha: CAPTCHA,
        nationCodes: NATION_CODES,
        keyRequired: !!ACCESS_KEY,
      });
    }

    // ---- 访问密钥 ----
    if (isApi && ACCESS_KEY) {
      const provided = req.headers['x-access-key'] || search.get('key') || '';
      if (provided !== ACCESS_KEY) {
        return sendJSON(res, { ok: false, auth: false, keyRequired: true, message: '需要访问密钥' }, 401);
      }
    }

    // ---- 静态 ----
    if (!isApi) {
      if (method === 'GET' || method === 'HEAD') return staticSrv.serve(req, res);
      res.writeHead(405);
      return res.end();
    }

    // ================= 登录 =================
    if (url === '/api/login/sms/send' && method === 'POST') {
      const body = await readBody(req);
      const nation = util.normalizeNation(body.nationCode);
      const phone = util.normalizePhone(body.phone);
      const captchaToken = String(body.captchaToken || '').trim();

      if (!util.isValidPhone(nation, phone)) {
        return sendJSON(res, { ok: false, message: '手机号格式不正确' }, 400);
      }
      if (!captchaToken) return sendJSON(res, { ok: false, message: '请先完成人机验证' }, 400);

      const now = Date.now();
      const last = lastSmsAt.get(phone) || 0;
      if (now - last < 5000) {
        return sendJSON(res, {
          ok: false,
          message: '发送太频繁，请稍后再试',
          retryAfter: Math.ceil((5000 - (now - last)) / 1000),
        }, 429);
      }

      const r = await upstream.request('POST', '/api/iam/v1/sms/send', {
        body: {
          nation_code: nation,
          phone: upstream.encryptPhone(phone),
          captcha_token: captchaToken,
          scene: 'login',
        },
        timeout: 20000,
      });

      const env = upstream.envelope(r);
      const d = env.data || {};
      if (!env.ok || !d.verification_id) {
        return sendJSON(res, {
          ok: false,
          message: upstream.friendlyError(r, '验证码发送失败'),
          code: env.code,
        });
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
      const nation = util.normalizeNation(body.nationCode);
      const phone = util.normalizePhone(body.phone);
      const verificationId = String(body.verificationId || '').trim();
      const code = String(body.code || '').trim();

      if (!util.isValidPhone(nation, phone)) {
        return sendJSON(res, { ok: false, message: '手机号格式不正确' }, 400);
      }
      if (!verificationId) return sendJSON(res, { ok: false, message: '请先获取验证码' }, 400);
      if (!/^[0-9]{4,8}$/.test(code)) {
        return sendJSON(res, { ok: false, message: '验证码格式不正确' }, 400);
      }

      const r = await upstream.request('POST', '/api/iam/v1/auth/login/sms', {
        body: {
          nation_code: nation,
          phone: upstream.encryptPhone(phone),
          verification_id: verificationId,
          verification_code: code,
        },
        timeout: 20000,
      });

      const env = upstream.envelope(r);
      const d = env.data || {};
      const token = d.access_token || d.accessToken;
      if (!env.ok || !token) {
        return sendJSON(res, {
          ok: false,
          message: upstream.friendlyError(r, '登录失败'),
          code: env.code,
        });
      }

      const saved = await authStore.establish(token, {
        refreshToken: d.refresh_token || d.refreshToken || '',
        officeIdentity: d.office_identity || d.officeIdentity || '',
        phone,
      });
      return sendJSON(res, { ok: true, uid: saved.uid, phone: authStore.maskPhone(phone) });
    }

    if (url === '/api/login/token' && method === 'POST') {
      const body = await readBody(req);
      const token = String(body.token || '').trim().replace(/^Bearer\s+/i, '');
      if (!token) return sendJSON(res, { ok: false, message: '缺少 token' }, 400);
      if (token.length < 20) return sendJSON(res, { ok: false, message: 'token 格式不正确' }, 400);

      let probe;
      try {
        probe = await upstream.request('GET', '/api/web/auth/v1/user_info', {
          token,
          headers: upstream.webHeaders(
            token,
            upstream.identityFor(util.decodeUID(token) || 'probe')
          ),
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

      const saved = await authStore.establish(token, {
        refreshToken: String(body.refreshToken || '').trim(),
        officeIdentity: String(body.officeIdentity || '').trim(),
      });
      return sendJSON(res, { ok: true, uid: saved.uid });
    }

    if (url === '/api/logout' && method === 'POST') {
      const token = authStore.token;
      authStore.clear();
      if (token) {
        upstream.request('POST', '/api/iam/v1/auth/logout', {
          token, body: {}, timeout: 8000,
        }).catch(() => {});
      }
      return sendJSON(res, { ok: true });
    }

    // ================= 以下都要登录 =================
    const a = authStore.current();
    if (!a || !a.token) {
      return sendJSON(res, { ok: false, auth: false, message: '未登录' }, 401);
    }

    const key = upstream.accountKey();
    const idn = upstream.identityFor(key);

    if (url === '/api/me' && method === 'GET') {
      const { user, balance, status } = await authStore.profile();
      if (!user.ok) {
        if (status === 401 || status === 403) {
          authStore.clear();
          return sendJSON(res, { ok: false, auth: false, message: '登录已失效，请重新登录' }, 401);
        }
        return sendJSON(res, { ok: false, message: user.message || '获取账号信息失败' });
      }
      const ud = user.data || {};
      const bd = (balance && balance.data) || {};
      const name = ud.name || ud.nickname || ud.user_name || '';
      if (name) {
        a.name = name;
        authStore.save();
      }
      return sendJSON(res, {
        ok: true,
        uid: a.uid || '',
        name,
        phone: authStore.maskPhone(a.phone || ud.phone || ''),
        points:
          bd.available_points != null ? bd.available_points
            : bd.availablePoints != null ? bd.availablePoints
              : bd.points != null ? bd.points : 0,
        officeIdentity: a.officeIdentity || '',
      });
    }

    if (url === '/api/catalog' && method === 'GET') {
      const r = await upstream.request('GET', '/api/web/llm/v2/model_catalog', {
        token: a.token,
        headers: upstream.webHeaders(a.token, idn),
        cookie: a.cookie,
      });
      const env = upstream.envelope(r);
      if (!env.ok) {
        return sendJSON(res, { ok: false, message: upstream.friendlyError(r, '获取模型列表失败') });
      }
      return sendJSON(res, { ok: true, models: parseCatalog(env.data) });
    }

    if (url === '/api/refresh' && method === 'POST') {
      if (!a.refreshToken) {
        return sendJSON(res, { ok: false, message: '没有 refresh_token，请重新登录' });
      }
      const r = await upstream.request('POST', '/api/web/auth/v1/refresh', {
        headers: {
          'X-Client-Platform': idn.platformNoArch,
          'X-Client-Version': WEB_CLIENT_VERSION,
          'X-Client-Device-ID': idn.deviceID,
        },
        body: { refresh_token: a.refreshToken },
        timeout: 15000,
      });
      const d = (r.json && r.json.data) || {};
      const token = d.access_token || d.accessToken || d.token;
      if (!token) {
        return sendJSON(res, { ok: false, message: upstream.friendlyError(r, '刷新失败，请重新登录') });
      }
      a.token = token;
      if (d.refresh_token || d.refreshToken) a.refreshToken = d.refresh_token || d.refreshToken;
      a.uid = util.decodeUID(token) || a.uid;
      authStore.save();
      return sendJSON(res, { ok: true });
    }

    // ---- 对话（流式代理）----
    if (url === '/api/chat' && method === 'POST') {
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) return sendJSON(res, { ok: false, message: '消息为空' }, 400);

      const firstUser = messages.find((m) => m && m.role === 'user');
      let titleSource = '';
      if (firstUser) {
        if (typeof firstUser.content === 'string') titleSource = firstUser.content;
        else if (Array.isArray(firstUser.content)) {
          const t = firstUser.content.find((c) => c && c.type === 'text');
          if (t && t.text) titleSource = String(t.text);
        }
      }
      const title = titleSource.replace(/\s+/g, ' ').trim().slice(0, 20);

      const finalBody = upstream.prepareChatBody(body.model, body, 'raccoon-chat-ml-5-5');
      const payload = Buffer.from(JSON.stringify(finalBody));

      const headers = {
        ...upstream.chatHeaders(
          a.token, idn,
          upstream.sessionID(key, titleSource.slice(0, 200)),
          upstream.newTurnID(), title
        ),
        authorization: 'Bearer ' + a.token,
        'content-type': 'application/json',
        'content-length': String(payload.length),
      };
      if (a.cookie) headers.cookie = a.cookie;

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
        authStore.clear();
        return sendJSON(res, { ok: false, auth: false, message: '登录已失效，请重新登录' }, 401);
      }

      if (upRes.statusCode !== 200) {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let j = null;
          try { j = JSON.parse(text); } catch {}
          sendJSON(res, {
            ok: false,
            message: (j && (j.message || j.msg || j.details)) ||
              '上游返回 HTTP ' + upRes.statusCode,
          }, 200);
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

      // 心跳：长推理时中间可能几十秒没有数据，代理/运营商容易掐断
      const heartbeat = setInterval(() => {
        try {
          if (!res.writableEnded) res.write(': ping\n\n');
        } catch {}
      }, 15000);

      const abortUpstream = () => {
        clearInterval(heartbeat);
        pair.req.destroy();
      };
      req.on('aborted', abortUpstream);
      res.on('close', abortUpstream);

      upRes.on('end', () => clearInterval(heartbeat));
      upRes.on('error', () => clearInterval(heartbeat));
      upRes.pipe(res);
      return;
    }

    // ---- 积分 ----
    if (url === '/api/checkin' && method === 'POST') {
      return grantPoints(res, a, idn, '/api/web/desktop/v1/login/points/grant', '领取失败');
    }

    if (url === '/api/onboarding' && method === 'POST') {
      return grantPoints(res, a, idn, '/api/web/mobile/v1/login/points/grant', '领取失败');
    }

    // ---- 对话云同步 ----
    if (url === '/api/sync' && method === 'GET') {
      const data = sync.read(key);
      if (!data) return sendJSON(res, { ok: true, rev: 0, updatedAt: 0, chats: [] });
      return sendJSON(res, {
        ok: true,
        rev: data.rev,
        updatedAt: data.updatedAt,
        chats: data.chats,
      });
    }

    if (url === '/api/sync' && method === 'PUT') {
      const body = await readBody(req, MAX_SYNC_BYTES);
      const chats = Array.isArray(body.chats) ? body.chats : null;
      if (!chats) return sendJSON(res, { ok: false, message: 'chats 必须是数组' }, 400);
      if (chats.length > 500) {
        return sendJSON(res, { ok: false, message: '对话数量超过上限（500）' }, 400);
      }
      const meta = sync.write(key, chats);
      return sendJSON(res, { ok: true, ...meta });
    }

    if (url === '/api/sync' && method === 'DELETE') {
      sync.remove(key);
      return sendJSON(res, { ok: true });
    }

    // ---- 未知接口 ----
    return sendJSON(res, { ok: false, message: '不支持的接口：' + url }, 404);
  } catch (e) {
    const status = (e && e.statusCode) || 500;
    if (status === 413) return sendJSON(res, { ok: false, message: '请求体过大' }, 413);
    if (status === 400) return sendJSON(res, { ok: false, message: e.message }, 400);
    console.error('[error]', req.method, url, e && e.message);
    if (!res.headersSent) {
      return sendJSON(res, { ok: false, message: '服务内部错误' }, 500);
    }
    try { res.end(); } catch {}
  }
});

async function grantPoints(res, a, idn, path, fallback) {
  const r = await upstream.request('POST', path, {
    token: a.token,
    headers: upstream.webHeaders(a.token, idn),
    cookie: a.cookie,
    body: {},
    timeout: 20000,
  });
  const env = upstream.envelope(r);
  if (!env.ok) return sendJSON(res, { ok: false, message: upstream.friendlyError(r, fallback) });
  const d = env.data || {};
  return sendJSON(res, {
    ok: true,
    message: d.message || d.msg || '已完成',
    points: authStore.pickPoints(d),
  });
}

// ============================================================
// 启动
// ============================================================
authStore.load();

server.listen(PORT, HOST, () => {
  console.log('小浣熊服务已启动  http://' + HOST + ':' + PORT);
  console.log('  上游   : ' + UPSTREAM);
  console.log('  数据   : ' + config.DATA_DIR);
  console.log('  访问密钥: ' + (ACCESS_KEY ? '已启用' : '未设置（同网段可直接使用）'));
});

process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandled]', e && e.stack ? e.stack : e);
});

module.exports = { server, parseCatalog };
