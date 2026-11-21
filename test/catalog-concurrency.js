'use strict';

/**
 * P0-2 模型目录加载并发测试（真实加载 public/js/api.js）
 *
 * 用 Node vm 在受控环境中加载真实 api.js，mock RC / RaccoonDirect.handle，
 * 用可控 deferred 控制网络返回顺序，验证请求去重、版本隔离、超时、取消、
 * 缓存与账号隔离（C1–C34 中可在 api 层验证的断言）。
 *
 * 运行：npm test（包含本文件）
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function makeEnv() {
  const env = {
    state: { prefs: { model: '' }, models: [] },
    paintCalls: 0,
    savedPrefs: 0,
  };

  const pending = [];
  const controllers = [];  // 记录网络请求的 AbortSignal（C25 用）

  const RC = {
    state: env.state,
    K: { proxy: 'raccoon.proxy.v2' },
    lsGet: () => '',
    lsSet: () => {},
    lsDel: () => {},
    savePrefs: () => { env.savedPrefs++; },
    paintModelBar: () => { env.paintCalls++; },
    onAuthLost: () => {},
  };

  const context = {
    RC,
    RaccoonDirect: {
      handle: (p, opts) => {
        const d = deferred();
        pending.push({ d, opts, path: p });
        controllers.push({ signal: opts && opts.signal });
        return d.promise;
      },
    },
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    Promise,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(API_SRC, context, { filename: 'api.js' });

  return { RC, env, pending, controllers };
}

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push({ name, ok: true }); })
    .catch((e) => { results.push({ name, ok: false, err: e }); });
}

async function main() {
  // N3：缓存恢复无持久化副作用（真实 api.js）
  await check('N3 缓存恢复无持久化副作用', async () => {
    const { RC, env, pending } = makeEnv();

    // ① 通过真实 loadCatalog 建立缓存
    RC.beginAccountContext('u1');
    const p1 = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [{ name: 'm1' }] });
    await p1;

    // ② 改变用户偏好（不在缓存列表中）
    RC.state.prefs.model = 'm-preferred';
    const savePrefsBefore = env.savedPrefs;
    const paintBefore = env.paintCalls;

    // ③ 结束并重新建立同一账号上下文（触发缓存恢复）
    RC.endAccountContext();
    RC.beginAccountContext('u1');

    // ④ 断言：缓存恢复但无持久化副作用
    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'm1', '模型应恢复');
    assert.strictEqual(RC.state.prefs.model, 'm-preferred', '用户偏好不应改变');
    assert.strictEqual(env.savedPrefs, savePrefsBefore, 'savePrefs 不应被调用');
    assert.ok(env.paintCalls > paintBefore, '模型栏应刷新');
  });

  // C25：同账号幂等 + AbortSignal 未取消 + savePrefs spy
  await check('C25 同账号幂等不重置', async () => {
    const { RC, env, pending, controllers } = makeEnv();

    RC.beginAccountContext('u1');
    const p1 = RC.loadCatalog();
    const pendingBefore = pending.length;
    const ctrl = controllers[0];
    const savePrefsBefore = env.savedPrefs;

    // 重复建立同账号上下文（幂等，应跳过）
    RC.beginAccountContext('u1');

    // 断言无新请求、原请求 signal 未 abort
    assert.strictEqual(pending.length, pendingBefore, '不应创建新请求');
    assert.ok(ctrl.signal, '应捕获到 AbortSignal');
    assert.strictEqual(ctrl.signal.aborted, false, 'signal 不应被 abort');

    // 原请求正常完成（模型 ID 与当前偏好一致，避免默认选择污染 savePrefs 计数）
    RC.state.prefs.model = 'm';
    pending[0].d.resolve({ ok: true, models: [{ name: 'm' }] });
    const r = await p1;
    assert.strictEqual(r.ok, true);
    assert.strictEqual(RC.getModels().map((x) => x.id).join(','), 'm');
    assert.strictEqual(env.savedPrefs, savePrefsBefore, '重复幂等不应触发偏好保存');
  });

  // C21：无有效账号上下文不发起请求
  await check('C21 无账号不发起请求', async () => {
    const { RC, pending } = makeEnv();
    const r = await RC.loadCatalog();
    assert.strictEqual(r.reason, 'no_account');
    assert.strictEqual(pending.length, 0);
  });

  // C1/C15：普通加载并发复用同一个 Promise
  await check('C1/C15 普通加载复用同一 Promise', async () => {
    const { RC } = makeEnv();
    RC.beginAccountContext('u1');
    const a = RC.loadCatalog();
    const b = RC.loadCatalog();
    assert.strictEqual(a, b, '两次普通加载应返回同一个 Promise 对象');
  });

  // C28：连续两次主动刷新复用同一 Promise
  await check('C28 连续主动刷新复用同一 Promise', async () => {
    const { RC } = makeEnv();
    RC.beginAccountContext('u1');
    const a = RC.loadCatalog({ refresh: true });
    const b = RC.loadCatalog({ refresh: true });
    assert.strictEqual(a, b, '连续刷新应返回同一个 Promise 对象');
  });

  // C26：主动刷新替换普通请求，旧 Promise 立即结算为 stale
  await check('C26 刷新替换普通请求，旧 Promise 立即 stale', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const a = RC.loadCatalog();               // 普通
    const b = RC.loadCatalog({ refresh: true }); // 替换
    assert.notStrictEqual(a, b);
    const ra = await a; // 应在微任务中拿到 stale，不依赖网络
    assert.strictEqual(ra.reason, 'stale');
    assert.strictEqual(pending.length, 2);
  });

  // C3/C11：A 慢 B 快，A 迟到不覆盖 B；旧 finally 不清新登记
  await check('C3 迟到结果不覆盖新请求', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const a = RC.loadCatalog();
    const b = RC.loadCatalog({ refresh: true });

    pending[1].d.resolve({ ok: true, models: [{ name: 'm-b' }] });
    const rb = await b;
    assert.strictEqual(rb.ok, true);

    // A 迟到返回
    pending[0].d.resolve({ ok: true, models: [{ name: 'm-a' }] });
    const ra = await a;
    assert.strictEqual(ra.reason, 'stale');

    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'm-b');
  });

  // C5/C19：请求未完成时结束上下文，不写共享状态
  await check('C5 结束上下文后旧请求不写入', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p = RC.loadCatalog();
    RC.endAccountContext();
    pending[0].d.resolve({ ok: true, models: [{ name: 'x' }] });
    const r = await p;
    assert.strictEqual(r.reason, 'stale');
    assert.strictEqual(RC.getModels().length, 0);
  });

  // C6：A 未完成时切到 B，A 结果不写入 B
  await check('C6 跨账号不污染', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('uA');
    const pa = RC.loadCatalog();
    RC.beginAccountContext('uB');
    const pb = RC.loadCatalog();

    pending[1].d.resolve({ ok: true, models: [{ name: 'b' }] });
    await pb;
    pending[0].d.resolve({ ok: true, models: [{ name: 'a' }] });
    await pa;

    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'b');
  });

  // C7：同账号退出后重登，旧会话请求不污染新会话
  await check('C7 同账号重登隔离', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p1 = RC.loadCatalog();
    RC.endAccountContext();
    RC.beginAccountContext('u1');
    const p2 = RC.loadCatalog();

    pending[1].d.resolve({ ok: true, models: [{ name: 'new' }] });
    await p2;
    pending[0].d.resolve({ ok: true, models: [{ name: 'old' }] });
    await p1;

    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'new');
  });

  // C8：刷新失败保留已有模型
  await check('C8 刷新失败保留已有模型', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p1 = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [{ name: 'm1' }] });
    await p1;

    const p2 = RC.loadCatalog({ refresh: true });
    pending[1].d.resolve({ ok: false, message: 'boom' });
    const r2 = await p2;
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'm1');
  });

  // C9：合法空数组视为成功
  await check('C9 空数组合法成功', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [] });
    const r = await p;
    assert.strictEqual(r.ok, true);
    assert.strictEqual(RC.getModels().length, 0);
    assert.strictEqual(RC.getCatalogStatus(), 'idle');
  });

  // C10：非法数据不破坏已有模型
  await check('C10 非法数据不破坏已有模型', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p1 = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [{ name: 'm1' }] });
    await p1;

    const p2 = RC.loadCatalog({ refresh: true });
    pending[1].d.resolve({ ok: true, models: 'not-array' });
    const r2 = await p2;
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'm1');
  });

  // C14：合法空数组可作为有效缓存恢复
  await check('C14 空数组有效缓存', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p1 = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [] });
    await p1;

    const p2 = RC.loadCatalog({ refresh: true });
    pending[1].d.resolve({ ok: false });
    await p2;
    assert.strictEqual(RC.getCatalogStatus(), 'idle', '有有效缓存时状态应为 idle');
  });

  // C20：切到 B 且 B 未加载前不显示 A 模型
  await check('C20 切账号先清空旧模型', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('uA');
    const pa = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [{ name: 'a' }] });
    await pa;
    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'a');

    RC.beginAccountContext('uB');
    assert.strictEqual(RC.getModels().length, 0, 'B 无缓存时应清空 A 模型');
  });

  // C24：缓存恢复后仍会发起网络刷新
  await check('C24 缓存恢复后仍发起刷新', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('uA');
    const p1 = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [{ name: 'm1' }] });
    await p1;

    RC.endAccountContext();
    RC.beginAccountContext('uA'); // 同账号重登，恢复缓存
    assert.strictEqual(RC.getModels().map((m) => m.id).join(','), 'm1');

    const before = pending.length;
    RC.loadCatalog();
    assert.strictEqual(pending.length, before + 1, '恢复缓存后仍应发起网络刷新');
  });

  // C30：缓存恢复/登出时模型栏同步刷新
  await check('C30 模型栏同步刷新', async () => {
    const { RC, env } = makeEnv();
    const base = env.paintCalls;
    RC.beginAccountContext('u1');
    assert.ok(env.paintCalls > base, 'beginAccountContext 应刷新模型栏');

    const before = env.paintCalls;
    RC.endAccountContext();
    assert.ok(env.paintCalls > before, 'endAccountContext 应刷新模型栏');
  });

  // C16：所有路径只结算一次（同一 Promise 多次 await 结果一致）
  await check('C16 只结算一次', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const p = RC.loadCatalog();
    pending[0].d.resolve({ ok: true, models: [{ name: 'm' }] });
    const r1 = await p;
    const r2 = await p;
    assert.strictEqual(r1, r2, '同一 Promise 的两次 await 应得到同一结果对象');
  });

  // C17/C18：迟到成功/失败均不改新请求 loading 状态
  await check('C17/C18 迟到结果不改新请求状态', async () => {
    const { RC, pending } = makeEnv();
    RC.beginAccountContext('u1');
    const a = RC.loadCatalog();
    const b = RC.loadCatalog({ refresh: true });

    // A 迟到成功
    pending[0].d.resolve({ ok: true, models: [{ name: 'a' }] });
    await a;
    assert.strictEqual(RC.getCatalogStatus(), 'loading', 'B 仍在加载，状态应保持 loading');

    pending[1].d.resolve({ ok: true, models: [{ name: 'b' }] });
    await b;
    assert.strictEqual(RC.getCatalogStatus(), 'idle');
  });

  // C29：超时后状态不残留 loading，后续请求可立即开始（真实 8s 超时）
  await check('C29 超时状态闭环（约 8s）', async () => {
    const { RC } = makeEnv();
    RC.beginAccountContext('u1');
    const p = RC.loadCatalog();
    const started = Date.now();
    const r = await p;
    const elapsed = Date.now() - started;
    assert.strictEqual(r.reason, 'timeout');
    assert.ok(elapsed >= 7500, '应发生超时');
    assert.notStrictEqual(RC.getCatalogStatus(), 'loading');

    // 超时后可以立即开始新请求
    const p2 = RC.loadCatalog();
    assert.ok(p2 && typeof p2.then === 'function');
  });

  // 输出
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log('  ✓ ' + r.name);
    } else {
      failed++;
      console.log('  ✗ ' + r.name);
      console.log('    ' + (r.err && r.err.message));
    }
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' 通过');
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
