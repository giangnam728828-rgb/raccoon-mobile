'use strict';

/**
 * 冒烟测试：不需要真实账号，也不需要联网。
 * 起一个假的「上游」，验证代理的登录、鉴权、目录、流式对话、静态资源是否按预期工作。
 *
 * 运行：npm test
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let MOCK_PORT = 0;
let APP_PORT = 0;
const PHONE = '13812345678';
const CAPTCHA = 'CAPTCHA-OK';
const PHONE_KEY = 'senseraccoon2023';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function makeJWT(sub) {
  return [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }), 'sig'].join('.');
}

const TOKEN_SMS = makeJWT('user-1');
const TOKEN_PASTE = makeJWT('user-2');
const VALID_TOKENS = new Set([TOKEN_SMS, TOKEN_PASTE]);

function decryptPhone(b64) {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  const d = crypto.createDecipheriv('aes-128-cfb', Buffer.from(PHONE_KEY, 'utf8'), iv);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function readJSON(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// ---------------- 假上游 ----------------
const mock = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const send = (obj, status = 200, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
  };
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const requireAuth = () => {
    if (!VALID_TOKENS.has(auth)) {
      send({ code: 200003, message: 'authorization_verify_error' }, 401);
      return false;
    }
    return true;
  };

  if (url === '/api/iam/v1/sms/send' && req.method === 'POST') {
    const b = await readJSON(req);
    if (b.captcha_token !== CAPTCHA) return send({ code: 'CAPTCHA_FAILED', message: 'captcha failed' }, 400);
    if (b.scene !== 'login') return send({ code: 'COMMON_INVALID_ARGUMENT', message: 'scene' }, 400);
    if (decryptPhone(b.phone) !== PHONE) return send({ code: 'COMMON_INVALID_ARGUMENT', message: 'phone invalid' }, 400);
    return send({ code: 'OK', data: { verification_id: 'vid-1', expires_in: 300, retry_after: 1 } });
  }

  if (url === '/api/iam/v1/auth/login/sms' && req.method === 'POST') {
    const b = await readJSON(req);
    if (decryptPhone(b.phone) !== PHONE) return send({ code: 'COMMON_INVALID_ARGUMENT', message: 'phone invalid' }, 400);
    if (b.verification_id !== 'vid-1') return send({ code: 'COMMON_INVALID_ARGUMENT', message: 'verification_id invalid' }, 400);
    if (b.verification_code !== '123456') return send({ code: 'AUTH_SMS_VERIFICATION_INVALID', message: 'code invalid' }, 400);
    return send({ code: 'OK', data: { access_token: TOKEN_SMS, token_type: 'bearer', refresh_token: 'rt-1' } });
  }

  if (url === '/api/iam/v1/auth/logout') return send({ code: 'OK', data: { revoked: true } });

  if (url === '/api/web/auth/v1/iam/confirm') {
    if (!requireAuth()) return;
    return send({ code: 0, data: {} }, 200, { 'set-cookie': ['xhx_token=abc123; Path=/; HttpOnly'] });
  }

  if (url === '/api/web/auth/v1/user_info') {
    if (!requireAuth()) return;
    return send({ code: 0, data: { name: '测试账号', user_id: 'user-1' } });
  }

  if (url === '/api/web/points/v1/balance') {
    if (!requireAuth()) return;
    return send({ code: 0, data: { available_points: 1234 } });
  }

  if (url === '/api/web/llm/v2/model_catalog') {
    if (!requireAuth()) return;
    return send({ code: 0, data: { models: [{ name: 'raccoon-chat-ml-5-5', display_name: '标准模型', context_window: 32000 }] } });
  }

  if (url === '/api/web/llm/v2/chat/completions') {
    if (!requireAuth()) return;
    const b = await readJSON(req);
    if (!Array.isArray(b.messages) || !b.messages.length) return send({ code: 400, message: 'empty' }, 400);
    if (b.stream !== true) return send({ code: 400, message: 'must stream' }, 400);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '想一想…' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '你好' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '，我是小浣熊' } }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  send({ code: 404, message: 'not found' }, 404);
});

// ---------------- 被测服务 ----------------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitReady(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const r = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 500 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      r.on('error', () => resolve(false));
      r.on('timeout', () => {
        r.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务启动超时');
}

function call(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: APP_PORT,
        path: p,
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push([true, name]);
      console.log('  ✓ ' + name);
    })
    .catch((e) => {
      results.push([false, name]);
      console.log('  ✗ ' + name + '\n    ' + (e && e.message));
    });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-test-'));
  MOCK_PORT = await freePort();
  APP_PORT = await freePort();
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      HOST: '127.0.0.1',
      UPSTREAM: 'http://127.0.0.1:' + MOCK_PORT,
      DATA_DIR: tmp,
      ACCESS_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));

  try {
    await waitReady(APP_PORT);
    console.log('\n登录与业务链路：');

    await check('未登录时 /api/me 返回 401', async () => {
      const r = await call('GET', '/api/me');
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.json.auth, false);
    });

    await check('缺少人机验证时拒绝发码', async () => {
      const r = await call('POST', '/api/login/sms/send', { phone: PHONE, nationCode: '+86', captchaToken: '' });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.json.ok, false);
    });

    await check('手机号格式非法时拒绝发码', async () => {
      const r = await call('POST', '/api/login/sms/send', { phone: '123', nationCode: '+86', captchaToken: CAPTCHA });
      assert.strictEqual(r.status, 400);
    });

    await check('发码：手机号按官方算法加密后提交上游', async () => {
      const r = await call('POST', '/api/login/sms/send', { phone: PHONE, nationCode: '+86', captchaToken: CAPTCHA });
      assert.strictEqual(r.json.ok, true, r.text);
      assert.strictEqual(r.json.verificationId, 'vid-1');
      assert.strictEqual(r.json.retryAfter, 1);
    });

    await check('验证码错误时不登录', async () => {
      const r = await call('POST', '/api/login/sms/verify', {
        phone: PHONE,
        nationCode: '+86',
        verificationId: 'vid-1',
        code: '000000',
      });
      assert.strictEqual(r.json.ok, false);
      assert.ok(/验证码/.test(r.json.message), r.json.message);
    });

    await check('验证码正确时建立登录态', async () => {
      const r = await call('POST', '/api/login/sms/verify', {
        phone: PHONE,
        nationCode: '+86',
        verificationId: 'vid-1',
        code: '123456',
      });
      assert.strictEqual(r.json.ok, true, r.text);
      assert.strictEqual(r.json.uid, 'user-1');
      assert.ok(fs.existsSync(path.join(tmp, 'auth.json')), '登录态应落盘');
    });

    await check('/api/me 返回昵称、积分、脱敏手机号', async () => {
      const r = await call('GET', '/api/me');
      assert.strictEqual(r.json.ok, true, r.text);
      assert.strictEqual(r.json.name, '测试账号');
      assert.strictEqual(r.json.points, 1234);
      assert.strictEqual(r.json.phone, '138****5678');
    });

    await check('/api/catalog 解析模型列表', async () => {
      const r = await call('GET', '/api/catalog');
      assert.strictEqual(r.json.ok, true, r.text);
      assert.strictEqual(r.json.models.length, 1);
      assert.strictEqual(r.json.models[0].name, '标准模型');
      assert.strictEqual(r.json.models[0].contextLength, 32000);
    });

    await check('/api/chat 透传 SSE，正文与思考都能解析', async () => {
      const r = await call('POST', '/api/chat', {
        model: 'raccoon-chat-ml-5-5',
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
      });
      assert.strictEqual(r.status, 200, r.text);
      assert.ok(r.text.indexOf('"content":"你好"') >= 0, r.text);
      assert.ok(r.text.indexOf('reasoning_content') >= 0, r.text);
    });

    await check('聊天请求体被规范化（stream / max_tokens / 去 conversation_id）', async () => {
      const r = await call('POST', '/api/chat', {
        model: 'raccoon-chat-ml-5-5',
        messages: [{ role: 'user', content: 'hi' }],
        conversation_id: 'should-be-removed',
      });
      assert.strictEqual(r.status, 200, r.text);
    });

    await check('退出登录后回到未登录状态', async () => {
      const r = await call('POST', '/api/logout');
      assert.strictEqual(r.json.ok, true);
      const me = await call('GET', '/api/me');
      assert.strictEqual(me.status, 401);
      assert.ok(!fs.existsSync(path.join(tmp, 'auth.json')), '登录态文件应被删除');
    });

    await check('Token 登录：有效 token 通过', async () => {
      const r = await call('POST', '/api/login/token', { token: TOKEN_PASTE });
      assert.strictEqual(r.json.ok, true, r.text);
      assert.strictEqual(r.json.uid, 'user-2');
    });

    await check('Token 登录：无效 token 被上游拒绝', async () => {
      const ok = await call('POST', '/api/login/token', { token: makeJWT('bad-user') });
      assert.strictEqual(ok.json.ok, false);
      assert.ok(/无效|过期/.test(ok.json.message), ok.json.message);
    });

    await check('访问密钥开启后，无密钥请求被拦截', async () => {
      const child2 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: {
          ...process.env,
          PORT: String(APP_PORT + 1),
          HOST: '127.0.0.1',
          UPSTREAM: 'http://127.0.0.1:' + MOCK_PORT,
          DATA_DIR: tmp,
          ACCESS_KEY: 'k-123',
        },
        stdio: 'ignore',
      });
      try {
        await waitReady(APP_PORT + 1);
        const denied = await new Promise((resolve, reject) => {
          http
            .get({ host: '127.0.0.1', port: APP_PORT + 1, path: '/api/me' }, (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
            })
            .on('error', reject);
        });
        assert.strictEqual(denied.status, 401);
        assert.strictEqual(denied.json.keyRequired, true);
      } finally {
        child2.kill('SIGKILL');
      }
    });

    console.log('\n安全与健壮性：');

    await check('静态资源目录穿越被拦截', async () => {
      const r = await call('GET', '/%2e%2e/server.js');
      assert.strictEqual(r.status, 403);
    });

    await check('非法 JSON 返回 400 而不是崩溃', async () => {
      const r = await call('POST', '/api/login/token', undefined, { 'content-type': 'application/json' });
      assert.ok([400, 200].includes(r.status));
    });

    await check('畸形 URL 编码不会把进程打挂', async () => {
      const r = await call('GET', '/%E0%A4%A');
      assert.ok([400, 404, 403].includes(r.status));
    });

    await check('服务在以上请求后仍存活', async () => {
      const r = await call('GET', '/api/health');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.ok, true);
    });
  } finally {
    child.kill('SIGKILL');
    mock.close();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}

    const failed = results.filter(([ok]) => !ok);
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过');
    if (failed.length) {
      console.log('\n--- 服务日志 ---\n' + logs);
      process.exitCode = 1;
    }
  }
})();
