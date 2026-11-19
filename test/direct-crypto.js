'use strict';

/**
 * 校验 App 内置的 AES-128-CFB 与 Node 的实现逐字节一致。
 * 这段逻辑直接决定上游能不能解开手机号，一旦算错，登录会以「phone invalid」失败，
 * 而且看不出是算法问题，所以单独拉出来在 CI 里跑。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const KEY = 'senseraccoon2023';
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'direct.js'), 'utf8');

const store = {};
const sandbox = {
  console,
  TextEncoder,
  Uint8Array,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  crypto: {
    getRandomValues: (b) => {
      crypto.randomFillSync(b);
      return b;
    },
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  fetch: () => Promise.reject(new Error('test 环境不发网络请求')),
  AbortController,
  AbortSignal,
  setTimeout,
  clearTimeout,
  Date,
  JSON,
  Math,
  String,
  Number,
  Array,
  Object,
  Promise,
  decodeURIComponent,
  encodeURIComponent,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const api = sandbox.RaccoonDirect;
if (!api || typeof api.encryptPhone !== 'function') {
  console.error('✗ direct.js 没有暴露 encryptPhone');
  process.exit(1);
}

function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 16);
  const ct = buf.subarray(16);
  const d = crypto.createDecipheriv('aes-128-cfb', Buffer.from(KEY, 'utf8'), iv);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('  ✓ ' + name);
  } else {
    fail += 1;
    console.log('  ✗ ' + name + (detail ? ' → ' + detail : ''));
  }
}

console.log('AES-128-CFB（App 端实现 vs Node 标准实现）：');

const samples = ['19267900461', '+8613800138000', '13800138000', '中文测试中文测试中文测试中文测试'];
for (const phone of samples) {
  let ok = true;
  let detail = '';
  for (let i = 0; i < 20; i += 1) {
    const enc = api.encryptPhone(phone);
    const dec = decrypt(enc);
    if (dec !== phone) {
      ok = false;
      detail = '解出 ' + JSON.stringify(dec);
      break;
    }
    if (Buffer.from(enc, 'base64').length !== 16 + Buffer.byteLength(phone, 'utf8')) {
      ok = false;
      detail = '密文长度不对';
      break;
    }
  }
  check('加密后可解回 ' + JSON.stringify(phone), ok, detail);
}

// 每次 IV 都不同，密文必须跟着变（CFB 是流模式，不能退化成固定输出）
const a = api.encryptPhone('19267900461');
const b = api.encryptPhone('19267900461');
check('每次 IV 随机（同号码两次密文不同）', a !== b);

console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
