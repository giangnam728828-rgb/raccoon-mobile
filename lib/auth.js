'use strict';

/**
 * 登录态：持久化 + 登录流程（短信 / Token）。
 *
 * 官方网页端拿到 IAM token 后还会调一次 iam/confirm 建立业务会话（种 cookie）。
 * 这里尽力而为：成功就存下来，后续请求一并带上。
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const util = require('./util');
const upstream = require('./upstream');

const AUTH_FILE = path.join(config.DATA_DIR, 'auth.json');

let auth = null;

function load() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (raw && typeof raw.token === 'string' && raw.token) auth = raw;
  } catch {
    auth = null;
  }
  return auth;
}

function current() {
  return auth;
}

function save() {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn('[auth] 登录态落盘失败:', e.message);
  }
}

function clear() {
  auth = null;
  try {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  } catch {}
}

async function confirmSession(token) {
  try {
    const r = await upstream.request('POST', '/api/web/auth/v1/iam/confirm', {
      token,
      body: {},
      timeout: 15000,
    });
    const setCookie = r.headers && r.headers['set-cookie'];
    return Array.isArray(setCookie)
      ? setCookie.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ')
      : '';
  } catch {
    return '';
  }
}

async function establish(token, extra) {
  const uid = util.decodeUID(token);
  auth = {
    token,
    refreshToken: (extra && extra.refreshToken) || '',
    officeIdentity: (extra && extra.officeIdentity) || '',
    uid,
    phone: (extra && extra.phone) || '',
    name: '',
    cookie: '',
    savedAt: Date.now(),
  };
  const cookie = await confirmSession(token);
  if (cookie) auth.cookie = cookie;
  save();
  return auth;
}

/**
 * 拉用户信息 + 积分余额。
 */
async function profile() {
  if (!auth) {
    const e = new Error('未登录');
    e.code = 'NO_AUTH';
    throw e;
  }
  const key = upstream.accountKey();
  const idn = upstream.identityFor(key);
  const headers = upstream.webHeaders(auth.token, idn);

  const [u, b] = await Promise.all([
    upstream.request('GET', '/api/web/auth/v1/user_info', {
      token: auth.token, headers, cookie: auth.cookie,
    }),
    upstream.request('GET', '/api/web/points/v1/balance', {
      token: auth.token, headers, cookie: auth.cookie,
    }).catch(() => null),
  ]);

  return { user: upstream.envelope(u), balance: b ? upstream.envelope(b) : null, status: u.status };
}

function pickPoints(balance) {
  const d = (balance && balance.data) || {};
  const cands = [d.points, d.total, d.balance, d.available, d.remain, d.left_points];
  for (const v of cands) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

function maskPhone(p) {
  return util.maskPhone(p);
}

module.exports = {
  load, current, save, clear, establish, profile, confirmSession, pickPoints, maskPhone,
  get token() { return auth && auth.token; },
};
