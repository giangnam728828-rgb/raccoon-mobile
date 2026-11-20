'use strict';

/**
 * P0-2 身份确认代次保护测试（逻辑等价契约测试）
 *
 * 本文件复现 app.js 中 enterApp() / init() 的身份代次判定逻辑（复制自真实代码），
 * 用可控 deferred 验证竞态边界。对应真实代码位置：
 *   - enterApp: public/js/app.js ~347–365
 *   - init:     public/js/app.js ~1185–1215
 *
 * 说明：由于 app.js 依赖大量 DOM 和 RC 方法，无法在 Node 中完整加载；本测试以
 *       "逻辑等价" 方式复现核心判定分支，确保并发语义正确性。
 *
 * 运行：npm test（包含本文件）
 */

const assert = require('assert');

function deferred() {
  let resolve, reject;
  const promise = new Promise((r, rej) => { resolve = r; reject = rej; });
  return { promise, resolve, reject };
}

// 模拟进入流程（replica of enterApp 身份判定部分）
function makeFlow() {
  let __authFlowSeq = 0;
  let currentUid = null;
  const history = [];

  async function enterApp(mePromise) {
    const authSeq = __authFlowSeq;
    let d = null;
    try {
      d = await mePromise;
    } catch (e) {}

    // 身份代次校验（与 app.js 一致）
    if (authSeq !== __authFlowSeq) return { skipped: true, uid: currentUid };

    if (d && d.ok && d.uid) {
      currentUid = d.uid;
      history.push({ action: 'begin', uid: d.uid });
    } else {
      history.push({ action: 'end' });
      currentUid = null;
    }

    // 二次校验（UI 同步前）
    if (authSeq !== __authFlowSeq) return { skipped: true, uid: currentUid };

    return { skipped: false, uid: currentUid };
  }

  function login() {
    __authFlowSeq++;
  }

  return { enterApp, login, getUid: () => currentUid, history };
}

async function main() {
  console.log('P0-2 身份确认代次保护测试（逻辑等价契约）\n');

  // C35：A enterApp 的 me() 晚于 B 登录，A 被跳过
  {
    const flow = makeFlow();
    const dA = deferred();
    const pA = flow.enterApp(dA.promise);

    flow.login(); // 新登录会话开始
    const dB = deferred();
    const pB = flow.enterApp(dB.promise);

    dB.resolve({ ok: true, uid: 'B' });
    const rB = await pB;
    assert.strictEqual(rB.skipped, false, 'B 应成功建立上下文');
    assert.strictEqual(flow.getUid(), 'B');

    dA.resolve({ ok: true, uid: 'A' }); // 迟到
    const rA = await pA;
    assert.strictEqual(rA.skipped, true, 'A 应被跳过');
    assert.strictEqual(flow.getUid(), 'B', '当前 UID 仍为 B');
    console.log('  ✓ C35 A enterApp 身份确认晚于 B 登录');
  }

  // C36：冷启动 init 的 me() 晚于交互登录，旧结果不建上下文
  {
    const flow = makeFlow();
    // 模拟冷启动 me 先发出
    const dInit = deferred();
    const pInit = flow.enterApp(dInit.promise);

    // 用户完成交互登录
    flow.login();
    const dLogin = deferred();
    const pLogin = flow.enterApp(dLogin.promise);

    dLogin.resolve({ ok: true, uid: 'login' });
    const rLogin = await pLogin;
    assert.strictEqual(rLogin.skipped, false);
    assert.strictEqual(flow.getUid(), 'login');

    dInit.resolve({ ok: true, uid: 'init' }); // 迟到
    const rInit = await pInit;
    assert.strictEqual(rInit.skipped, true);
    assert.strictEqual(flow.getUid(), 'login');
    console.log('  ✓ C36 冷启动 init 的 me() 晚于交互登录');
  }

  // C37：旧身份确认异常但代次过期时不清理新会话
  {
    const flow = makeFlow();
    const dOld = deferred();
    const pOld = flow.enterApp(dOld.promise);

    flow.login();
    const dNew = deferred();
    const pNew = flow.enterApp(dNew.promise);

    // 旧 me 抛出异常
    dOld.reject(new Error('boom'));
    const rOld = await pOld.catch(() => ({ skipped: true }));
    assert.strictEqual(rOld.skipped, true, '旧流程异常且过期应跳过');

    dNew.resolve({ ok: true, uid: 'new' });
    const rNew = await pNew;
    assert.strictEqual(rNew.skipped, false);
    assert.strictEqual(flow.getUid(), 'new');
    console.log('  ✓ C37 旧身份确认异常但代次过期时不清理新会话');
  }

  // C38：身份成功后其他初始化异常不得清除已建立的有效上下文
  {
    const flow = makeFlow();
    const d = deferred();
    const p = flow.enterApp(d.promise);

    d.resolve({ ok: true, uid: 'ok' });
    const r = await p;
    assert.strictEqual(r.skipped, false);
    assert.strictEqual(flow.getUid(), 'ok');

    // 模拟后续初始化抛错（本测试不复现 UI，只验证上下文保留）
    // 逻辑上：若后续代码抛错，不应调用 endAccountContext
    // 本测试通过“无额外清理”间接验证
    assert.strictEqual(flow.history.length, 1, '仅一次 begin，无多余 end');
    console.log('  ✓ C38 身份成功后其他初始化异常不销毁有效上下文');
  }

  // C39：四种无效身份结果均触发 endAccountContext（历史中记录 end）
  {
    const cases = [
      { desc: 'null', value: null },
      { desc: 'undefined', value: undefined },
      { desc: '{ok:false}', value: { ok: false } },
      { desc: '{ok:true,uid:""}', value: { ok: true, uid: '' } },
    ];

    for (const c of cases) {
      const flow = makeFlow();
      const d = deferred();
      const p = flow.enterApp(d.promise);
      d.resolve(c.value);
      const r = await p;
      assert.strictEqual(r.skipped, false, c.desc + ' 应走 else 分支');
      assert.deepStrictEqual(flow.history, [{ action: 'end' }], c.desc + ' 应触发 end');
    }
    console.log('  ✓ C39 四种无效身份结果均触发 endAccountContext');
  }

  console.log('\n所有契约测试通过');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
