'use strict';

/**
 * 通用工具：响应、请求体、编码、ID。
 */

const crypto = require('crypto');
const config = require('./config');

// ---------- HTTP ----------
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

function sendText(res, text, status = 200) {
  if (res.headersSent) return res.end();
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function badRequest(res, message) {
  return sendJSON(res, { ok: false, message: message || '请求不合法' }, 400);
}

/**
 * 读取并解析 JSON 请求体。超限抛 413，非法 JSON 抛 400。
 */
function readBody(req, limit) {
  const max = limit || config.MAX_BODY;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        const err = new Error('请求体过大');
        err.statusCode = 413;
        reject(err);
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
        const err = new Error('请求体不是合法 JSON');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

// ---------- 编码 ----------
function b64urlDecode(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
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
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function uuidV4() {
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

function uuidLike(seed) {
  const s = String(seed);
  return (
    s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' +
    s.slice(17, 20) + '-' + s.slice(20, 32)
  );
}

// 头部只能放 ASCII，中文按 UTF-8 百分号编码
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

// ---------- 手机号 ----------
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

function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

module.exports = {
  sendJSON, sendText, badRequest, readBody,
  b64urlDecode, decodeUID, sha256Hex, uuidV4, uuidLike, latinTitle,
  normalizePhone, normalizeNation, isValidPhone, maskPhone,
};
