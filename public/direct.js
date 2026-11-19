/*
 * 小浣熊 · 直连客户端（App 内置）
 *
 * 以前的版本要靠手机里跑一个 Node 代理（127.0.0.1:8799）才能登录、聊天，
 * 代理没起来 / 地址填错就整段不可用。这里把代理的逻辑搬进 App：
 *   - 手机号 AES-128-CFB 加密（和官方网页端一致）
 *   - 短信验证码登录（/api/iam/v1）
 *   - 登录后建立业务会话，带 Bearer 直接请求官方接口
 * 官方对 https://localhost 这个源放行了 CORS（含 credentials），所以 WebView 里能直连。
 *
 * 没有任何地址需要手填：默认直连官方；只有显式配置了代理才会走代理（备用）。
 */
(function (global) {
  'use strict';

  var UPSTREAM = 'https://xiaohuanxiong.com';

  var CLIENT_NAME = 'raccoon-ai';
  var CLIENT_VERSION = '1.0.35';
  var WEB_CLIENT_VERSION = 'v1.1.3';
  var OS_VERSION = '10.0.26200';
  var CHANNEL = 'stable';

  // 官方网页端提交手机号前的 AES-128-CFB 密钥
  var PHONE_CIPHER_KEY = 'senseraccoon2023';

  var AUTH_KEY = 'raccoon.auth';
  var DEVICE_KEY = 'raccoon.device';

  // ---------- 存储 ----------
  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeJSON(key, val) {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  var auth = readJSON(AUTH_KEY) || null;

  function getAuth() {
    return auth;
  }
  function setAuth(a) {
    auth = a;
    writeJSON(AUTH_KEY, a);
  }
  function clearAuth() {
    auth = null;
    writeJSON(AUTH_KEY, null);
  }
  function hasAuth() {
    return !!(auth && auth.token);
  }

  // 设备 ID：装一次生成一次，稳定即可
  function deviceID() {
    var d = '';
    try {
      d = localStorage.getItem(DEVICE_KEY) || '';
    } catch (e) {}
    if (!d) {
      d = uuid();
      try {
        localStorage.setItem(DEVICE_KEY, d);
      } catch (e) {}
    }
    return d;
  }

  // ---------- 小工具 ----------
  function uuid() {
    var b = new Uint8Array(16);
    var c = global.crypto || global.msCrypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hx = '0123456789abcdef';
    var out = '';
    for (var j = 0; j < 16; j++) {
      if (j === 4 || j === 6 || j === 8 || j === 10) out += '-';
      out += hx[b[j] >> 4] + hx[b[j] & 0xf];
    }
    return out;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function b64encode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function b64urlDecode(str) {
    var s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try {
      return decodeURIComponent(
        atob(s)
          .split('')
          .map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
      );
    } catch (e) {
      return '';
    }
  }

  function decodeUID(token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length < 2) return '';
      var p = JSON.parse(b64urlDecode(parts[1]));
      return p.sub || p.uid || p.user_id || p.id || '';
    } catch (e) {
      return '';
    }
  }

  function maskPhone(phone) {
    var p = String(phone || '');
    if (p.length < 7) return p;
    return p.slice(0, 3) + '****' + p.slice(-4);
  }

  // 头部只能放 ASCII，中文标题按 UTF-8 百分号编码
  function latinTitle(title) {
    var s = String(title || '');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 32 && code < 127) out += s[i];
      else {
        var ch = s[i];
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
          ch = s.slice(i, i + 2);
          i++;
        }
        out += encodeURIComponent(ch);
      }
    }
    return out;
  }

  // ---------- AES-128-CFB（只做加密，和 Node 的 aes-128-cfb 逐字节一致）----------
  var SBOX = null;
  var RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function xtime(a) {
    return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
  }

  function gmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p & 0xff;
  }

  function buildSbox() {
    var inv = new Uint8Array(256);
    var box = new Uint8Array(256);
    for (var i = 1; i < 256; i++) {
      for (var j = 1; j < 256; j++) {
        if (gmul(i, j) === 1) {
          inv[i] = j;
          break;
        }
      }
    }
    for (var k = 0; k < 256; k++) {
      var x = inv[k];
      var s = x;
      for (var r = 1; r <= 4; r++) s ^= ((x << r) | (x >>> (8 - r))) & 0xff;
      box[k] = (s ^ 0x63) & 0xff;
    }
    return box;
  }

  function expandKey(key) {
    var w = new Uint8Array(176);
    for (var i = 0; i < 16; i++) w[i] = key[i];
    for (var n = 16; n < 176; n += 4) {
      var t0 = w[n - 4];
      var t1 = w[n - 3];
      var t2 = w[n - 2];
      var t3 = w[n - 1];
      if (n % 16 === 0) {
        var tmp = t0;
        t0 = SBOX[t1] ^ RCON[n / 16 - 1];
        t1 = SBOX[t2];
        t2 = SBOX[t3];
        t3 = SBOX[tmp];
      }
      w[n] = w[n - 16] ^ t0;
      w[n + 1] = w[n - 15] ^ t1;
      w[n + 2] = w[n - 14] ^ t2;
      w[n + 3] = w[n - 13] ^ t3;
    }
    return w;
  }

  function encryptBlock(s, w) {
    var i;
    var r;
    for (i = 0; i < 16; i++) s[i] ^= w[i];
    for (r = 1; r < 10; r++) {
      for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      var t = s[1];
      s[1] = s[5];
      s[5] = s[9];
      s[9] = s[13];
      s[13] = t;
      t = s[2];
      s[2] = s[10];
      s[10] = t;
      t = s[6];
      s[6] = s[14];
      s[14] = t;
      t = s[3];
      s[3] = s[15];
      s[15] = s[11];
      s[11] = s[7];
      s[7] = t;
      for (var c = 0; c < 4; c++) {
        var o = c * 4;
        var a0 = s[o];
        var a1 = s[o + 1];
        var a2 = s[o + 2];
        var a3 = s[o + 3];
        s[o] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        s[o + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        s[o + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        s[o + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
      }
      for (i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    }
    for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    var u = s[1];
    s[1] = s[5];
    s[5] = s[9];
    s[9] = s[13];
    s[13] = u;
    u = s[2];
    s[2] = s[10];
    s[10] = u;
    u = s[6];
    s[6] = s[14];
    s[14] = u;
    u = s[3];
    s[3] = s[15];
    s[15] = s[11];
    s[11] = s[7];
    s[7] = u;
    for (i = 0; i < 16; i++) s[i] ^= w[160 + i];
  }

  function cfbEncrypt(key, iv, data) {
    if (!SBOX) SBOX = buildSbox();
    var w = expandKey(key);
    var out = new Uint8Array(data.length);
    var prev = iv.slice(0, 16);
    for (var off = 0; off < data.length; off += 16) {
      var ks = prev.slice(0, 16);
      encryptBlock(ks, w);
      var n = Math.min(16, data.length - off);
      for (var i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
      if (n === 16) prev = out.slice(off, off + 16);
    }
    return out;
  }

  // 老 WebView 没有 AbortSignal.timeout，自己兜一层
  function timeoutSignal(ms) {
    try {
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
      if (typeof AbortController === 'undefined') return undefined;
      var c = new AbortController();
      setTimeout(function () {
        c.abort();
      }, ms);
      return c.signal;
    } catch (e) {
      return undefined;
    }
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    var c = global.crypto || global.msCrypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }

  // 手机号 → base64(iv + ciphertext)，和官方网页端一致
  function encryptPhone(phone) {
    var key = utf8Bytes(PHONE_CIPHER_KEY);
    var iv = randomBytes(16);
    var ct = cfbEncrypt(key, iv, utf8Bytes(String(phone)));
    var out = new Uint8Array(16 + ct.length);
    out.set(iv, 0);
    out.set(ct, 16);
    return b64encode(out);
  }

  // ---------- 请求 ----------
  function netError(msg) {
    var e = new Error(msg || '网络不可达');
    e.network = true;
    return e;
  }

  function authError(msg) {
    var e = new Error(msg || '登录已失效，请重新登录');
    e.auth = false;
    return e;
  }

  function raw(path, opts) {
    opts = opts || {};
    var headers = { accept: 'application/json' };
    var k;
    if (opts.headers) for (k in opts.headers) headers[k] = opts.headers[k];
    var body;
    if (opts.body !== undefined && opts.body !== null) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;

    return fetch(UPSTREAM + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body,
      // 官方会种 xhx_token 之类的 cookie，能带就带上
      credentials: 'include',
      cache: 'no-store',
      signal: opts.signal,
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw e;
      throw netError('连不上官方服务，请检查网络');
    });
  }

  async function json(path, opts) {
    var res = await raw(path, opts);
    var text = '';
    try {
      text = await res.text();
    } catch (e) {}
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }
    return { status: res.status, data: data, text: text };
  }

  // 官方业务接口的信封 { code, message, data }
  function envelope(r) {
    var j = r.data || {};
    var code = j.code;
    var ok = r.status >= 200 && r.status < 300 && (code === 0 || code === undefined || code === 'OK');
    return {
      ok: ok,
      status: r.status,
      code: code,
      message: j.message || j.msg || (typeof j.details === 'string' ? j.details : ''),
      data: j.data !== undefined ? j.data : j,
    };
  }

  var ERR_TEXT = {
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

  function friendly(r, fallback) {
    var code = String((r.data && r.data.code) || '');
    var rawMsg = String((r.data && (r.data.message || r.data.details)) || '');
    // 上游把很多原因都塞进 COMMON_INVALID_ARGUMENT，先看具体字段再按 code 兜底
    if (/captcha/i.test(rawMsg)) return '人机验证未通过或已失效，请重试';
    if (/phone/i.test(rawMsg)) return '手机号格式不正确';
    if (/verification_code/i.test(rawMsg)) return '验证码不正确';
    if (/verification_id/i.test(rawMsg)) return '验证码已失效，请重新获取';
    if (ERR_TEXT[code]) return ERR_TEXT[code];
    if (/rate|frequen|too many/i.test(rawMsg) || /RATE_LIMITED/i.test(code)) return '操作太频繁，请稍后再试';
    return rawMsg || fallback || '请求失败';
  }

  // ---------- 请求头 ----------
  function identity() {
    return {
      deviceID: deviceID(),
      osVersion: OS_VERSION,
      platform: 'desktop-windows-x64',
      platformNoArch: 'desktop-windows',
      clientChannel: CHANNEL,
      officeIdentity: (auth && auth.officeIdentity) || '',
      language: 'zh',
    };
  }

  function isTeam(oi) {
    var v = String(oi || '').trim();
    return v !== '' && v !== 'personal';
  }

  function webHeaders() {
    var idn = identity();
    var h = {
      accept: 'application/json',
      'X-Client-Platform': idn.platformNoArch,
      'X-Client-Version': WEB_CLIENT_VERSION,
      'X-Client-Device-ID': idn.deviceID,
      'X-Raccoon-Language': 'zh',
    };
    if (isTeam(idn.officeIdentity)) h['X-Org-Code'] = idn.officeIdentity;
    return h;
  }

  function chatHeaders(sess, turn, title) {
    var idn = identity();
    var h = {
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

  // ---------- 登录 ----------
  function loginConfig() {
    return {
      ok: true,
      captcha: { scene: '1pkmy0x3', prefix: 'hk1r5l', region: 'cn' },
      nationCodes: [
        { code: '+86', label: '中国大陆' },
        { code: '+852', label: '中国香港' },
        { code: '+853', label: '中国澳门' },
        { code: '+886', label: '中国台湾' },
      ],
      keyRequired: false,
    };
  }

  function normalizeNation(n) {
    var v = String(n || '+86').trim();
    if (v.charAt(0) !== '+') v = '+' + v;
    return v;
  }

  function normalizePhone(p) {
    return String(p || '').replace(/[\s\-()]/g, '');
  }

  function validPhone(nation, phone) {
    if (!/^\+[0-9]{1,4}$/.test(nation)) return false;
    if (!/^[0-9]{5,15}$/.test(phone)) return false;
    if (nation === '+86') return /^1[3-9][0-9]{9}$/.test(phone);
    return true;
  }

  async function sendSms(o) {
    var nation = normalizeNation(o.nationCode);
    var phone = normalizePhone(o.phone);
    var captchaToken = String(o.captchaToken || '').trim();
    if (!validPhone(nation, phone)) return { ok: false, message: '手机号格式不正确' };
    if (!captchaToken) return { ok: false, message: '请先完成人机验证' };

    var r = await json('/api/iam/v1/sms/send', {
      method: 'POST',
      body: {
        nation_code: nation,
        phone: encryptPhone(phone),
        captcha_token: captchaToken,
        scene: 'login',
      },
      signal: o.signal,
    });
    var env = envelope(r);
    var d = env.data || {};
    if (!env.ok || !d.verification_id) {
      return {
        ok: false,
        message: friendly(r, '验证码发送失败'),
        code: env.code,
        httpStatus: env.status,
      };
    }
    return {
      ok: true,
      verificationId: d.verification_id,
      expiresIn: Number(d.expires_in) || 300,
      retryAfter: Number(d.retry_after) || 60,
    };
  }

  async function verifySms(o) {
    var nation = normalizeNation(o.nationCode);
    var phone = normalizePhone(o.phone);
    var vid = String(o.verificationId || '').trim();
    var code = String(o.code || '').trim();
    if (!validPhone(nation, phone)) return { ok: false, message: '手机号格式不正确' };
    if (!vid) return { ok: false, message: '请先获取验证码' };
    if (!/^[0-9]{4,8}$/.test(code)) return { ok: false, message: '验证码格式不正确' };

    var r = await json('/api/iam/v1/auth/login/sms', {
      method: 'POST',
      body: {
        nation_code: nation,
        phone: encryptPhone(phone),
        verification_id: vid,
        verification_code: code,
      },
      signal: o.signal,
    });
    var env = envelope(r);
    var d = env.data || {};
    var token = d.access_token || d.accessToken;
    if (!env.ok || !token) return { ok: false, message: friendly(r, '登录失败'), code: env.code };

    await establish(token, {
      refreshToken: d.refresh_token || d.refreshToken || '',
      officeIdentity: d.office_identity || d.officeIdentity || '',
      phone: phone,
    });
    return { ok: true, uid: (auth && auth.uid) || '', phone: maskPhone(phone) };
  }

  async function loginByToken(token) {
    token = String(token || '')
      .trim()
      .replace(/^Bearer\s+/i, '');
    if (!token) return { ok: false, message: '缺少 token' };
    if (token.length < 20) return { ok: false, message: 'token 格式不正确' };

    var probe;
    try {
      probe = await json('/api/web/auth/v1/user_info', { token: token, headers: webHeaders() });
    } catch (e) {
      return { ok: false, message: e.message || '无法连接官方服务' };
    }
    if (probe.status === 401 || probe.status === 403) return { ok: false, message: 'token 无效或已过期' };
    if (probe.status >= 500) return { ok: false, message: '官方服务异常（HTTP ' + probe.status + '）' };

    try {
      await establish(token, {});
    } catch (e) {}
    return { ok: true, uid: (auth && auth.uid) || '' };
  }

  // 登录后补一次 confirm，尽力建立业务会话（失败不影响主流程）
  async function establish(token, extra) {
    setAuth({
      token: token,
      refreshToken: extra.refreshToken || '',
      officeIdentity: extra.officeIdentity || '',
      uid: decodeUID(token),
      phone: extra.phone || '',
      savedAt: Date.now(),
    });
    try {
      await json('/api/web/auth/v1/iam/confirm', { method: 'POST', body: {}, token: token, signal: timeoutSignal(8000) });
    } catch (e) {}
    return auth;
  }

  async function logout() {
    var t = auth && auth.token;
    clearAuth();
    if (t) {
      try {
        await json('/api/iam/v1/auth/logout', { method: 'POST', body: {}, token: t, signal: timeoutSignal(6000) });
      } catch (e) {}
    }
    return { ok: true };
  }

  // ---------- 账号 ----------
  function pickPoints(d) {
    if (!d) return 0;
    if (d.available_points != null) return d.available_points;
    if (d.availablePoints != null) return d.availablePoints;
    if (d.points != null) return d.points;
    return 0;
  }

  async function me() {
    if (!hasAuth()) throw authError('未登录');
    var h = webHeaders();
    var user;
    try {
      user = await json('/api/web/auth/v1/user_info', { token: auth.token, headers: h });
    } catch (e) {
      if (e.network) throw e;
      throw e;
    }
    var env = envelope(user);
    if (!env.ok) {
      if (env.status === 401 || env.status === 403) {
        clearAuth();
        throw authError('登录已失效，请重新登录');
      }
      return { ok: false, message: env.message || '获取账号信息失败' };
    }
    var ud = env.data || {};
    var balance = null;
    try {
      var b = await json('/api/web/points/v1/balance', { token: auth.token, headers: h });
      balance = envelope(b).data;
    } catch (e) {}

    var name = ud.name || ud.nickname || ud.user_name || '';
    if (name) auth.name = name;
    return {
      ok: true,
      uid: auth.uid || '',
      name: name,
      phone: maskPhone(auth.phone || ud.phone || ''),
      points: pickPoints(balance),
      officeIdentity: auth.officeIdentity || '',
    };
  }

  // ---------- 模型 ----------
  function parseCatalog(raw) {
    if (!raw) return [];
    var out = [];
    var seen = {};
    function collect(arr) {
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (!it) continue;
        var id = it.name || it.id || it.model || it.model_name;
        if (!id || seen[id]) continue;
        if (it.visible === false) continue;
        seen[id] = true;
        var imgs = false;
        if (it.supportsImages != null) imgs = it.supportsImages;
        else if (it.supportImage != null) imgs = it.supportImage;
        else if (Array.isArray(it.tags)) {
          for (var k = 0; k < it.tags.length; k++) {
            if (/image|vision/i.test(String(it.tags[k]))) {
              imgs = true;
              break;
            }
          }
        }
        out.push({
          id: id,
          name: it.display_name || it.displayName || String(it.description || '').slice(0, 64) || id,
          contextLength: it.context_window || (it.params && it.params.context_window) || 0,
          maxOutputTokens: it.max_tokens || (it.params && it.params.max_tokens) || 0,
          supportsImages: !!imgs,
          supportsReasoning: it.supports_reasoning,
        });
      }
    }
    collect(raw.models);
    if (!out.length && raw.categories) {
      for (var i = 0; i < raw.categories.length; i++) {
        var cat = raw.categories[i];
        if (cat.type && cat.type !== 'chat') continue;
        collect(cat.models);
      }
    }
    return out;
  }

  async function catalog() {
    if (!hasAuth()) throw authError('未登录');
    var r = await json('/api/web/llm/v2/model_catalog', { token: auth.token, headers: webHeaders() });
    var env = envelope(r);
    if (!env.ok) {
      if (env.status === 401 || env.status === 403) {
        clearAuth();
        throw authError('登录已失效，请重新登录');
      }
      return { ok: false, message: friendly(r, '获取模型列表失败') };
    }
    return { ok: true, models: parseCatalog(env.data) };
  }

  // ---------- 积分 ----------
  async function grant(path, fallback) {
    if (!hasAuth()) throw authError('未登录');
    var r = await json(path, { method: 'POST', body: {}, token: auth.token, headers: webHeaders() });
    var env = envelope(r);
    if (!env.ok) return { ok: false, message: friendly(r, fallback) };
    var d = env.data || {};
    return { ok: true, message: d.message || d.msg || '已完成', points: pickPoints(d) };
  }

  function checkin() {
    return grant('/api/web/desktop/v1/login/points/grant', '领取失败');
  }
  function onboarding() {
    return grant('/api/web/mobile/v1/login/points/grant', '领取失败');
  }

  // ---------- 对话（流式）----------
  var EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  function modelBaseName(model) {
    var m = String(model || '').trim();
    var i = m.lastIndexOf('/');
    if (i >= 0) m = m.slice(i + 1);
    return m.toLowerCase();
  }

  function familyOf(model) {
    var name = modelBaseName(model).replace(/\./g, '-');
    if (name.indexOf('sn-deepseek-') === 0 || name.indexOf('deepseek-') === 0) return 'thinking';
    if (
      name.indexOf('sn-glm-5-3') === 0 ||
      name.indexOf('glm-5-3') === 0 ||
      name.indexOf('sn-kimi-k3') === 0 ||
      name.indexOf('kimi-k3') === 0
    )
      return 'thinking';
    if (name.indexOf('o1') === 0 || name.indexOf('o3') === 0 || name.indexOf('o4') === 0) return 'low_high';
    if (name.indexOf('sn-') === 0 || name.indexOf('gpt-5') === 0) return 'effort';
    if (name.indexOf('claude') === 0) return 'effort';
    if (name.indexOf('gemini') === 0) return 'effort';
    return '';
  }

  function normalizeReasoning(body, model) {
    if (body.reasoningEffort !== undefined && body.reasoning_effort === undefined) {
      body.reasoning_effort = body.reasoningEffort;
      delete body.reasoningEffort;
    }
    var kind = familyOf(model);
    if (!kind) return body;
    var effort = body.reasoning_effort;
    var hasThinking = body.thinking !== undefined;
    var off = effort === 'off' || effort === 'none';
    if (kind === 'thinking') {
      if (!hasThinking && off) {
        delete body.reasoning_effort;
        body.thinking = { type: 'disabled' };
        return body;
      }
      if (!hasThinking && EFFORTS.indexOf(effort) >= 0) {
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
      if (EFFORTS.indexOf(effort) >= 0) body.reasoning_effort = EFFORTS.indexOf(effort) <= 1 ? 'low' : 'high';
      else if (off) body.reasoning_effort = 'low';
      return body;
    }
    if (kind === 'effort') {
      if (EFFORTS.indexOf(effort) >= 0) {
        var r = EFFORTS.indexOf(effort);
        body.reasoning_effort = r <= 1 ? 'low' : r === 2 ? 'medium' : 'high';
      } else if (off) {
        delete body.reasoning_effort;
      }
      return body;
    }
    return body;
  }

  function prepareBody(model, input) {
    var out = {};
    for (var k in input) out[k] = input[k];
    out.model = String(model || '').trim() || 'raccoon-chat-ml-5-5';
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

  function newSessionId() {
    return uuid();
  }

  /**
   * 发起一次流式对话。
   * handlers: { onDelta({content, reasoning}), onDone(), }
   */
  async function chat(payload, handlers) {
    if (!hasAuth()) throw authError('未登录');
    handlers = handlers || {};

    var messages = Array.isArray(payload.messages) ? payload.messages : [];
    if (!messages.length) throw new Error('消息为空');
    var firstUser = null;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i] && messages[i].role === 'user') {
        firstUser = messages[i];
        break;
      }
    }
    var titleSource = firstUser && typeof firstUser.content === 'string' ? firstUser.content : '';
    var title = titleSource.replace(/\s+/g, ' ').trim().slice(0, 20);

    var input = {};
    for (var kk in payload) {
      if (kk === 'sessionId' || kk === 'signal') continue;
      input[kk] = payload[kk];
    }
    var body = prepareBody(payload.model, input);
    var headers = chatHeaders(payload.sessionId || newSessionId(), uuid(), title);
    headers['content-type'] = 'application/json';
    headers.authorization = 'Bearer ' + auth.token;

    // ---- 单行 SSE 解析（两种通道共用）----
    var rawText = '';
    function feed(line) {
      var t = String(line == null ? '' : line).trim();
      if (!t) return;
      if (t.indexOf('data:') !== 0) {
        if (rawText.length < 2000) rawText += t;
        return;
      }
      var data = t.slice(5).trim();
      if (!data || data === '[DONE]') return;
      var frame;
      try {
        frame = JSON.parse(data);
      } catch (e) {
        return;
      }
      if (frame.error) {
        handlers.onDelta({ error: frame.error.message || '官方返回错误' });
        return;
      }
      // 用量统计（stream_options.include_usage 已在 prepareBody 打开）
      if (frame.usage && handlers.onUsage) handlers.onUsage(frame.usage);
      var choice = frame.choices && frame.choices[0];
      if (!choice) return;
      var delta = choice.delta || choice.message || {};
      if (typeof delta.content === 'string' && delta.content) handlers.onDelta({ content: delta.content });
      var rsn = delta.reasoning_content || delta.reasoning;
      if (typeof rsn === 'string' && rsn) handlers.onDelta({ reasoning: rsn });
    }

    function errMessage(status) {
      var msg = '对话请求失败（HTTP ' + status + '）';
      try {
        var j = JSON.parse(rawText);
        msg = j.message || j.msg || j.details || msg;
      } catch (e) {}
      return typeof msg === 'string' ? msg : '对话请求失败（HTTP ' + status + '）';
    }

    function checkStatus(status) {
      if (status === 401 || status === 403) {
        clearAuth();
        throw authError('登录已失效，请重新登录');
      }
      if (status >= 400) throw new Error(errMessage(status));
    }

    // ---- 通道一：原生 HTTP（App 内首选，不受 CORS 约束）----
    var nat = global.RaccoonNative;
    if (nat && nat.available()) {
      var st = 0;
      try {
        st = await nat.stream({
          url: UPSTREAM + '/api/web/llm/v2/chat/completions',
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          onLine: feed,
          signal: payload.signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // 连响应头都没拿到：可能是插件没注册上，退回浏览器通道再试一次
        if (!st) return fetchChat();
        throw new Error(e && e.message ? e.message : '对话中断');
      }
      checkStatus(st);
      if (handlers.onDone) handlers.onDone();
      return;
    }

    // ---- 通道二：浏览器 fetch（Web 版 / 原生通道缺失时）----
    async function fetchChat() {
      var req = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: payload.signal,
      };
      var res;
      try {
        res = await fetch(UPSTREAM + '/api/web/llm/v2/chat/completions', { ...req, credentials: 'include' });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        // 有的 WebView 对带 cookie 的跨域 POST 更严格，去掉 credentials 再试一次
        try {
          res = await fetch(UPSTREAM + '/api/web/llm/v2/chat/completions', { ...req, credentials: 'omit' });
        } catch (e2) {
          if (e2 && e2.name === 'AbortError') throw e2;
          throw netError('连不上官方服务，请检查网络');
        }
      }

      if (res.status === 401 || res.status === 403) {
        clearAuth();
        throw authError('登录已失效，请重新登录');
      }
      if (!res.ok) {
        try {
          rawText = await res.text();
        } catch (e) {}
        throw new Error(errMessage(res.status));
      }
      if (!res.body) throw new Error('当前环境不支持流式响应');

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buffer += decoder.decode(step.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (var n = 0; n < lines.length; n++) feed(lines[n]);
      }
      if (handlers.onDone) handlers.onDone();
    }

    return fetchChat();
  }

  // ---------- 连通性 ----------
  // 官方接口在没有 token 时会回 401/403，能拿到响应就说明网络通
  async function probe(timeoutMs) {
    var nat = global.RaccoonNative;
    if (nat && nat.available()) {
      var nr = await nat.probe(UPSTREAM + '/api/web/auth/v1/user_info');
      if (nr) return nr;
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, timeoutMs || 8000);
    var started = Date.now();
    try {
      var res = await fetch(UPSTREAM + '/api/web/auth/v1/user_info', {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined,
      });
      return { ok: true, status: res.status, ms: Date.now() - started };
    } catch (e) {
      return { ok: false, message: e && e.name === 'AbortError' ? '超时' : '网络不可达', ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- 兼容老调用 ----------
  // 旧版前端走 /api/xxx，这里做一层映射，页面代码不用大改
  async function handle(path, opts) {
    opts = opts || {};
    var body = opts.body || {};
    switch (path) {
      case '/api/login/config':
        return loginConfig();
      case '/api/login/sms/send':
        return sendSms(body);
      case '/api/login/sms/verify':
        return verifySms(body);
      case '/api/login/token':
        return loginByToken(body.token);
      case '/api/logout':
        return logout();
      case '/api/me':
        return me();
      case '/api/catalog':
        return catalog();
      case '/api/checkin':
        return checkin();
      case '/api/onboarding':
        return onboarding();
      default:
        throw new Error('不支持的接口：' + path);
    }
  }

  global.RaccoonDirect = {
    UPSTREAM: UPSTREAM,
    handle: handle,
    chat: chat,
    probe: probe,
    encryptPhone: encryptPhone,
    newSessionId: newSessionId,
    hasAuth: hasAuth,
    getAuth: getAuth,
    clearAuth: clearAuth,
    loginConfig: loginConfig,
    sendSms: sendSms,
    verifySms: verifySms,
    loginByToken: loginByToken,
    me: me,
    catalog: catalog,
    logout: logout,
  };
})(typeof window !== 'undefined' ? window : globalThis);
