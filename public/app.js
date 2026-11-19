// 小浣熊移动端 —— 前端逻辑
// 登录：手机号 + 短信验证码（人机验证在浏览器里完成）／粘贴 Token
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // 构建期注入的旧代理地址：仅作为「手动开启代理」时的默认候选，平时不启用
  const API_BASE = '';
  // 服务端设置了 ACCESS_KEY 时，构建时一并写入（仅代理模式使用）
  const ACCESS_KEY = '';

  // 注意：这个名字换了，老版本填错的地址不会被继承
  const PROXY_KEY = 'raccoon.proxy.v2';

  // 代理地址：只有用户显式开启「代理模式」才会用到；默认空 = 直连官方
  function proxyBase() {
    let saved = '';
    try {
      saved = localStorage.getItem(PROXY_KEY) || '';
    } catch {
      saved = '';
    }
    return String(saved).trim().replace(/\/+$/, '');
  }

  function isDirect() {
    return !proxyBase();
  }

  function connLabel() {
    const p = proxyBase();
    if (!p) return '自动 · 直连官方';
    return '代理 · ' + p.replace(/^https?:\/\//, '');
  }

  const CAPTCHA_SDK = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';

  const state = {
    loggedIn: false,
    models: [],
    model: '',
    thinking: false,
    streaming: false,
    messages: [],
    uid: '',
    name: '',
    phone: '',
    points: 0,
    verificationId: '',
    sessionId: '',
    lastError: '',
    nation: '+86',
    phoneForLogin: '',
  };

  let loginCfg = {
    captcha: { scene: '1pkmy0x3', prefix: 'hk1r5l', region: 'cn' },
    nationCodes: [
      { code: '+86', label: '中国大陆' },
      { code: '+852', label: '中国香港' },
      { code: '+853', label: '中国澳门' },
      { code: '+886', label: '中国台湾' },
    ],
    keyRequired: false,
  };

  const ICO = {
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11M9.3 20V5M14.7 20v-6M20 20V8"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.6"/><rect x="14" y="4" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><path d="M17.5 14v7M14 17.5h7"/></svg>',
  };
  const SUGGEST = [
    { icon: ICO.chart, title: '数据分析', text: '帮我分析这组数据，给出结论' },
    { icon: ICO.pen, title: '写一份文案', text: '写一段产品介绍文案' },
    { icon: ICO.split, title: '拆解任务', text: '把这个任务拆成可执行的步骤' },
  ];

  // ---------- 视图 / 弹层 ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const v = $(name + '-view');
    if (v) v.classList.add('active');
  }
  function openSheet(id) {
    $(id).classList.remove('hidden');
  }
  function closeSheet(id) {
    $(id).classList.add('hidden');
  }

  function showMsg(text) {
    const el = $('login-msg');
    el.textContent = text;
    // 「未登录」这类是状态说明，不是错误，用中性色
    el.classList.toggle('info', /^未登录/.test(text));
    el.classList.remove('hidden');
  }
  function hideMsg() {
    $('login-msg').classList.add('hidden');
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  // ---------- 请求 ----------
  // 默认直连官方（App 自己完成登录与聊天）；只有在设置里指定了代理才走代理。
  async function api(path, opts = {}) {
    const base = proxyBase();
    if (base) return proxyApi(base, path, opts);

    let data;
    try {
      data = await window.RaccoonDirect.handle(path, opts);
    } catch (e) {
      if (e && e.auth === false) {
        logout(true);
      }
      throw e;
    }
    if (data && data.auth === false) {
      logout(true);
      throw new Error(data.message || '登录已失效，请重新登录');
    }
    return data || { ok: false };
  }

  async function proxyApi(base, path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (ACCESS_KEY) headers['x-access-key'] = ACCESS_KEY;

    let res;
    try {
      res = await fetch(base + path, {
        method: opts.method || 'GET',
        headers: { ...headers, ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      const reason = e && e.name === 'AbortError' ? '超时' : '网络不可达';
      throw new Error('连不上代理 ' + base + '（' + reason + '）');
    }

    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {
          ok: false,
          message: base + ' 返回的不是小浣熊代理（HTTP ' + res.status + '），请重新检测',
        };
      }
    }

    if (data.keyRequired) {
      throw new Error('需要访问密钥：服务端设置了 ACCESS_KEY，请在构建时填入');
    }
    if (res.status === 401 && data.auth === false) {
      logout(true);
      throw new Error(data.message || '登录已失效，请重新登录');
    }
    return data;
  }

  // ---------- 登录态 ----------
  function applyMe(d) {
    state.loggedIn = true;
    state.uid = d.uid || '';
    state.name = d.name || '小浣熊';
    state.phone = d.phone || '';
    state.points = d.points || 0;
    $('me-name').textContent = state.name;
    $('points-badge').textContent = '积分 ' + state.points;
    $('set-name').textContent = state.name;
    $('set-phone').textContent = state.phone || '—';
    $('set-points').textContent = state.points;
    $('status-dot').classList.add('on');
  }

  async function loadMe() {
    try {
      const d = await api('/api/me');
      if (d.ok) applyMe(d);
      return d.ok;
    } catch (e) {
      return false;
    }
  }

  function onLoginSuccess() {
    hideMsg();
    $('token-panel').classList.add('hidden');
    showView('chat');
    enterChat();
  }

  function logout(silent) {
    state.loggedIn = false;
    // 直连模式本地也存了 token，退出要一起清掉
    if (window.RaccoonDirect) window.RaccoonDirect.clearAuth();
    state.messages = [];
    state.model = '';
    state.verificationId = '';
    state.sessionId = '';
    if (state.abort) {
      try {
        state.abort.abort();
      } catch {}
      state.abort = null;
    }
    $('messages').innerHTML = '';
    $('status-dot').classList.remove('on');
    clearInterval(countdownTimer);
    const sendBtn = $('btn-send-code');
    sendBtn.disabled = false;
    sendBtn.textContent = '获取验证码';
    $('code').value = '';
    showView('login');
    rebuildEmpty();
    if (!silent) {
      api('/api/logout', { method: 'POST' }).catch(() => {});
      toast('已退出登录');
    }
  }

  // ---------- 人机验证（阿里云）----------
  let captchaLoader = null;
  let captchaInstance = null;

  function loadCaptchaSdk() {
    if (typeof window.initAliyunCaptcha === 'function') return Promise.resolve();
    if (captchaLoader) return captchaLoader;

    captchaLoader = new Promise((resolve, reject) => {
      const cfg = loginCfg.captcha || {};
      window.AliyunCaptchaConfig = { region: cfg.region || 'cn', prefix: cfg.prefix || '' };
      const s = document.createElement('script');
      s.src = CAPTCHA_SDK;
      s.async = true;
      s.onload = () => {
        if (typeof window.initAliyunCaptcha === 'function') resolve();
        else reject(new Error('人机验证组件加载异常，请稍后重试'));
      };
      s.onerror = () => reject(new Error('人机验证组件加载失败，请检查网络后重试'));
      document.head.appendChild(s);
    }).catch((e) => {
      captchaLoader = null;
      throw e;
    });

    return captchaLoader;
  }

  // 拉起验证码，成功时 resolve(captcha_token)
  let capRunning = null;
  function runCaptcha() {
    if (capRunning) return capRunning;

    capRunning = loadCaptchaSdk()
      .then(
        () =>
          new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn, arg) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              fn(arg);
            };
            const timer = setTimeout(() => finish(reject, new Error('人机验证超时，请重试')), 150000);

            const opts = {
              SceneId: loginCfg.captcha.scene,
              mode: 'popup',
              element: '#cap-element',
              button: '#cap-button',
              language: 'cn',
              rem: Math.min(1, (window.innerWidth - 24) / 360),
              slideStyle: { width: 360, height: 40 },
              captchaVerifyCallback: (param) => {
                finish(resolve, param);
                return { captchaResult: true, bizResult: true };
              },
              onBizResultCallback: () => {},
              onError: () => finish(reject, new Error('人机验证加载失败，请重试')),
              onClose: (reason) => {
                if (!reason || reason === 'userDismiss') finish(reject, new Error('已取消人机验证'));
              },
              getInstance: (inst) => {
                captchaInstance = inst;
                // SDK 初始化是异步的（要拉动态资源），太早 show() 会被忽略
                const wait = Math.max(0, 1200 - (Date.now() - startedAt));
                setTimeout(async () => {
                  if (settled) return;
                  try {
                    if (inst && typeof inst.show === 'function') await inst.show();
                    else $('cap-button').click();
                    // 无痕验证：风控放行时用户什么都不用点，直接拿到 token
                    if (inst && typeof inst.startTracelessVerification === 'function') {
                      await inst.startTracelessVerification();
                    }
                  } catch {
                    finish(reject, new Error('人机验证打开失败，请重试'));
                  }
                }, wait);
              },
            };

            const startedAt = Date.now();

            let p;
            try {
              p = Promise.resolve(window.initAliyunCaptcha(opts));
            } catch (e) {
              return finish(reject, e);
            }
            p.catch(() => finish(reject, new Error('人机验证初始化失败，请重试')));
          })
      )
      .catch((e) => {
        capRunning = null;
        throw e;
      });

    // 成功后也解除占用，下次重新走一遍
    capRunning.then(() => {
      capRunning = null;
    }).catch(() => {});

    return capRunning;
  }

  // ---------- 登录：手机号 ----------
  function renderNation() {
    const sel = $('nation');
    sel.innerHTML = '';
    const list = loginCfg.nationCodes && loginCfg.nationCodes.length ? loginCfg.nationCodes : [{ code: '+86', label: '中国大陆' }];
    list.forEach((n) => {
      const o = document.createElement('option');
      o.value = n.code;
      o.textContent = n.code + ' ' + n.label;
      sel.appendChild(o);
    });
    sel.value = state.nation;
    if (!sel.value) sel.value = list[0].code;
    state.nation = sel.value;
  }

  let countdownTimer = null;
  function startCountdown(sec) {
    const btn = $('btn-send-code');
    let left = Math.max(1, Math.round(sec) || 60);
    clearInterval(countdownTimer);
    const tick = () => {
      if (left <= 0) {
        clearInterval(countdownTimer);
        btn.disabled = false;
        btn.textContent = '重新获取';
        return;
      }
      btn.disabled = true;
      btn.textContent = left + 's';
      left -= 1;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function requestCode() {
    hideMsg();
    const phone = $('phone').value.replace(/[\s\-()]/g, '');
    state.nation = $('nation').value || '+86';

    if (!phone) return showMsg('请输入手机号');
    if (state.nation === '+86' && !/^1[3-9][0-9]{9}$/.test(phone)) return showMsg('请输入正确的 11 位手机号');

    const btn = $('btn-send-code');
    if (btn.disabled) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '验证中…';

    try {
      showMsg('正在完成人机验证…');
      const captchaToken = await runCaptcha();
      hideMsg();
      btn.textContent = '发送中…';

      const d = await api('/api/login/sms/send', {
        method: 'POST',
        body: { phone, nationCode: state.nation, captchaToken },
      });

      if (!d.ok) {
        btn.disabled = false;
        btn.textContent = original;
        const msg = d.message || '验证码发送失败';
        state.lastError = msg + (d.code ? '（' + d.code + '）' : '');
        if (/人机验证/.test(msg)) {
          return showMsg(msg + '，请再点一次「获取验证码」重试');
        }
        return showMsg(msg);
      }

      state.verificationId = d.verificationId;
      state.phoneForLogin = phone;
      startCountdown(d.retryAfter || 60);
      $('code').value = '';
      $('code').focus();
      toast('验证码已发送');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = original;
      state.lastError = (e && e.message) || '验证码发送失败';
      showMsg(state.lastError);
    }
  }

  async function doPhoneLogin() {
    hideMsg();
    const phone = $('phone').value.replace(/[\s\-()]/g, '');
    const code = $('code').value.trim().replace(/\s/g, '');

    if (!state.verificationId) return showMsg('请先获取验证码');
    if (!/^[0-9]{4,8}$/.test(code)) return showMsg('请输入短信收到的验证码');

    const btn = $('btn-login');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '登录中…';

    try {
      const d = await api('/api/login/sms/verify', {
        method: 'POST',
        body: {
          phone: state.phoneForLogin || phone,
          nationCode: state.nation,
          verificationId: state.verificationId,
          code,
        },
      });
      if (!d.ok) return showMsg(d.message || '登录失败');
      onLoginSuccess();
    } catch (e) {
      showMsg(e.message || '登录失败');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ---------- 登录：粘贴 Token ----------
  async function doTokenLogin() {
    hideMsg();
    const token = $('token-input').value.trim();
    if (!token) return showMsg('请粘贴 token');

    const btn = $('btn-token-go');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '验证中…';

    try {
      const d = await api('/api/login/token', { method: 'POST', body: { token } });
      if (!d.ok) return showMsg(d.message || '登录失败');
      $('token-input').value = '';
      onLoginSuccess();
    } catch (e) {
      showMsg(e.message || '登录失败');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ---------- 进入聊天 ----------
  async function enterChat() {
    if (!state.sessionId) state.sessionId = window.RaccoonDirect.newSessionId();
    await Promise.all([loadMe(), loadCatalog()]);
    if (!state.model && state.models.length) state.model = state.models[0].id;
    updateModelBar();
    rebuildEmpty();
  }

  async function loadCatalog() {
    try {
      const d = await api('/api/catalog');
      if (d.ok && Array.isArray(d.models)) {
        state.models = d.models;
        renderModelList();
      }
    } catch {}
  }

  function renderModelList() {
    const list = $('model-list');
    list.innerHTML = '';
    if (!state.models.length) {
      list.innerHTML = '<p class="panel-tip">暂无可用模型</p>';
      return;
    }
    state.models.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'model-item' + (m.id === state.model ? ' active' : '');
      const meta = [m.id, m.contextLength ? m.contextLength + ' 上下文' : '', m.supportsImages ? '识图' : '']
        .filter(Boolean)
        .join(' · ');
      el.innerHTML =
        '<div class="mi-main"><div class="nm">' + esc(m.name) + '</div><div class="meta">' + esc(meta) + '</div></div>' +
        '<span class="pick">' + (m.id === state.model ? '已选' : '选择') + '</span>';
      el.onclick = () => {
        state.model = m.id;
        updateModelBar();
        closeSheet('model-sheet');
        renderModelList();
      };
      list.appendChild(el);
    });
  }

  function updateModelBar() {
    const m = state.models.find((x) => x.id === state.model);
    $('model-name-val').textContent = m ? m.name : state.model || '默认';
    $('set-model').textContent = state.model || '—';
    $('set-think').textContent = state.thinking ? '开' : '关';
  }

  // ---------- 消息渲染 ----------
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // 一条消息只建一次 DOM，流式时只改文本节点
  function createRow(m) {
    const row = el('div', 'msg-row ' + (m.role === 'user' ? 'user' : 'ai'));
    const bubble = el('div', 'bubble');

    let reasoningBox = null;
    let reasoningPre = null;
    if (m.role !== 'user') {
      reasoningBox = el('details', 'reasoning');
      const sum = el('summary');
      sum.textContent = '深度思考过程';
      reasoningPre = el('pre');
      reasoningBox.appendChild(sum);
      reasoningBox.appendChild(reasoningPre);
      bubble.appendChild(reasoningBox);
    }

    const typing = el('div', 'typing');
    typing.innerHTML = '<span></span><span></span><span></span>';
    if (m.role !== 'user') bubble.appendChild(typing);

    const content = el('div', 'content');
    bubble.appendChild(content);
    row.appendChild(bubble);

    const render = () => {
      if (m.role !== 'user') {
        const hasR = !!(m.reasoning && m.reasoning.length);
        reasoningBox.hidden = !hasR;
        if (hasR && reasoningPre.textContent !== m.reasoning) reasoningPre.textContent = m.reasoning;
      }
      const text = m.content || '';
      if (content.textContent !== text) content.textContent = text;
      content.classList.toggle('cursor', !!m.streaming);
      if (m.role !== 'user') {
        typing.classList.toggle('hidden', !(m.streaming && !m.content && !m.reasoning));
      }
    };

    m.ui = { el: row, render };
    render();
    return row;
  }

  function isNearBottom() {
    const box = $('messages');
    return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  }
  function scrollBottom(force) {
    const box = $('messages');
    if (force || isNearBottom()) box.scrollTop = box.scrollHeight;
  }

  function buildEmpty() {
    const wrap = el('div', 'empty-state');
    wrap.innerHTML =
      '<div class="empty-mark">' +
      '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="em-face" x1="24" y1="12" x2="24" y2="41" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#2e3a4f"/><stop offset="1" stop-color="#161d29"/></linearGradient>' +
      '<linearGradient id="em-ring" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#f59e0b" stop-opacity=".5"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></linearGradient>' +
      '</defs>' +
      '<circle cx="24" cy="24" r="21" stroke="url(#em-ring)" stroke-width="1.2"/>' +
      '<circle cx="11.5" cy="15" r="6.2" fill="#243044"/><circle cx="36.5" cy="15" r="6.2" fill="#243044"/>' +
      '<circle cx="11.5" cy="15" r="3" fill="#f59e0b" opacity=".42"/><circle cx="36.5" cy="15" r="3" fill="#f59e0b" opacity=".42"/>' +
      '<ellipse cx="24" cy="26" rx="15.6" ry="14.2" fill="url(#em-face)" stroke="#3a4a63" stroke-width="1"/>' +
      '<path d="M9.8 23.4c0-3.6 3.3-6.1 7.4-6.1 3.8 0 6.3 2.5 6.3 5.9 0 3.5-2.9 6.2-6.7 6.2-4.1 0-7-2.4-7-6z" fill="#080c13"/>' +
      '<path d="M38.2 23.4c0-3.6-3.3-6.1-7.4-6.1-3.8 0-6.3 2.5-6.3 5.9 0 3.5 2.9 6.2 6.7 6.2 4.1 0 7-2.4 7-6z" fill="#080c13"/>' +
      '<circle cx="17.1" cy="23.8" r="2.15" fill="#fff"/><circle cx="30.9" cy="23.8" r="2.15" fill="#fff"/>' +
      '<circle cx="17.5" cy="24.2" r="1.15" fill="#0b0f17"/><circle cx="31.3" cy="24.2" r="1.15" fill="#0b0f17"/>' +
      '<path d="M24 29.6l-2.3 2.1h4.6L24 29.6z" fill="#f59e0b"/>' +
      '<path d="M20.8 34.2c1.1 1.5 5.3 1.5 6.4 0" stroke="#7b8aa1" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg></div>' +
      '<h2>开始对话</h2><p class="empty-sub">选择模型、开启深度思考，直接提问</p><div class="suggest"></div>';

    const suggest = wrap.querySelector('.suggest');
    SUGGEST.forEach((s) => {
      const chip = el('button', 'suggest-chip');
      chip.type = 'button';
      chip.innerHTML =
        '<span class="chip-ico">' + s.icon + '</span>' +
        '<span class="chip-tx"><b>' + esc(s.title) + '</b><em>' + esc(s.text) + '</em></span>';
      chip.onclick = () => {
        $('input').value = s.text;
        autoGrow();
        updateSend();
        $('input').focus();
      };
      suggest.appendChild(chip);
    });
    return wrap;
  }

  function rebuildEmpty() {
    const box = $('messages');
    box.innerHTML = '';
    if (!state.messages.length) {
      box.appendChild(buildEmpty());
    } else {
      state.messages.forEach((m) => box.appendChild(m.ui ? m.ui.el : createRow(m)));
    }
    scrollBottom(true);
  }

  function appendMessage(role, content) {
    const m = { role, content, reasoning: '', streaming: role === 'ai' };
    state.messages.push(m);
    const box = $('messages');
    const empty = box.querySelector('.empty-state');
    if (empty) empty.remove();
    box.appendChild(createRow(m));
    scrollBottom(true);
    return m;
  }

  // ---------- 发送 ----------
  let renderPending = false;
  function scheduleRender(m) {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      if (m.ui) m.ui.render();
      scrollBottom(false);
    });
  }

  function updateSend() {
    const btn = $('btn-send');
    const streaming = state.streaming;
    btn.classList.toggle('streaming', streaming);
    btn.querySelector('.ico-send').classList.toggle('hidden', streaming);
    btn.querySelector('.ico-stop').classList.toggle('hidden', !streaming);
    btn.disabled = streaming ? false : !$('input').value.trim();
    btn.setAttribute('aria-label', streaming ? '停止生成' : '发送');
  }

  function stopStreaming() {
    if (state.abort) {
      try {
        state.abort.abort();
      } catch {}
    }
  }

  // 代理模式下的流式对话（备用通道）
  async function streamViaProxy(body, ai) {
    const base = proxyBase();
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ACCESS_KEY ? { 'x-access-key': ACCESS_KEY } : {}),
      },
      body: JSON.stringify(body),
      signal: state.abort.signal,
    });
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || ctype.indexOf('application/json') === 0) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout(true);
        throw new Error(d.message || '登录已失效，请重新登录');
      }
      throw new Error(d.message || '对话请求失败（HTTP ' + res.status + '）');
    }
    if (!res.body) throw new Error('当前环境不支持流式响应');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const t = line.trim();
        if (!t || t.indexOf('data:') !== 0) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let frame;
        try {
          frame = JSON.parse(payload);
        } catch {
          continue;
        }
        if (frame.error) {
          ai.content += (ai.content ? '\n\n' : '') + '⚠️ ' + (frame.error.message || '上游返回错误');
          continue;
        }
        const choice = frame.choices && frame.choices[0];
        if (!choice) continue;
        const delta = choice.delta || choice.message || {};
        if (typeof delta.content === 'string' && delta.content) ai.content += delta.content;
        const r = delta.reasoning_content || delta.reasoning;
        if (typeof r === 'string' && r) ai.reasoning += r;
      }
      scheduleRender(ai);
    }
  }

  async function send() {
    if (state.streaming) return;
    const input = $('input');
    const text = input.value.trim();
    if (!text) return;

    state.messages.push({ role: 'user', content: text });
    input.value = '';
    autoGrow();
    rebuildEmpty();

    const ctx = state.messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));

    const body = {
      model: state.model,
      messages: ctx,
      stream: true,
      max_tokens: 80000,
      reasoning_effort: state.thinking ? 'high' : 'off',
    };

    const ai = appendMessage('ai', '');
    state.streaming = true;
    state.abort = new AbortController();
    updateSend();

    let aborted = false;

    try {
      if (isDirect()) {
        await window.RaccoonDirect.chat(
          { ...body, sessionId: state.sessionId, signal: state.abort.signal },
          {
            onDelta: (d) => {
              if (d.error) ai.content += (ai.content ? '\n\n' : '') + '⚠️ ' + d.error;
              else {
                if (d.content) ai.content += d.content;
                if (d.reasoning) ai.reasoning += d.reasoning;
              }
              scheduleRender(ai);
            },
          }
        );
      } else {
        await streamViaProxy(body, ai);
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        aborted = true;
        if (!ai.content && !ai.reasoning) ai.content = '（已停止）';
      } else {
        let msg = (e && e.message) || '请求失败';
        if (/Failed to fetch|Load failed|NetworkError/i.test(msg)) {
          msg = isDirect() ? '连不上官方服务，请检查网络' : '连不上代理 ' + proxyBase() + '，请重新检测';
        }
        if (e && e.auth === false) msg = '登录已失效，请重新登录';
        ai.content += (ai.content ? '\n\n' : '') + '⚠️ ' + msg;
      }
    } finally {
      ai.streaming = false;
      state.streaming = false;
      state.abort = null;
      if (ai.ui) ai.ui.render();
      scrollBottom(false);
      updateSend();
      if (!aborted && (ai.content || ai.reasoning)) loadMe();
    }
  }

  // ---------- 输入框 ----------
  function autoGrow() {
    const ta = $('input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight || 0, 120) + 'px';
  }

  // ---------- 语音 ----------
  let recog = null;
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      $('btn-voice').classList.add('hidden');
      return;
    }
    try {
      recog = new SR();
    } catch {
      $('btn-voice').classList.add('hidden');
      return;
    }
    recog.lang = 'zh-CN';
    recog.interimResults = true;
    recog.continuous = false;
    let finalText = '';
    recog.onstart = () => {
      finalText = '';
    };
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += txt;
        else interim += txt;
      }
      $('input').value = finalText + interim;
      autoGrow();
      updateSend();
    };
    recog.onend = () => $('btn-voice').classList.remove('listening');
    recog.onerror = () => $('btn-voice').classList.remove('listening');
  }

  function toggleVoice() {
    if (!recog) return;
    if ($('btn-voice').classList.contains('listening')) {
      try {
        recog.stop();
      } catch {}
      return;
    }
    try {
      recog.start();
      $('btn-voice').classList.add('listening');
    } catch {}
  }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 绑定 ----------
  function bind() {
    $('btn-send-code').onclick = requestCode;
    $('btn-login').onclick = doPhoneLogin;
    $('btn-token-go').onclick = doTokenLogin;
    $('btn-token-toggle').onclick = () => {
      const panel = $('token-panel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) $('token-input').focus();
    };

    document.querySelectorAll('[data-back]').forEach((b) => {
      b.onclick = () => $('token-panel').classList.add('hidden');
    });
    document.querySelectorAll('[data-close]').forEach((elm) => {
      elm.onclick = () => closeSheet(elm.getAttribute('data-close'));
    });
    // Esc 关闭弹层（外接键盘 / 桌面调试常用）
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('model-sheet').classList.contains('hidden')) return closeSheet('model-sheet');
      if (!$('settings-sheet').classList.contains('hidden')) return closeSheet('settings-sheet');
      if (!$('diag-sheet').classList.contains('hidden')) return closeSheet('diag-sheet');
      if (!$('token-panel').classList.contains('hidden')) $('token-panel').classList.add('hidden');
    });

    $('nation').onchange = () => {
      state.nation = $('nation').value;
      state.verificationId = '';
      $('code').value = '';
    };
    $('phone').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.verificationId) doPhoneLogin();
        else requestCode();
      }
    });
    $('code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doPhoneLogin();
      }
    });
    $('token-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        doTokenLogin();
      }
    });

    $('btn-models').onclick = () => {
      renderModelList();
      openSheet('model-sheet');
    };
    $('model-name').onclick = () => {
      renderModelList();
      openSheet('model-sheet');
    };
    $('btn-settings').onclick = () => {
      updateModelBar();
      refreshConnPanel();
      openSheet('settings-sheet');
    };

    // ---------- 连接面板 / 诊断 ----------
    function paintConn() {
      const mode = connLabel();
      const l1 = $('login-proxy');
      const l2 = $('set-mode');
      const l3 = $('set-proxy');
      const l4 = $('diag-mode');
      if (l1) l1.textContent = mode;
      if (l2) l2.textContent = mode;
      if (l3) l3.textContent = isDirect() ? '未启用' : proxyBase().replace(/^https?:\/\//, '');
      if (l4) l4.textContent = mode;
    }

    function refreshConnPanel() {
      paintConn();
      testConn();
    }

    // 探测一个地址是不是真的小浣熊代理（不是 200 就算通，必须能对上暗号）
    async function probeProxy(base) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const started = Date.now();
      try {
        const r = await fetch(base + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
        if (!r.ok) return { ok: false, ms: Date.now() - started, reason: 'HTTP ' + r.status };
        const d = await r.json().catch(() => null);
        if (!d || d.ok !== true || !(d.upstream || d.service)) {
          return { ok: false, ms: Date.now() - started, reason: '该地址不是小浣熊代理' };
        }
        return { ok: true, ms: Date.now() - started, data: d };
      } catch (e) {
        return {
          ok: false,
          ms: Date.now() - started,
          reason: e && e.name === 'AbortError' ? '超时' : '连不上',
        };
      } finally {
        clearTimeout(timer);
      }
    }

    function proxyCandidates() {
      const list = [];
      const push = (v) => {
        v = String(v || '').trim().replace(/\/+$/, '');
        if (v && list.indexOf(v) < 0) list.push(v);
      };
      push(proxyBase());
      push(API_BASE);
      push('http://127.0.0.1:8799');
      push('http://localhost:8799');
      const host = location.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1') push('http://' + host + ':8799');
      return list;
    }

    async function autoDetectProxy() {
      const list = proxyCandidates();
      for (let i = 0; i < list.length; i++) {
        const r = await probeProxy(list[i]);
        if (r.ok) return list[i];
      }
      return '';
    }

    async function testConn() {
      const el2 = $('set-conn');
      const net = $('diag-net');
      if (el2) {
        el2.textContent = '检测中…';
        el2.className = '';
      }
      if (net) {
        net.textContent = '检测中…';
        net.className = '';
      }

      const r = isDirect() ? await window.RaccoonDirect.probe(8000) : await probeProxy(proxyBase());
      const ok = !!r.ok;
      const label = ok
        ? '已连接' + (r.ms ? ' · ' + r.ms + 'ms' : '')
        : r.message || r.reason || '连不上';

      if (el2) {
        el2.textContent = ok ? '已连接' : label;
        el2.className = ok ? 'conn-ok' : 'conn-bad';
      }
      if (net) {
        net.textContent = label;
        net.className = ok ? 'conn-ok' : 'conn-bad';
      }
      return ok;
    }

    function openDiag() {
      paintConn();
      const a = $('diag-auth');
      if (a) a.textContent = window.RaccoonDirect.hasAuth() ? '已登录' : '未登录';
      const err = $('diag-err');
      if (err) err.textContent = state.lastError || '—';
      openSheet('diag-sheet');
      testConn();
    }

    function applyConnChange(tip) {
      paintConn();
      toast(tip);
      hideMsg();
      refreshConnPanel();
      // 端口 / 通道变了，旧登录态不一定还能用
      window.RaccoonDirect.clearAuth();
      loadMe().then((ok) => {
        if (ok) {
          showView('chat');
          enterChat();
        } else {
          showView('login');
        }
      });
    }

    async function useProxy() {
      const input = window.prompt(
        '代理服务地址（例如 http://127.0.0.1:8799）\n留空 = 自动检测本机代理；点「取消」则不改',
        proxyBase() || ''
      );
      if (input === null) return;

      let v = input.trim().replace(/\/+$/, '');
      if (!v) {
        toast('正在检测本机代理…');
        v = await autoDetectProxy();
        if (!v) {
          toast('没找到可用的代理，保持直连');
          return;
        }
      }

      const r = await probeProxy(v);
      if (!r.ok) {
        toast(v + '：' + (r.reason || '无法使用'));
        return;
      }
      try {
        localStorage.setItem(PROXY_KEY, v);
      } catch {}
      applyConnChange('已切换到代理 ' + v);
    }

    function useDirect() {
      try {
        localStorage.removeItem(PROXY_KEY);
      } catch {}
      applyConnChange('已恢复直连');
    }

    $('row-proxy').onclick = (e) => {
      e.preventDefault();
      useProxy();
    };
    $('btn-conn-login').onclick = (e) => {
      e.preventDefault();
      openDiag();
    };
    $('btn-test-conn').onclick = (e) => {
      e.preventDefault();
      testConn();
    };
    $('diag-retest').onclick = () => testConn();
    $('diag-proxy').onclick = () => useProxy();
    $('diag-direct').onclick = () => useDirect();

    $('think-toggle').onchange = (e) => {
      state.thinking = e.target.checked;
      updateModelBar();
    };

    $('btn-send').onclick = () => (state.streaming ? stopStreaming() : send());
    $('input').addEventListener('input', () => {
      autoGrow();
      updateSend();
    });
    $('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    $('btn-voice').onclick = toggleVoice;

    $('btn-checkin').onclick = async () => {
      try {
        const d = await api('/api/checkin', { method: 'POST' });
        toast(d.message || (d.ok ? '已完成' : '失败'));
      } catch (e) {
        toast(e.message);
      }
      loadMe();
    };
    $('btn-onboarding').onclick = async () => {
      try {
        const d = await api('/api/onboarding', { method: 'POST' });
        toast(d.message || (d.ok ? '已完成' : '失败'));
      } catch (e) {
        toast(e.message);
      }
      loadMe();
    };
    $('btn-logout').onclick = () => {
      closeSheet('settings-sheet');
      logout(false);
    };
  }

  // ---------- 启动 ----------
  (async function init() {
    bind();
    $('login-proxy').textContent = connLabel();
    setupVoice();
    autoGrow();
    updateSend();

    try {
      const cfg = await api('/api/login/config');
      if (cfg && cfg.ok) {
        loginCfg = {
          captcha: cfg.captcha || loginCfg.captcha,
          nationCodes: cfg.nationCodes || loginCfg.nationCodes,
          keyRequired: !!cfg.keyRequired,
        };
      }
    } catch (e) {
      showMsg(e.message);
    }
    renderNation();

    // 本地没有 token 就别去问接口，省得开局报「未登录」
    const localAuth = window.RaccoonDirect.hasAuth() || !isDirect();
    if (localAuth) {
      try {
        const d = await api('/api/me');
        if (d && d.ok) {
          applyMe(d);
          showView('chat');
          enterChat();
          return;
        }
      } catch (e) {
        // 未登录是正常状态，不用报错；网络 / 密钥 / 配置问题才提示
        const m = (e && e.message) || '';
        if (m && !/^未登录|登录已失效/.test(m)) showMsg(m);
      }
    }
    showView('login');
  })();
})();
