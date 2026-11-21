'use strict';

/**
 * P0-2 身份确认代次保护测试（P0-2 v3.20 方案）
 *
 * 使用 Node vm 加载真实 public/js/api.js 与真实 public/js/app.js，
 * 在内存中做受控源码注入（不写回生产文件），建立 RC.__testApi 与 RC.__test.app
 * 两个隔离的测试命名空间，验证 C31/C36/C38/C39/C40/C41/C42。
 *
 * 关键原则：
 * - 不复制生产函数到测试文件；测试执行的是注入后的真实生产代码。
 * - 注入锚点唯一性校验；生产文件零修改。
 * - 四类资源（deferred / 生产 Promise / 后台异步链 / VM timer）分别追踪。
 *
 * 运行：npm test（包含本文件）
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// v3.23: 不再注册全局 unhandledRejection 空监听（会吞掉所有测试异常）。
// C38 通过 initPromise 同 tick 双分支接管（.then(onFulfilled, onRejected)）即时安装 handler。

const API_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

// 注入锚点（唯一性已核实）
const API_ANCHOR = '    beginAccountContext, endAccountContext, getModels, getCatalogStatus, currentAccountId,';
const APP_ANCHOR = '    refreshMe, init,\n  });';

function assertOnce(src, anchor, label) {
  const count = src.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`${label} 注入锚点应恰好出现 1 次，实际 ${count} 次`);
  }
}

// ---------- 工具 ----------
function makeDeferred(env, key, options) {
  const opts = options || {};
  let resolvePromise, rejectPromise;
  const d = {
    state: 'pending',
    promise: null,
    key: key,
    // v3.20: 默认 false，只有显式声明 true 才允许 cleanup 自动释放
    safeToResolve: opts.safeToResolve === true,
  };
  d.promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  d.promise.catch(() => {}); // 立即安装 rejection handler
  d.resolve = (v) => {
    if (d.state !== 'pending') return;
    d.state = 'resolved';
    resolvePromise(v);
  };
  d.reject = (e) => {
    if (d.state !== 'pending') return;
    d.state = 'rejected';
    rejectPromise(e);
  };
  if (env) env.deferreds.set(key, d);
  return d;
}

function withBoundedWait(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 等待超时(${ms}ms)，无法推断结算状态`)),
      ms
    );
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function collectCleanupError(errors, label, task) {
  try {
    await task();
  } catch (e) {
    errors.push(new Error(`${label}: ${e.message}`));
  }
}

async function waitUntil(predicate, label, timeoutMs, stepMs) {
  const limit = timeoutMs || 2000;
  const step = stepMs || 5;
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > limit) {
      throw new Error(`waitUntil 超时: ${label}`);
    }
    await new Promise((r) => setTimeout(r, step));
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function createStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// ---------- 测试环境 ----------
function createTestEnv() {
  const env = {
    deferreds: new Map(),
    timers: [],
    timerSeq: 0,
    meCallCount: 0,
    meDeferred: null,
    loginConfigDeferred: null,
    catalogCalls: [],
    storage: createStorage(),
    // catalogNet 延迟创建（v3.18）
    catalogNet: null,
  };

  // 受控 timer（统一 env.timers）
  function controlledSetTimeout(cb, ms) {
    const id = ++env.timerSeq;
    env.timers.push({ id, cb, ms, state: 'pending' });
    return id;
  }
  function controlledClearTimeout(id) {
    const t = env.timers.find((x) => x.id === id);
    if (t) t.state = 'cleared';
  }
  // 暴露给 cleanup，让清理使用注入的 clearTimeout（而非直接改状态）
  env.clearTimeout = controlledClearTimeout;
  env.fireTimer = function (id) {
    const t = env.timers.find((x) => x.id === id);
    if (!t || t.state !== 'pending') return undefined;
    t.state = 'fired';
    return t.cb();
  };
  env.findTimer = function (ms) {
    return env.timers.find((t) => t.ms === ms && t.state === 'pending');
  };

  // catalogNet 观察接口（延迟创建 + 真实状态迁移 + AbortError 分类）
  env.getCatalogNetState = function () {
    return env.catalogNet ? env.catalogNet.state : 'not-created';
  };
  env.getCatalogNetPromise = function () {
    return env.catalogNet ? env.catalogNet.promise : null;
  };
  function ensureCatalogNet() {
    if (env.catalogNet) return env.catalogNet;
    const net = { state: 'pending', promise: null, reject: null };
    net.promise = new Promise((resolve, reject) => { net.reject = reject; });
    // 状态由真实 Promise 结算驱动；区分 AbortError 与其他异常
    net.promise.then(
      () => { net.state = 'resolved'; },
      (e) => { net.state = (e && e.name === 'AbortError') ? 'aborted' : 'failed'; }
    );
    env.catalogNet = net;
    return net;
  }

  // RC mock（Proxy 兜底未定义方法为 no-op）
  const baseRC = {
    state: {
      prefs: { model: '' }, models: [], chats: [], chatId: '', messages: [],
      loggedIn: false, uid: '', name: '', phone: '', points: 0, meOK: false,
    },
    K: { proxy: 'raccoon.proxy.v2' },
    $: (id) => ({
      value: '',
      disabled: false,
      textContent: '',
      innerHTML: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild() {},
      removeChild() {},
      setAttribute() {},
      getAttribute() { return null; },
      focus() {},
      blur() {},
      click() {},
      closest() { return null; },
      scrollIntoView() {},
      getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    }),
    $$: () => [],
    el: () => ({}),
    icon: () => ({}),
    lsGet: (k, d) => {
      const v = env.storage.getItem(k);
      return v !== null ? v : d;
    },
    lsSet: (k, v) => { env.storage.setItem(k, v); },
    lsDel: (k) => { env.storage.removeItem(k); },
    savePrefs: () => {},
    paintModelBar: () => {},
    renderMe: () => {},
    renderThread: () => {},
    renderHistory: () => {},
    renderNations: () => {},
    renderDrafts: () => {},
    setTab: () => {},
    showView: () => {},
    hideLogin: () => {},
    showLogin: () => { env.showLoginCalls++; },
    // v3.23: 六个实测缺失依赖显式登记（禁止 no-op 兜底后必须登记）
    PANES_VALID: ['chat', 'history', 'files', 'device', 'me'],
    applyFontScale() {},
    applyTheme() {},
    loadPrefs() {},
    loadPrompts() {},
    loadChats: () => {},
    toast: () => {},
    stopSpeak: () => {},
    stopStreaming: () => {},
    clearAllSheets: () => {},
    closeAllSheets: () => {},
    closeTopSheet: () => false,
    autoGrow: () => {},
    updateSend: () => {},
    bind() {},
    bindSheets() {},
    bindScroll() {},
    bindScrollShade() {},
    bindComposer() {},
    bindImageZoom() {},
    bindMe() {},
    bindPrompts() {},
    bindModules() {},
    debounce: (fn) => fn,
    onAuthLost() {},
    logoutRemote() {},
    checkDeviceSupport() {},
    bindDeviceSheet() {},
    bindMeRows() {},
    probeProxy: () => Promise.resolve({ ok: true }),
    me: () => env.meDeferred ? env.meDeferred.promise : Promise.resolve({ ok: false }),
    loginConfig: () => env.loginConfigDeferred ? env.loginConfigDeferred.promise : Promise.resolve({ ok: true }),
  };
  env.showLoginCalls = 0;

  const RC = new Proxy(baseRC, {
    get(target, prop, receiver) {
      // v3.23: Symbol 属性一律交给 Reflect.get（含已存在于 target 的）
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      // 已登记字符串属性
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // 测试命名空间约定（__ 前缀）
      if (prop.indexOf('__') === 0) return undefined;
      // v3.23: 严格——未登记字符串属性立即报错，禁止 no-op 兜底
      throw new Error(`RC.${prop} 未在测试环境登记（禁止 no-op 兜底）`);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });

  // global / window（app.js IIFE 参数是 window）
  const raccoonDirect = {
    hasAuth: () => (env.hasAuthValue !== undefined ? env.hasAuthValue : true),
    clearAuth() {},
  };
  const win = {
    RC,
    RaccoonDirect: raccoonDirect,
    prompt: () => (env.promptValue !== undefined ? env.promptValue : 'http://127.0.0.1:8799'),
  };

  const context = {
    RC,
    window: win,
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: baseRC.$,
      createElement: () => ({
        value: '', textContent: '', setAttribute() {}, appendChild() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      }),
    },
    localStorage: env.storage,
    setTimeout: controlledSetTimeout,
    clearTimeout: controlledClearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    console,
    Promise, AbortController, Math, Date, JSON, RegExp, Set, Map,
  };
  context.global = context;

  vm.createContext(context);

  // 1) api.js 注入（命名空间 __testApi）
  assertOnce(API_SRC, API_ANCHOR, 'api.js');
  const apiInjected = API_SRC.replace(
    API_ANCHOR,
    API_ANCHOR + `
    __testApi: {
      cancelActiveCatalog: function () {
        if (__catalogState.activeRequest) {
          invalidateRequest(__catalogState.activeRequest, 'test-cleanup');
          __catalogState.activeRequest = null;
          return true;
        }
        return false;
      },
      hasActiveCatalog: function () {
        return !!__catalogState.activeRequest && __catalogState.activeRequest.isValidating;
      },
      getCatalogStatus: function () { return __catalogState.status; },
    },`
  );
  vm.runInContext(apiInjected, context, { filename: 'api.js(injected)' });

  // 2) RaccoonDirect.handle：/api/catalog
  // 默认立即返回成功（C31/C36/C39/C40/C41/C42 用，避免后台请求挂住 enterApp）
  // C38 通过 env.catalogNetHold=true 切换为可取消的挂起 Promise
  raccoonDirect.handle = function (path, opts) {
    if (path === '/api/catalog') {
      env.catalogCalls.push({ opts });
      if (env.catalogNetHold) {
        const net = ensureCatalogNet();
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', function () {
            if (net.state === 'pending') {
              const e = new Error('aborted');
              e.name = 'AbortError';
              net.reject(e);
            }
          });
        }
        return net.promise;
      }
      return Promise.resolve({ ok: true, models: [] });
    }
    return Promise.resolve({ ok: true, models: [] });
  };
  env.catalogNetHold = false;

  // 包装 loadCatalog 记录真实调用和 Promise（C38 证据）
  const realLoadCatalog = RC.loadCatalog;
  RC.loadCatalog = function (...args) {
    const p = realLoadCatalog.apply(this, args);
    env.catalogCalls[env.catalogCalls.length - 1] = Object.assign(
      env.catalogCalls[env.catalogCalls.length - 1] || {}, { promise: p }
    );
    return p;
  };

  // 3) app.js 注入（命名空间 __test.app + 词法包装）
  assertOnce(APP_SRC, APP_ANCHOR, 'app.js');
  const appInjected = APP_SRC.replace(
    APP_ANCHOR,
    APP_ANCHOR + `
    // ===== TEST ONLY (in-memory) =====
    const __origEnterApp = enterApp;
    const __enterAppCalls = [];
    enterApp = function () {
      const p = __origEnterApp.apply(this, arguments);
      __enterAppCalls.push(p);
      return p;
    };
    RC.enterApp = enterApp;

    const __origEnd = RC.endAccountContext;
    let __endCount = 0;
    RC.endAccountContext = function () {
      __endCount++;
      return __origEnd.apply(this, arguments);
    };

    const __origApplyMe = applyMe;
    const __applyMeCalls = [];
    applyMe = function (d) {
      __applyMeCalls.push({ uid: d && d.uid });
      return __origApplyMe.apply(this, arguments);
    };

    const __origReLogin = reLoginAfterChannelChange;
    const __reLoginCalls = [];
    reLoginAfterChannelChange = function () {
      __reLoginCalls.push({ started: true });
      return __origReLogin.apply(this, arguments);
    };

    const __origRefreshMe = refreshMe;
    let __refreshMeCalls = 0;
    let __thenCallbackDone = false;
    refreshMe = function () {
      const p = __origRefreshMe.apply(this, arguments);
      __refreshMeCalls++;
      p.then(() => { Promise.resolve().then(() => { __thenCallbackDone = true; }); });
      return p;
    };

    RC.__test = RC.__test || {};
    RC.__test.app = {
      onLoginSuccess: onLoginSuccess,
      getAuthFlowSeq: function () { return __authFlowSeq; },
      getInitStarted: function () { return __initStarted; },
      getEnterAppCalls: function () { return __enterAppCalls.slice(); },
      getEndCount: function () { return __endCount; },
      getReLoginCalls: function () { return __reLoginCalls.slice(); },
      getApplyMeCalls: function () { return __applyMeCalls.slice(); },
      getRefreshMeCalls: function () { return __refreshMeCalls; },
      getThenCallbackDone: function () { return __thenCallbackDone; },
    };`
  );
  vm.runInContext(appInjected, context, { filename: 'app.js(injected)' });

  // 4) 验证两个命名空间共存（加载顺序 api.js → app.js）
  if (typeof RC.__testApi !== 'object' || typeof RC.__testApi.cancelActiveCatalog !== 'function') {
    throw new Error('api 测试接口注入失败');
  }
  if (typeof RC.__test !== 'object' || typeof RC.__test.app !== 'object') {
    throw new Error('app 测试接口注入失败');
  }

  // 5) cleanup（四类资源；safeToResolve 默认 false）
  env.cleanup = async function (initPromise) {
    const errors = [];

    // ① deferred 逐个独立处理（一个失败不阻断后续）
    for (const [key, d] of env.deferreds) {
      try {
        if (d.state === 'pending') {
          if (d.safeToResolve) {
            d.resolve({ ok: false, reason: 'test-cleanup' });
          } else {
            errors.push(new Error(`deferred '${key}' pending 且未声明 safeToResolve`));
          }
        }
      } catch (e) {
        errors.push(new Error(`deferred '${key}': ${e.message}`));
      }
    }

    // ② initPromise 有界等待（独立收集）
    if (initPromise) {
      try {
        await withBoundedWait(initPromise.catch(() => {}), 2000, 'initPromise');
      } catch (e) {
        errors.push(new Error('initPromise 等待: ' + e.message));
      }
    }

    // ③ timer 逐个独立清理（一个失败不阻断后续，也不改变其他 timer 状态）
    for (const t of env.timers) {
      if (t.state !== 'pending') continue;
      try {
        env.clearTimeout(t.id);
      } catch (e) {
        errors.push(new Error(`timer '${t.id}' 清理失败: ${e.message}`));
      }
    }

    if (errors.length) {
      throw new Error('cleanup 错误: ' + errors.map((e) => e.message).join('; '));
    }
  };

  env.RC = RC;
  env.context = context;
  return env;
}

envTestEnvSanity();
function envTestEnvSanity() {
  // 无副作用：仅确认 createTestEnv 可构造（在测试前不触发）
}

// ---------- 测试块 ----------
const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push({ name, ok: true }),
    (e) => results.push({ name, ok: false, err: e.message })
  );
}

async function main() {
  // C31：A enterApp 晚于 B 登录（真实调用链）
  await check('C31 A enterApp 身份确认晚于 B 登录', async () => {
    const env = createTestEnv();
    // 加载顺序验证（api.js→app.js 后两命名空间共存）
    assert.strictEqual(typeof env.RC.__testApi.cancelActiveCatalog, 'function');
    assert.strictEqual(typeof env.RC.__test.app.getAuthFlowSeq, 'function');
    assert.strictEqual(env.RC.__test.app.getAuthFlowSeq(), 0);
    const dA = makeDeferred(env, 'me-A');
    const dB = makeDeferred(env, 'me-B');
    const meCallIdx = { n: 0 };
    env.RC.me = () => {
      const i = meCallIdx.n++;
      if (i === 0) return dA.promise;
      if (i === 1) return dB.promise;
      throw new Error('Unexpected RC.me call ' + i);
    };

    // A 通过 RC.enterApp() 启动（词法包装捕获）
    env.RC.enterApp();
    // B 通过真实 onLoginSuccess() 启动
    env.RC.__test.app.onLoginSuccess();
    await waitUntil(() => env.RC.__test.app.getEnterAppCalls().length >= 2, '两次 enterApp');

    // B 先完成
    dB.resolve({ ok: true, uid: 'B' });
    await env.RC.__test.app.getEnterAppCalls()[1];
    assert.strictEqual(env.RC.currentAccountId(), 'B', 'B 应建立上下文');

    // A 迟到
    dA.resolve({ ok: true, uid: 'A' });
    await env.RC.__test.app.getEnterAppCalls()[0];
    assert.strictEqual(env.RC.currentAccountId(), 'B', 'A 不得覆盖 B');
    assert.strictEqual(meCallIdx.n, 2, '应恰好两次身份确认');
    await env.cleanup();
  });

  // C36：冷启动 init 晚于交互登录（loginConfig 屏障）
  await check('C36 冷启动 init 的 me 晚于交互登录', async () => {
    const env = createTestEnv();
    const lcD = makeDeferred(env, 'loginConfig');
    const dInit = makeDeferred(env, 'me-init');
    const dLogin = makeDeferred(env, 'me-login');
    const meCallIdx = { n: 0 };
    env.RC.loginConfig = () => lcD.promise;
    env.RC.me = () => {
      const i = meCallIdx.n++;
      if (i === 0) return dInit.promise;
      if (i === 1) return dLogin.promise;
      throw new Error('Unexpected RC.me call ' + i);
    };

    // 只启动一次 init，保存 Promise
    const initPromise = env.RC.init();
    // 释放 loginConfig，等待 init 第一次 me()
    lcD.resolve({ ok: true });
    await waitUntil(() => meCallIdx.n >= 1, 'init 第一次 me');

    // 真实登录流程
    env.RC.__test.app.onLoginSuccess();
    await waitUntil(() => meCallIdx.n >= 2, '登录第二次 me');

    // 第二次 me 属于登录 B（C36 中只有登录触发一次 enterApp → [0]）
    dLogin.resolve({ ok: true, uid: 'login' });
    await waitUntil(() => env.RC.__test.app.getEnterAppCalls().length >= 1, '登录 enterApp');
    await env.RC.__test.app.getEnterAppCalls()[0];
    assert.strictEqual(env.RC.currentAccountId(), 'login');

    // 第一次 me 属于 init A，最后释放
    dInit.resolve({ ok: true, uid: 'init' });
    await initPromise;
    assert.strictEqual(env.RC.currentAccountId(), 'login', '旧 init 结果不得覆盖登录账号');
    assert.strictEqual(meCallIdx.n, 2, '应恰好两次 me');
    await env.cleanup();
  });

  // C38：真实后台请求启动→取消→Promise 结算（5 证据 + 分阶段 cleanup + 显式取消变量）
  await check('C38 身份成功后其他初始化异常不销毁有效上下文', async () => {
    const env = createTestEnv();
    let initPromise;
    let mainError = null;
    const cleanupErrors = [];
    let cancelAttempted = false;
    let cancelSucceeded = false;

    try {
      // C38：让 /api/catalog 走可取消的挂起 Promise（验证真实取消链）
      env.catalogNetHold = true;
      env.RC.me = () => Promise.resolve({ ok: true, uid: 'ok' });
      let paintCallCount = 0;
      env.RC.paintModelBar = () => {
        paintCallCount++;
        if (paintCallCount === 1) return;
        throw new Error('init exception');
      };

      initPromise = env.RC.init();
      // 同 tick 接管 Promise：立即安装双分支 handler，消除延迟 attach 窗口
      const initOutcome = initPromise.then(
        (value) => ({ status: 'resolved', value }),
        (error) => ({ status: 'rejected', error })
      );

      // 证据1：后台请求确实启动
      await waitUntil(() => env.catalogCalls.length >= 1, 'catalog 请求应启动');
      assert.strictEqual(env.RC.__testApi.getCatalogStatus(), 'loading', '状态应为 loading');
      assert.strictEqual(env.RC.__testApi.hasActiveCatalog(), true, '应有活跃请求');
      assert.strictEqual(env.getCatalogNetState(), 'pending', '底层网络应挂起');

      const outcome = await initOutcome;
      assert.strictEqual(outcome.status, 'rejected', 'init 应以异常结束');
      assert.match(outcome.error.message, /init exception/, '错误应为 init exception');
      assert.strictEqual(env.RC.currentAccountId(), 'ok', '上下文应保留');
      assert.strictEqual(paintCallCount, 2, 'paintModelBar 恰好两次');
    } catch (err) {
      mainError = err;
    } finally {
      await collectCleanupError(cleanupErrors, '取消后台请求', async () => {
        if (env.catalogCalls.length > 0 && env.RC.__testApi.hasActiveCatalog()) {
          cancelAttempted = true;
          const ok = env.RC.__testApi.cancelActiveCatalog();
          cancelSucceeded = (ok === true);
          assert.strictEqual(ok, true, 'cancelActiveCatalog 应返回 true');
        }
      });
      await collectCleanupError(cleanupErrors, '等待外层 Promise', async () => {
        // v3.24: 禁止静默跳过——外层 Promise 缺失必须显式失败
        if (!env.catalogCalls.length) {
          throw new Error('catalog 请求记录缺失');
        }
        const call = env.catalogCalls[0];
        if (!call.promise || typeof call.promise.then !== 'function') {
          throw new Error('catalog 外层 Promise 缺失或无效');
        }
        const r = await withBoundedWait(call.promise, 2000, '外层Promise');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'test-cleanup');
      });
      await collectCleanupError(cleanupErrors, '等待底层 Promise', async () => {
        const p = env.getCatalogNetPromise();
        if (!p) return;
        const r = await withBoundedWait(p.catch(e => ({ name: e.name })), 2000, '底层Promise');
        assert.strictEqual(r.name, 'AbortError');
      });
      await collectCleanupError(cleanupErrors, '通用资源清理', async () => {
        await withBoundedWait(env.cleanup(initPromise), 2000, 'cleanup');
      });
    }

    const netAborted = env.getCatalogNetState() === 'aborted';
    if (cancelAttempted && cancelSucceeded && !netAborted) {
      cleanupErrors.push(new Error('取消返回 true 但底层未进入 aborted，真实取消证据不完整'));
    }
    if (!cancelAttempted && env.catalogCalls.length > 0) {
      cleanupErrors.push(new Error('catalog 请求已启动但未执行取消操作'));
    }

    if (mainError) {
      if (cleanupErrors.length) {
        mainError.message += '\nCleanup errors: ' + cleanupErrors.map(e => e.message).join('; ');
      }
      throw mainError;
    }
    if (cleanupErrors.length) {
      throw new Error('cleanup 失败: ' + cleanupErrors.map(e => e.message).join('; '));
    }
  });

  // C39：四种无效身份结果（每个独立 env + spy 原始 endAccountContext）
  const invalidCases = [
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: '{ok:false}', value: { ok: false } },
    { name: '{ok:true,uid:空}', value: { ok: true, uid: '' } },
  ];
  for (const c of invalidCases) {
    await check('C39 无效身份 ' + c.name, async () => {
      const env = createTestEnv();
      let mainError = null;
      const cleanupErrors = [];

      try {
        // ① 先建立有效旧账号上下文
        env.RC.beginAccountContext('old-account');
        assert.strictEqual(env.RC.currentAccountId(), 'old-account', '旧上下文应建立');
        env.RC.state.models = [{ id: 'old-model', name: 'Old' }];

        // ② spy 真实 endAccountContext（保留原行为）
        const origEnd = env.RC.endAccountContext;
        let endCount = 0;
        env.RC.endAccountContext = function (...args) {
          endCount++;
          return origEnd.apply(this, args);
        };

        // ③ me 返回无效身份
        env.RC.me = () => Promise.resolve(c.value);

        // ④ 启动 init 并【同 tick 接管】Promise（不吞异常）
        const initPromise = env.RC.init();
        const outcome = await initPromise.then(
          (value) => ({ status: 'resolved', value }),
          (error) => ({ status: 'rejected', error })
        );

        // ⑤ 分别验证（四种无效身份下 init 应正常完成，无异常）
        assert.strictEqual(
          outcome.status, 'resolved',
          c.name + ' 下 init 应正常完成，实际 ' + outcome.status +
          (outcome.error ? ' (' + outcome.error.message + ')' : '')
        );
        assert.strictEqual(endCount, 1, c.name + ' 应调用 endAccountContext 一次');
        assert.strictEqual(env.RC.currentAccountId(), null, '旧账号上下文应被清除');
        assert.strictEqual(env.RC.getModels().length, 0, '旧模型上下文不应残留');
      } catch (err) {
        mainError = err;
      } finally {
        try {
          await withBoundedWait(env.cleanup(), 2000, 'cleanup');
        } catch (cleanupErr) {
          cleanupErrors.push(cleanupErr);
        }
      }

      if (mainError) {
        if (cleanupErrors.length) {
          mainError.message += '\nCleanup errors: ' + cleanupErrors.map((e) => e.message).join('; ');
        }
        throw mainError;
      }
      if (cleanupErrors.length) {
        throw new Error('cleanup 失败: ' + cleanupErrors.map((e) => e.message).join('; '));
      }
    });
  }

  // C40：logout(true) 递增代次
  await check('C40 logout 递增代次', async () => {
    const env = createTestEnv();
    const seqBefore = env.RC.__test.app.getAuthFlowSeq();
    const endBefore = env.RC.__test.app.getEndCount();
    let logoutRemoteCalled = false;
    env.RC.logoutRemote = () => { logoutRemoteCalled = true; };

    env.RC.logout(true);

    assert.strictEqual(env.RC.__test.app.getAuthFlowSeq(), seqBefore + 1, '代次 +1');
    assert.strictEqual(env.RC.__test.app.getEndCount(), endBefore + 1, 'endAccountContext 一次');
    assert.strictEqual(logoutRemoteCalled, false, 'silent logout 不调 logoutRemote');
    assert.strictEqual(env.RC.currentAccountId(), null, '上下文清空');
    await env.cleanup();
  });

  // C41：useProxy 真实成功路径 + 真实重登录链
  await check('C41 useProxy 递增代次', async () => {
    const env = createTestEnv();
    env.hasAuthValue = true;
    env.promptValue = 'http://127.0.0.1:8799';
    const probeD = makeDeferred(env, 'probe');
    let probeCalled = false;
    env.RC.probeProxy = () => { probeCalled = true; return probeD.promise; };

    const dRefresh = makeDeferred(env, 'me-refresh');
    let refreshMeCount = 0;
    env.RC.me = () => { refreshMeCount++; return dRefresh.promise; };

    const seqBefore = env.RC.__test.app.getAuthFlowSeq();
    const endBefore = env.RC.__test.app.getEndCount();

    const useProxyPromise = env.RC.useProxy();
    probeD.resolve({ ok: true });
    await useProxyPromise;

    assert.strictEqual(probeCalled, true, 'probeProxy 应执行');
    assert.strictEqual(env.storage.getItem('raccoon.proxy.v2'), 'http://127.0.0.1:8799', '代理配置应写入');
    assert.strictEqual(env.RC.__test.app.getReLoginCalls().length, 1, '重登录链应触发');
    assert.strictEqual(env.RC.__test.app.getRefreshMeCalls(), 1, '恰好一次 refreshMe');

    await waitUntil(() => refreshMeCount >= 1, 'refreshMe 进入');
    dRefresh.resolve({ ok: true, uid: 'login-B' });
    await waitUntil(() => env.RC.__test.app.getApplyMeCalls().length >= 1, 'applyMe 执行');
    await flushMicrotasks();
    await waitUntil(() => env.RC.__test.app.getThenCallbackDone() === true, 'then 回调执行');

    const timer = env.findTimer(1200);
    assert.ok(timer, '1200ms timer 应创建');
    env.fireTimer(timer.id);
    await flushMicrotasks();
    assert.strictEqual(env.showLoginCalls, 0, '成功重登录不应弹登录界面');

    assert.strictEqual(env.RC.__test.app.getAuthFlowSeq(), seqBefore + 1);
    assert.strictEqual(env.RC.__test.app.getEndCount(), endBefore + 1);
    assert.strictEqual(env.RC.currentAccountId(), null);
    await env.cleanup();
  });

  // C42：useDirect 真实路径 + 真实重登录链
  await check('C42 useDirect 递增代次', async () => {
    const env = createTestEnv();
    env.storage.setItem('raccoon.proxy.v2', 'http://old-proxy');

    const dRefresh = makeDeferred(env, 'me-refresh-direct');
    let refreshMeCount = 0;
    env.RC.me = () => { refreshMeCount++; return dRefresh.promise; };

    const seqBefore = env.RC.__test.app.getAuthFlowSeq();
    const endBefore = env.RC.__test.app.getEndCount();

    env.RC.useDirect();

    assert.strictEqual(env.storage.getItem('raccoon.proxy.v2'), null, '代理配置应删除');
    assert.strictEqual(env.RC.__test.app.getReLoginCalls().length, 1, '重登录链应触发');
    assert.strictEqual(env.RC.__test.app.getRefreshMeCalls(), 1, '恰好一次 refreshMe');

    await waitUntil(() => refreshMeCount >= 1, 'refreshMe 进入');
    dRefresh.resolve({ ok: true, uid: 'login-B' });
    await waitUntil(() => env.RC.__test.app.getApplyMeCalls().length >= 1, 'applyMe 执行');
    await flushMicrotasks();
    await waitUntil(() => env.RC.__test.app.getThenCallbackDone() === true, 'then 回调执行');

    const timer = env.findTimer(1200);
    assert.ok(timer, '1200ms timer 应创建');
    env.fireTimer(timer.id);
    await flushMicrotasks();
    assert.strictEqual(env.showLoginCalls, 0, '成功重登录不应弹登录界面');

    assert.strictEqual(env.RC.__test.app.getAuthFlowSeq(), seqBefore + 1);
    assert.strictEqual(env.RC.__test.app.getEndCount(), endBefore + 1);
    assert.strictEqual(env.RC.currentAccountId(), null);
    await env.cleanup();
  });

  // 输出
  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log('  ✓ ' + r.name);
    else { failed++; console.log('  ✗ ' + r.name); console.log('    ' + r.err); }
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' 通过');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
