// 小浣熊移动端 —— 应用逻辑
// 结构：壳（标签页/弹层）→ 会话 → 流式对话 → 能力（模型/推理/附件/提示词）
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };
  const ico = (name, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  };
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // ============================================================
  // 常量
  // ============================================================
  const DEVICE_KEY = 'raccoon.device';
  const PROXY_KEY = 'raccoon.proxy.v2';
  const CHATS_KEY = 'raccoon.chats.v1';
  const ACTIVE_KEY = 'raccoon.chat.active';
  const PREF_KEY = 'raccoon.prefs.v2';
  const SYSTEM_KEY = 'raccoon.system.v2';

  // 构建期注入的旧代理地址（可选）
  const API_BASE = '';
  const ACCESS_KEY = '';

  const APP_VERSION = '2.0.0';
  const CAPTCHA_SDK = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';

  // 推理强度阶梯（与桌面端一致）
  const EFFORTS = [
    { id: 'off', name: '关闭', desc: '不展示思考过程，响应最快' },
    { id: 'minimal', name: '极简', desc: '几乎不推理，适合闲聊' },
    { id: 'low', name: '轻量', desc: '简单问题的快速推理' },
    { id: 'medium', name: '标准', desc: '速度与质量的平衡点' },
    { id: 'high', name: '深入', desc: '多步推理，适合分析题' },
    { id: 'xhigh', name: '更深', desc: '复杂问题，耗时更长' },
    { id: 'max', name: '最强', desc: '最完整的推理，最慢' },
  ];

  const SYSTEM_PRESETS = [
    { label: '严谨技术编辑', text: '你是一名严谨的技术编辑。回答先给结论，再给依据；不确定的地方明确说出不确定，不要编造。' },
    { label: '中文润色', text: '你是一名中文写作编辑。保持原意，只改表达：去掉冗余、拆开长句、统一术语，输出润色后的文本。' },
    { label: '代码助手', text: '你是一名资深工程师。给可直接运行的代码，先说改动点，再给代码，最后说明边界与风险。' },
    { label: '结构化分析', text: '你是一名分析师。用「结论—证据—风险—下一步」四段式组织回答，能列表就不用长段落。' },
    { label: '翻译', text: '你是一名专业译者。中文与英文互译，保留原文语气与格式，专有名词首次出现时附原文。' },
  ];

  const SUGGESTIONS = [
    { icon: 'bolt', title: '深度分析一个话题', text: '请用结构化方式分析：' },
    { icon: 'edit', title: '写一段文案', text: '帮我写一段产品介绍文案，产品是：' },
    { icon: 'file', title: '总结这段内容', text: '帮我把下面的内容总结成要点：\n\n' },
    { icon: 'link', title: '拆解成可执行步骤', text: '把这个目标拆成可执行的步骤：' },
  ];

  // ============================================================
  // 状态
  // ============================================================
  const state = {
    // 壳
    tab: 'chat',
    booted: false,
    // 账号
    loggedIn: false,
    uid: '',
    name: '',
    phone: '',
    points: 0,
    verificationId: '',
    phoneForLogin: '',
    nation: '+86',
    lastError: '',
    // 模型
    models: [],
    model: '',
    effort: 'off',
    // 对话
    chats: [],
    chatId: '',
    sessionId: '',
    messages: [],
    system: '',
    streaming: false,
    abort: null,
    // 附件草稿
    attachments: [],
    // 其他
    chatFilter: '',
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

  // ============================================================
  // 本地存储
  // ============================================================
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : raw;
    } catch {
      return fallback;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {}
  }
  function lsDel(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, val) {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }

  function savePrefs() {
    writeJSON(PREF_KEY, { model: state.model, effort: state.effort, nation: state.nation });
  }
  function loadPrefs() {
    const p = readJSON(PREF_KEY, null) || {};
    if (p.model) state.model = p.model;
    if (p.effort && EFFORTS.some((e) => e.id === p.effort)) state.effort = p.effort;
    if (p.nation) state.nation = p.nation;
  }

  // ============================================================
  // 通道（直连 / 代理）
  // ============================================================
  function proxyBase() {
    return String(lsGet(PROXY_KEY, '') || '').trim().replace(/\/+$/, '');
  }
  function isDirect() {
    return !proxyBase();
  }
  function connLabel() {
    const p = proxyBase();
    if (!p) return '自动 · 直连官方';
    return '代理 · ' + p.replace(/^https?:\/\//, '');
  }

  async function api(path, opts = {}) {
    const base = proxyBase();
    let data;
    try {
      data = base ? await proxyApi(base, path, opts) : await window.RaccoonDirect.handle(path, opts);
    } catch (e) {
      if (e && e.auth === false) logout(true);
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
      throw new Error('连不上代理 ' + base + '（' + (e && e.name === 'AbortError' ? '超时' : '网络不可达') + '）');
    }

    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, message: base + ' 返回的不是小浣熊代理（HTTP ' + res.status + '）' };
      }
    }
    if (data.keyRequired) throw new Error('需要访问密钥：请在构建时填入 ACCESS_KEY');
    if (res.status === 401 && data.auth === false) {
      logout(true);
      throw new Error(data.message || '登录已失效，请重新登录');
    }
    return data;
  }

  // ============================================================
  // 壳：标签页 / 弹层 / Toast
  // ============================================================
  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const v = $(name + '-view');
    if (v) v.classList.add('active');
  }

  function setTab(name) {
    state.tab = name;
    document.querySelectorAll('.pane').forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-pane') === name);
    });
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'history') renderChatList();
    if (name === 'me') paintMe();
    if (name === 'chat') requestAnimationFrame(() => scrollBottom(true));
  }

  const sheetStack = [];
  function openSheet(id) {
    const s = $(id);
    if (!s) return;
    s.classList.remove('hidden');
    if (sheetStack.indexOf(id) < 0) sheetStack.push(id);
  }
  function closeSheet(id) {
    const s = $(id);
    if (!s) return;
    s.classList.add('hidden');
    const i = sheetStack.indexOf(id);
    if (i >= 0) sheetStack.splice(i, 1);
  }
  function closeTopSheet() {
    const id = sheetStack[sheetStack.length - 1];
    if (id) closeSheet(id);
    return !!id;
  }

  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function haptic() {
    try {
      if (navigator.vibrate) navigator.vibrate(8);
    } catch {}
  }

  // ============================================================
  // 输入区高度 / 键盘
  // ============================================================
  function autoGrow() {
    const ta = $('input');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight || 0, 132) + 'px';
  }

  // ============================================================
  // 登录
  // ============================================================
  function showMsg(text) {
    const box = $('login-msg');
    box.textContent = text;
    box.classList.toggle('info', /^未登录/.test(text));
    box.classList.remove('hidden');
  }
  function hideMsg() {
    $('login-msg').classList.add('hidden');
  }

  let captchaLoader = null;
  let capRunning = null;

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
                const wait = Math.max(0, 1200 - (Date.now() - startedAt));
                setTimeout(async () => {
                  if (settled) return;
                  try {
                    if (inst && typeof inst.show === 'function') await inst.show();
                    else $('cap-button').click();
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

    capRunning
      .then(() => {
        capRunning = null;
      })
      .catch(() => {});

    return capRunning;
  }

  function renderNation() {
    const sel = $('nation');
    sel.innerHTML = '';
    const list =
      loginCfg.nationCodes && loginCfg.nationCodes.length
        ? loginCfg.nationCodes
        : [{ code: '+86', label: '中国大陆' }];
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
    let left = clamp(Math.round(sec) || 60, 1, 300);
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
        btn.textContent = '获取验证码';
        const msg = d.message || '验证码发送失败';
        state.lastError = msg + (d.code ? '（' + d.code + '）' : '');
        if (/人机验证/.test(msg)) return showMsg(msg + '，请再点一次「获取验证码」重试');
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
      btn.textContent = '获取验证码';
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

  function onLoginSuccess() {
    hideMsg();
    $('token-panel').classList.add('hidden');
    showView('app');
    setTab('chat');
    enterApp();
  }

  function logout(silent) {
    state.loggedIn = false;
    if (window.RaccoonDirect) window.RaccoonDirect.clearAuth();
    stopStreaming();
    state.messages = [];
    state.model = '';
    state.verificationId = '';
    state.sessionId = '';
    state.chats = [];
    state.chatId = '';
    state.attachments = [];
    const box = $('messages');
    if (box) box.innerHTML = '';
    $('status-dot').classList.remove('on');
    clearInterval(countdownTimer);
    const sendBtn = $('btn-send-code');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = '获取验证码';
    }
    $('code').value = '';
    showView('login');
    if (!silent) {
      api('/api/logout', { method: 'POST' }).catch(() => {});
      toast('已退出登录');
    }
  }

  // ============================================================
  // 账号
  // ============================================================
  function applyMe(d) {
    state.loggedIn = true;
    state.uid = d.uid || '';
    state.name = d.name || '小浣熊';
    state.phone = d.phone || '';
    state.points = d.points || 0;
    paintMe();
    const dot = $('status-dot');
    if (dot) dot.classList.add('on');
    const pb = $('points-badge');
    if (pb) pb.textContent = String(state.points);
  }

  async function loadMe() {
    try {
      const d = await api('/api/me');
      if (d.ok) applyMe(d);
      return d.ok;
    } catch {
      return false;
    }
  }

  function paintMe() {
    const name = state.name || '小浣熊';
    const set = (id, v) => {
      const e = $(id);
      if (e) e.textContent = v;
    };
    set('me-name', name);
    set('me-phone', state.phone || '—');
    set('set-points', String(state.points ?? '—'));
    set('set-chat-count', String(state.chats.length || 0));
    const m = currentModel();
    set('set-model-short', m ? shortModelName(m) : '—');
    // 行标签已经是「深度思考」，值只显示档位，避免读成「深度思考 深度思考 · 标准」
    set('set-think', reasoningSupported() ? (EFFORTS.find((x) => x.id === state.effort) || {}).name || '关闭' : '不支持');
    set('appbar-title', name);
    const t = $('set-system');
    if (t) t.textContent = state.system ? (state.system.length > 12 ? state.system.slice(0, 12) + '…' : state.system) : '未设置';
    const mode = $('set-mode');
    if (mode) mode.textContent = connLabel();
    const note = $('build-note');
    if (note) note.textContent = '小浣熊移动端 v' + APP_VERSION;
  }

  // ============================================================
  // 模型与推理
  // ============================================================
  function currentModel() {
    return state.models.find((m) => m.id === state.model) || null;
  }
  function shortModelName(m) {
    const n = String((m && m.name) || '').trim();
    return n.length > 14 ? n.slice(0, 14) + '…' : n || '默认';
  }
  function reasoningSupported() {
    const m = currentModel();
    return !!(m && m.supportsReasoning === true);
  }
  function visionSupported() {
    const m = currentModel();
    return !!(m && m.supportsImages === true);
  }
  function effortName() {
    if (!reasoningSupported()) return '当前模型不支持';
    const e = EFFORTS.find((x) => x.id === state.effort);
    return e && e.id !== 'off' ? '深度思考 · ' + e.name : '深度思考 · 关闭';
  }
  // 药丸上的短标签：把状态说清楚，而不是只说「深度思考」
  function effortChipLabel() {
    if (!reasoningSupported()) return '不支持推理';
    const e = EFFORTS.find((x) => x.id === state.effort);
    if (!e || e.id === 'off') return '思考 · 关';
    return '思考 · ' + e.name;
  }

  // 模型归一化：直连通道给的是 {id,name,contextLength,supportsImages,supportsReasoning}，
  // 官方原始结构是 {name,display_name,context_window,supports_reasoning}。
  // 两种形状都接受，避免代理版本不一致时模型列表变成一串裸 id。
  function normalizeModel(raw) {
    if (!raw) return null;
    const id = raw.id || raw.name || raw.model || raw.model_name || '';
    if (!id) return null;
    let imgs = raw.supportsImages;
    if (imgs == null) imgs = raw.supportImage;
    if (imgs == null && Array.isArray(raw.tags)) {
      imgs = raw.tags.some((t) => /image|vision/i.test(String(t)));
    }
    let reason = raw.supportsReasoning;
    if (reason == null) reason = raw.supports_reasoning;
    if (reason == null && Array.isArray(raw.tags)) {
      reason = raw.tags.some((t) => /reason|think/i.test(String(t)));
    }
    const ctx = raw.contextLength || raw.context_window || (raw.params && raw.params.context_window) || 0;
    const label =
      raw.displayName ||
      raw.display_name ||
      (raw.description ? String(raw.description).slice(0, 48) : '') ||
      (raw.name && raw.name !== id ? raw.name : '') ||
      id;
    return {
      id: String(id),
      name: String(label),
      contextLength: Number(ctx) || 0,
      supportsImages: !!imgs,
      supportsReasoning: !!reason,
    };
  }

  async function loadCatalog() {
    try {
      const d = await api('/api/catalog');
      if (d.ok && Array.isArray(d.models)) {
        const seen = new Set();
        const list = [];
        d.models.forEach((raw) => {
          const m = normalizeModel(raw);
          if (!m || seen.has(m.id)) return;
          seen.add(m.id);
          list.push(m);
        });
        state.models = list;
        if (!state.model || !state.models.some((m) => m.id === state.model)) {
          state.model = state.models.length ? state.models[0].id : '';
        }
        renderModelList();
        paintModelBar();
        paintMe();
      }
    } catch {}
  }

  function paintModelBar() {
    const m = currentModel();
    const v = $('model-name-val');
    if (v) v.textContent = m ? shortModelName(m) : '默认模型';
    const chip = $('effort-chip');
    const lab = $('effort-label');
    const ok = reasoningSupported();
    if (chip) {
      chip.classList.toggle('on', ok && state.effort !== 'off');
      chip.disabled = !ok;
      chip.setAttribute('aria-disabled', ok ? 'false' : 'true');
    }
    if (lab) lab.textContent = effortChipLabel();
    if (chip) chip.setAttribute('aria-label', '深度思考：' + effortName().replace('深度思考 · ', ''));
  }

  function modelGroupOf(m) {
    const id = String(m.id || '').toLowerCase();
    if (m.supportsImages) return '支持识图';
    if (m.supportsReasoning) return '支持推理';
    if (/embed|rerank/.test(id)) return '其他';
    return '通用对话';
  }

  function renderModelList() {
    const box = $('model-list');
    if (!box) return;
    box.innerHTML = '';
    if (!state.models.length) {
      box.innerHTML = '<p class="sheet-tip">暂无可用模型，请检查网络后重试。</p>';
      return;
    }
    const groups = new Map();
    state.models.forEach((m) => {
      const g = modelGroupOf(m);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    });
    // 稳定顺序
    const order = ['支持识图', '支持推理', '通用对话', '其他'];
    [...groups.keys()]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .forEach((g) => {
        const title = el('div', 'model-group-title');
        title.textContent = g;
        box.appendChild(title);

        groups.get(g).forEach((m) => {
          const row = el('div', 'model-item' + (m.id === state.model ? ' active' : ''));
          row.setAttribute('role', 'button');
          row.tabIndex = 0;

          const main = el('div', 'mi-main');
          const nm = el('div', 'mi-name');
          nm.appendChild(document.createTextNode(m.name || m.id));
          if (m.supportsReasoning) nm.appendChild(ico('bolt'));
          main.appendChild(nm);

          const meta = el('div', 'mi-meta');
          if (m.contextLength) {
            const b = el('span', 'mi-badge');
            b.textContent = fmtContext(m.contextLength);
            meta.appendChild(b);
          }
          if (m.supportsImages) {
            const b = el('span', 'mi-badge');
            b.textContent = '识图';
            meta.appendChild(b);
          }
          if (m.supportsReasoning) {
            const b = el('span', 'mi-badge');
            b.textContent = '推理';
            meta.appendChild(b);
          }
          if (!meta.childNodes.length) {
            const b = el('span', 'mi-badge');
            b.textContent = '对话';
            meta.appendChild(b);
          }
          main.appendChild(meta);
          row.appendChild(main);

          if (m.id === state.model) {
            const c = el('span', 'mi-check');
            c.appendChild(ico('check'));
            row.appendChild(c);
          }

          const pick = () => {
            state.model = m.id;
            savePrefs();
            paintModelBar();
            paintMe();
            renderModelList();
            closeSheet('model-sheet');
            haptic();
          };
          row.onclick = pick;
          row.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pick();
            }
          };
          box.appendChild(row);
        });
      });
  }

  function fmtContext(n) {
    const v = Number(n);
    if (!v) return '';
    if (v >= 1000000) return Math.round(v / 100000) / 10 + 'M';
    if (v >= 1000) return Math.round(v / 1000) + 'K';
    return String(v);
  }

  function renderEffortList() {
    const box = $('effort-list');
    if (!box) return;
    box.innerHTML = '';

    if (!reasoningSupported()) {
      box.innerHTML = '<p class="sheet-tip">当前模型不提供推理强度设置。换一个带「推理」标记的模型即可开启深度思考。</p>';
      return;
    }

    EFFORTS.forEach((e) => {
      const row = el('div', 'effort-item' + (e.id === state.effort ? ' active' : ''));
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const main = el('div', 'effort-main');
      const nm = el('div', 'effort-name');
      nm.textContent = e.name;
      const ds = el('div', 'effort-desc');
      ds.textContent = e.desc;
      main.appendChild(nm);
      main.appendChild(ds);
      row.appendChild(main);
      if (e.id === state.effort) {
        const c = el('span', 'mi-check');
        c.appendChild(ico('check'));
        row.appendChild(c);
      }
      const pick = () => {
        state.effort = e.id;
        savePrefs();
        paintModelBar();
        paintMe();
        renderEffortList();
        closeSheet('effort-sheet');
        haptic();
      };
      row.onclick = pick;
      row.onkeydown = (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          pick();
        }
      };
      box.appendChild(row);
    });
  }

  // ============================================================
  // 附件
  // ============================================================
  const MAX_IMAGE_EDGE = 1400;
  const MAX_TEXT_BYTES = 200 * 1024;
  const MAX_IMAGES = 6;

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读取失败'));
      fr.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读取失败'));
      fr.readAsText(file);
    });
  }

  // 压缩到合理尺寸，避免 base64 撑爆请求
  async function compressImage(file) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('图片解码失败'));
      i.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, tw, th);
    let out = dataUrl;
    try {
      out = canvas.toDataURL('image/jpeg', 0.86);
    } catch {
      out = dataUrl;
    }
    return { dataUrl: out, w: tw, h: th };
  }

  async function addImageFiles(files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) return;

    if (!visionSupported()) {
      toast('当前模型不支持识图，请先切换到支持识图的模型');
      return;
    }
    const room = MAX_IMAGES - state.attachments.filter((a) => a.type === 'image').length;
    if (room <= 0) {
      toast('一次最多 ' + MAX_IMAGES + ' 张图片');
      return;
    }

    for (const f of list.slice(0, room)) {
      try {
        const c = await compressImage(f);
        state.attachments.push({ type: 'image', name: f.name || '图片', dataUrl: c.dataUrl, w: c.w, h: c.h });
      } catch {
        toast('有一张图片读取失败');
      }
    }
    paintAttachments();
    updateSendState();
  }

  async function addDocFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (const f of list) {
      if (f.size > MAX_TEXT_BYTES) {
        toast(f.name + ' 超过 200KB，请换更小的文件');
        continue;
      }
      try {
        const text = await readFileAsText(f);
        state.attachments.push({ type: 'text', name: f.name || '文本', text });
      } catch {
        toast(f.name + ' 读取失败');
      }
    }
    paintAttachments();
    updateSendState();
  }

  function removeAttachment(idx) {
    state.attachments.splice(idx, 1);
    paintAttachments();
    updateSendState();
  }

  function paintAttachments() {
    const tray = $('attachment-tray');
    if (!tray) return;
    tray.innerHTML = '';
    if (!state.attachments.length) {
      tray.classList.add('hidden');
      return;
    }
    tray.classList.remove('hidden');
    state.attachments.forEach((a, i) => {
      const chip = el('div', 'attach-chip');
      if (a.type === 'image') {
        const img = el('img');
        img.src = a.dataUrl;
        img.alt = a.name;
        chip.appendChild(img);
      } else {
        const box = el('div', 'file-ico');
        box.appendChild(ico('file'));
        chip.appendChild(box);
      }
      const nm = el('div', 'name');
      nm.textContent = a.type === 'text' ? a.name : '图片';
      chip.appendChild(nm);

      const rm = el('button', 'rm');
      rm.type = 'button';
      rm.setAttribute('aria-label', '移除 ' + a.name);
      rm.appendChild(ico('close'));
      rm.onclick = () => removeAttachment(i);
      chip.appendChild(rm);
      tray.appendChild(chip);
    });
  }

  // ============================================================
  // 消息渲染
  // ============================================================
  function scrollBox() {
    return $('messages');
  }
  function isNearBottom(slack) {
    const box = scrollBox();
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < (slack || 160);
  }
  function scrollBottom(force) {
    const box = scrollBox();
    if (!box) return;
    if (force || isNearBottom()) box.scrollTop = box.scrollHeight;
    updateScrollButton();
  }
  function updateScrollButton() {
    const btn = $('btn-scroll-bottom');
    if (!btn) return;
    btn.classList.toggle('hidden', isNearBottom(120));
  }

  function buildEmpty() {
    const wrap = el('div', 'empty');
    wrap.innerHTML =
      '<div class="empty-mark">' +
      '<svg viewBox="0 0 48 48" fill="none">' +
      '<ellipse cx="24" cy="26.5" rx="15.4" ry="14" fill="#151515" stroke="#2a2a2a" stroke-width="1"/>' +
      '<circle cx="11.6" cy="15.2" r="6" fill="#1b1b1b" stroke="#2a2a2a" stroke-width="1"/>' +
      '<circle cx="36.4" cy="15.2" r="6" fill="#1b1b1b" stroke="#2a2a2a" stroke-width="1"/>' +
      '<path d="M9.8 23.6c0-3.6 3.3-6.1 7.4-6.1 3.8 0 6.3 2.5 6.3 5.9 0 3.5-2.9 6.2-6.7 6.2-4.1 0-7-2.4-7-6z" fill="#000"/>' +
      '<path d="M38.2 23.6c0-3.6-3.3-6.1-7.4-6.1-3.8 0-6.3 2.5-6.3 5.9 0 3.5 2.9 6.2 6.7 6.2 4.1 0 7-2.4 7-6z" fill="#000"/>' +
      '<circle cx="17.2" cy="24" r="2.1" fill="#f59e0b"/>' +
      '<circle cx="30.8" cy="24" r="2.1" fill="#f59e0b"/>' +
      '<path d="M24 29.8l-2.2 2h4.4z" fill="#f59e0b"/>' +
      '</svg></div>' +
      '<h2>开始对话</h2>' +
      '<p>提问、拍照、或丢一段文本进来</p>' +
      '<div class="suggest"></div>';

    const box = wrap.querySelector('.suggest');
    SUGGESTIONS.forEach((s) => {
      const item = el('button', 'suggest-item');
      item.type = 'button';
      item.appendChild(ico(s.icon));
      item.appendChild(document.createTextNode(s.title));
      const em = el('em');
      em.textContent = '填入';
      item.appendChild(em);
      item.onclick = () => {
        const ta = $('input');
        ta.value = s.text;
        autoGrow();
        updateSendState();
        ta.focus();
        // 光标放末尾
        try {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        } catch {}
      };
      box.appendChild(item);
    });
    return wrap;
  }

  // 为一条消息建立 DOM（只建一次）
  function createRow(m) {
    const row = el('div', 'msg ' + (m.role === 'user' ? 'msg-user' : 'msg-ai'));

    if (m.role === 'user') {
      if (m.attachments && m.attachments.length) {
        const wrap = el('div', 'msg-attachments');
        m.attachments.forEach((a) => {
          if (a.type === 'image') {
            const img = el('img');
            img.src = a.dataUrl;
            img.alt = a.name || '图片';
            wrap.appendChild(img);
          }
        });
        if (wrap.childNodes.length) row.appendChild(wrap);
      }
      const bubble = el('div', 'bubble bubble-text');
      bubble.textContent = m.content || '';
      row.appendChild(bubble);
      m.ui = {
        el: row,
        render() {
          if (bubble.textContent !== (m.content || '')) bubble.textContent = m.content || '';
        },
      };
      return row;
    }

    // 助手
    const answer = el('div', 'answer');

    const reasoning = el('details', 'reasoning');
    reasoning.hidden = true;
    const sum = el('summary');
    sum.appendChild(ico('bolt'));
    const sumText = el('span');
    sumText.textContent = '思考过程';
    sum.appendChild(sumText);
    const rBody = el('div', 'reasoning-body');
    reasoning.appendChild(sum);
    reasoning.appendChild(rBody);
    answer.appendChild(reasoning);

    const pending = el('div', 'pending');
    pending.innerHTML = '<i></i><i></i><i></i>';
    answer.appendChild(pending);

    const body = el('div', 'answer-body md');
    answer.appendChild(body);

    const errBox = el('div', 'inline-error');
    errBox.hidden = true;
    answer.appendChild(errBox);

    row.appendChild(answer);

    const actions = el('div', 'msg-actions');
    const bCopy = el('button');
    bCopy.type = 'button';
    bCopy.appendChild(ico('copy'));
    bCopy.appendChild(document.createTextNode('复制'));
    bCopy.onclick = () => copyText(m.content, '已复制');
    actions.appendChild(bCopy);

    const bRetry = el('button');
    bRetry.type = 'button';
    bRetry.appendChild(ico('refresh'));
    bRetry.appendChild(document.createTextNode('重试'));
    bRetry.onclick = () => retryFrom(m);
    actions.appendChild(bRetry);

    const meta = el('span', 'msg-meta');
    actions.appendChild(meta);
    row.appendChild(actions);

    let mdAt = 0;
    let mdLen = -1;

    const render = (final) => {
      const hasR = !!(m.reasoning && m.reasoning.length);
      reasoning.hidden = !hasR;
      if (hasR) {
        if (rBody.textContent !== m.reasoning) rBody.textContent = m.reasoning;
        if (m.streaming && !m._openedReasoning) {
          m._openedReasoning = true;
          reasoning.open = true;
        }
        if (!m.streaming && m._openedReasoning) {
          reasoning.open = false;
          m._openedReasoning = false;
        }
      }

      const text = m.content || '';
      const now = Date.now();
      const grown = text.length - mdLen;
      // 流式时控频：有实质增长或到时间才重解析 Markdown
      if (final || mdLen < 0 || (grown >= 24 && now - mdAt >= 110) || (grown > 0 && now - mdAt >= 240)) {
        mdAt = now;
        mdLen = text.length;
        body.innerHTML = text ? window.MD.render(text) : '';
        body.classList.toggle('cursor', !!m.streaming && !!text);
      } else if (!text) {
        body.innerHTML = '';
        body.classList.remove('cursor');
      }

      pending.classList.toggle('hidden', !(m.streaming && !text));
      pending.style.display = m.streaming && !text ? 'flex' : 'none';

      if (m.error) {
        errBox.hidden = false;
        errBox.textContent = m.error;
      } else {
        errBox.hidden = true;
      }

      row.classList.toggle('streaming', !!m.streaming);
      actions.classList.toggle('hidden', !!m.streaming || (!text && !m.error));

      if (m.usage && (m.usage.prompt_tokens || m.usage.completion_tokens)) {
        const total = m.usage.total_tokens || (m.usage.prompt_tokens || 0) + (m.usage.completion_tokens || 0);
        meta.textContent = total ? total + ' tokens' : '';
      } else {
        meta.textContent = '';
      }
    };

    m.ui = { el: row, render };
    render(true);
    return row;
  }

  let rafPending = null;
  function scheduleRender(m) {
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = null;
      if (m && m.ui) m.ui.render(false);
      scrollBottom(false);
    });
  }

  function clearThread() {
    const box = scrollBox();
    if (box) box.innerHTML = '';
  }

  function rebuildThread() {
    const box = scrollBox();
    if (!box) return;
    box.innerHTML = '';
    if (!state.messages.length) {
      box.appendChild(buildEmpty());
      updateScrollButton();
      return;
    }
    const frag = document.createDocumentFragment();
    state.messages.forEach((m) => {
      m.ui = null;
      frag.appendChild(createRow(m));
    });
    box.appendChild(frag);
    scrollBottom(true);
  }

  function appendRow(m) {
    const box = scrollBox();
    if (!box) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    box.appendChild(m.ui ? m.ui.el : createRow(m));
  }

  // ============================================================
  // 消息 → API 载荷
  // ============================================================
  function composeUserPayload(m) {
    const imgs = (m.attachments || []).filter((a) => a.type === 'image');
    let text = m.content || '';
    const docs = (m.attachments || []).filter((a) => a.type === 'text');
    if (docs.length) {
      const parts = docs.map((d) => '【文件：' + d.name + '】\n' + String(d.text || '').slice(0, 40000));
      text = (text ? text + '\n\n' : '') + parts.join('\n\n');
    }
    if (!imgs.length) return { role: 'user', content: text };
    const blocks = [{ type: 'text', text: text || '请看下面的图片' }];
    imgs.forEach((a) => blocks.push({ type: 'image_url', image_url: { url: a.dataUrl } }));
    return { role: 'user', content: blocks };
  }

  function buildApiMessages() {
    const out = [];
    if (state.system && state.system.trim()) out.push({ role: 'system', content: state.system.trim() });
    state.messages.forEach((m) => {
      if (!m.content && !(m.attachments && m.attachments.length)) return;
      if (m.role === 'user') out.push(composeUserPayload(m));
      else if (m.content) out.push({ role: 'assistant', content: m.content });
    });
    return out;
  }

  // ============================================================
  // 发送与流式
  // ============================================================
  function stopStreaming() {
    if (state.abort) {
      try {
        state.abort.abort();
      } catch {}
    }
  }

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
          ai.error = frame.error.message || '上游返回错误';
          continue;
        }
        if (frame.usage) ai.usage = frame.usage;
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

  function updateSendState() {
    const btn = $('btn-send');
    if (!btn) return;
    const streaming = state.streaming;
    const ta = $('input');
    const hasText = !!(ta && ta.value.trim());
    const hasAttach = state.attachments.length > 0;
    btn.classList.toggle('streaming', streaming);
    btn.querySelector('.ico-send').classList.toggle('hidden', streaming);
    btn.querySelector('.ico-stop').classList.toggle('hidden', !streaming);
    btn.disabled = streaming ? false : !(hasText || hasAttach);
    btn.setAttribute('aria-label', streaming ? '停止生成' : '发送');
  }

  async function send() {
    if (state.streaming) return;
    const ta = $('input');
    const text = ta.value.trim();
    const attachments = state.attachments.slice();
    if (!text && !attachments.length) return;

    if (!state.model) {
      toast('还没有可用模型，请稍后重试');
      return;
    }

    const userMsg = { role: 'user', content: text, attachments };
    state.messages.push(userMsg);
    ta.value = '';
    state.attachments = [];
    paintAttachments();
    autoGrow();
    rebuildThread();
    updateSendState();

    const ai = {
      role: 'ai',
      content: '',
      reasoning: '',
      streaming: true,
      error: '',
      usage: null,
      attachments: [],
    };
    state.messages.push(ai);
    appendRow(ai);

    state.streaming = true;
    state.abort = new AbortController();
    updateSendState();
    scrollBottom(true);

    const body = {
      model: state.model,
      messages: buildApiMessages(),
      stream: true,
      max_tokens: 80000,
      reasoning_effort: reasoningSupported() ? state.effort : 'off',
    };

    let aborted = false;

    try {
      if (isDirect()) {
        await window.RaccoonDirect.chat(
          { ...body, sessionId: state.sessionId, signal: state.abort.signal },
          {
            onDelta: (d) => {
              if (d.error) ai.error = (ai.error ? ai.error + ' ' : '') + d.error;
              else {
                if (d.content) ai.content += d.content;
                if (d.reasoning) ai.reasoning += d.reasoning;
              }
              scheduleRender(ai);
            },
            onUsage: (u) => {
              if (u) ai.usage = u;
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
          msg = isDirect() ? '连不上官方服务，请检查网络' : '连不上代理 ' + proxyBase();
        }
        if (e && e.auth === false) msg = '登录已失效，请重新登录';
        ai.error = msg;
        if (!ai.content) ai.content = '';
      }
    } finally {
      ai.streaming = false;
      state.streaming = false;
      state.abort = null;
      if (ai.ui) ai.ui.render(true);
      scrollBottom(false);
      updateSendState();
      syncCurrent();
      if (!aborted && (ai.content || ai.reasoning)) loadMe();
    }
  }

  function retryFrom(m) {
    if (state.streaming) return;
    const idx = state.messages.indexOf(m);
    if (idx < 0) return;
    let ui = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') {
        ui = i;
        break;
      }
    }
    if (ui < 0) return;
    const prev = state.messages[ui];
    const text = prev.content;
    const attachments = prev.attachments || [];
    state.messages = state.messages.slice(0, ui);
    rebuildThread();
    syncCurrent();
    const ta = $('input');
    ta.value = text || '';
    state.attachments = attachments.slice();
    paintAttachments();
    autoGrow();
    updateSendState();
    send();
  }

  // ============================================================
  // 复制 / 导出 / 分享
  // ============================================================
  function copyText(text, tip) {
    const s = String(text || '');
    if (!s) return;
    const done = () => toast(tip || '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done).catch(() => fallbackCopy(s, done));
    } else {
      fallbackCopy(s, done);
    }
  }

  function fallbackCopy(s, done) {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      toast('复制失败');
    }
    ta.remove();
  }

  function buildMarkdown() {
    const cur = state.chats.find((c) => c.id === state.chatId);
    let md = '# ' + ((cur && cur.title) || '对话') + '\n\n';
    md += '_导出自小浣熊移动端 · ' + new Date().toLocaleString('zh-CN') + '_\n\n';
    state.messages.forEach((m) => {
      const who = m.role === 'user' ? '**我**' : '**小浣熊**';
      let body = m.content || '';
      const docs = (m.attachments || []).filter((a) => a.type === 'text');
      if (docs.length) body += '\n\n' + docs.map((d) => '> 附件：' + d.name).join('\n');
      const imgs = (m.attachments || []).filter((a) => a.type === 'image');
      if (imgs.length) body += '\n\n' + imgs.map(() => '> [图片]').join('\n');
      md += who + '\n\n' + body + '\n\n---\n\n';
    });
    return md;
  }

  function exportCurrent() {
    if (!state.messages.length) return toast('当前对话是空的');
    const md = buildMarkdown();
    if (navigator.share) {
      navigator
        .share({ title: '小浣熊对话', text: md })
        .then(() => toast('已分享'))
        .catch(() => copyText(md, '已复制为 Markdown'));
      return;
    }
    copyText(md, '已复制为 Markdown');
  }

  // ============================================================
  // 多会话
  // ============================================================
  function newChatId() {
    return window.RaccoonDirect.newSessionId();
  }

  function loadChats() {
    let list = readJSON(CHATS_KEY, []);
    if (!Array.isArray(list)) list = [];
    state.chats = list
      .filter((c) => c && c.id)
      .map((c) => ({
        id: c.id,
        title: c.title || '新对话',
        messages: Array.isArray(c.messages) ? c.messages : [],
        system: c.system || '',
        pinned: !!c.pinned,
        updatedAt: c.updatedAt || 0,
      }))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

    let active = lsGet(ACTIVE_KEY, '');
    if (!state.chats.some((c) => c.id === active)) {
      active = state.chats[0] ? state.chats[0].id : '';
    }
    if (!active) {
      active = newChatId();
      state.chats.unshift({ id: active, title: '新对话', messages: [], system: '', pinned: false, updatedAt: Date.now() });
    }
    state.chatId = active;
    state.sessionId = active;
    hydrateCurrent();
    saveChats();
  }

  function hydrateCurrent() {
    const cur = state.chats.find((c) => c.id === state.chatId);
    state.messages = ((cur && cur.messages) || []).map((m) => ({
      role: m.role,
      content: m.content || '',
      reasoning: m.reasoning || '',
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      usage: m.usage || null,
      error: '',
      streaming: false,
    }));
    state.system = (cur && cur.system) || '';
  }

  function saveChats() {
    const slim = state.chats.slice(0, 80).map((c) => ({
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      updatedAt: c.updatedAt,
      system: c.system || '',
      messages: (c.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        reasoning: m.reasoning || '',
        // 图片 base64 太大，不落盘；文本附件保留
        attachments: (m.attachments || []).filter((a) => a.type === 'text'),
        usage: m.usage || null,
      })),
    }));
    writeJSON(CHATS_KEY, slim);
    lsSet(ACTIVE_KEY, state.chatId || '');
  }

  function syncCurrent() {
    const cur = state.chats.find((c) => c.id === state.chatId);
    if (!cur) return;
    cur.messages = state.messages.map((m) => ({
      role: m.role,
      content: m.content,
      reasoning: m.reasoning || '',
      attachments: (m.attachments || []).filter((a) => a.type === 'text'),
      usage: m.usage || null,
    }));
    cur.system = state.system || '';
    const first = cur.messages.find((m) => m.role === 'user');
    if (first) {
      const src = String(first.content || '').replace(/\s+/g, ' ').trim();
      cur.title = src ? src.slice(0, 28) : '图片对话';
    }
    cur.updatedAt = Date.now();
    saveChats();
  }

  function newChat() {
    if (state.streaming) stopStreaming();
    syncCurrent();
    const id = newChatId();
    state.chats.unshift({ id, title: '新对话', messages: [], system: '', pinned: false, updatedAt: Date.now() });
    state.chatId = id;
    state.sessionId = id;
    state.messages = [];
    state.system = '';
    state.attachments = [];
    paintAttachments();
    saveChats();
    rebuildThread();
    setTab('chat');
    paintMe();
    updateSendState();
    setTimeout(() => $('input').focus(), 60);
  }

  function switchChat(id) {
    if (id === state.chatId) return;
    if (state.streaming) stopStreaming();
    syncCurrent();
    state.chatId = id;
    state.sessionId = id;
    state.attachments = [];
    paintAttachments();
    hydrateCurrent();
    saveChats();
    rebuildThread();
    setTab('chat');
    paintMe();
    updateSendState();
  }

  function deleteChat(id) {
    if (state.streaming && id === state.chatId) stopStreaming();
    state.chats = state.chats.filter((c) => c.id !== id);
    if (!state.chats.length) {
      saveChats();
      newChat();
      renderChatList();
      return;
    }
    if (state.chatId === id) {
      state.chatId = state.chats[0].id;
      state.sessionId = state.chatId;
      hydrateCurrent();
      rebuildThread();
    }
    saveChats();
    renderChatList();
    paintMe();
  }

  function renameChat(id) {
    const cur = state.chats.find((c) => c.id === id);
    if (!cur) return;
    const v = window.prompt('重命名对话', cur.title || '');
    if (v === null) return;
    const t = v.trim();
    if (!t) return;
    cur.title = t.slice(0, 40);
    saveChats();
    renderChatList();
  }

  function togglePin(id) {
    const cur = state.chats.find((c) => c.id === id);
    if (!cur) return;
    cur.pinned = !cur.pinned;
    state.chats.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
    saveChats();
    renderChatList();
    haptic();
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return hh + ':' + mm;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hh + ':' + mm;
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
  }

  function renderChatList() {
    const box = $('chat-list');
    if (!box) return;
    box.innerHTML = '';
    const q = state.chatFilter.trim().toLowerCase();
    const list = q
      ? state.chats.filter((c) => {
          const t = String(c.title || '').toLowerCase();
          if (t.indexOf(q) >= 0) return true;
          return (c.messages || []).some((m) => String(m.content || '').toLowerCase().indexOf(q) >= 0);
        })
      : state.chats;

    if (!list.length) {
      const p = el('p', 'sheet-tip');
      p.textContent = q ? '没有匹配的对话' : '还没有对话';
      box.appendChild(p);
      return;
    }

    list.forEach((c) => {
      const row = el('div', 'chat-row' + (c.id === state.chatId ? ' active' : ''));
      row.setAttribute('role', 'button');
      row.tabIndex = 0;

      const main = el('div', 'ci-main');
      const title = el('div', 'ci-title');
      if (c.id === state.chatId) {
        const d = el('span', 'live-dot');
        title.appendChild(d);
      }
      const tt = el('span');
      tt.textContent = c.title || '新对话';
      title.appendChild(tt);
      main.appendChild(title);

      const meta = el('div', 'ci-meta');
      if (c.pinned) {
        const p = el('span', 'pin-mark');
        p.appendChild(ico('pin'));
        meta.appendChild(p);
      }
      const cnt = (c.messages || []).filter((m) => m.role === 'user').length;
      meta.appendChild(document.createTextNode(cnt + ' 问 · ' + fmtTime(c.updatedAt)));
      main.appendChild(meta);
      row.appendChild(main);

      const more = el('button', 'ci-more');
      more.type = 'button';
      more.setAttribute('aria-label', '更多操作');
      more.appendChild(ico('sliders'));
      more.onclick = (e) => {
        e.stopPropagation();
        chatActions(c);
      };
      row.appendChild(more);

      row.onclick = () => switchChat(c.id);
      row.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchChat(c.id);
        }
      };
      box.appendChild(row);
    });
  }

  function chatActions(c) {
    const opts = [c.pinned ? '取消置顶' : '置顶', '重命名', '删除'];
    const pick = window.prompt(
      '「' + (c.title || '新对话') + '」\n1. ' + opts[0] + '\n2. ' + opts[1] + '\n3. ' + opts[2] + '\n\n输入序号：',
      '1'
    );
    if (pick === null) return;
    const n = String(pick).trim();
    if (n === '1') togglePin(c.id);
    else if (n === '2') renameChat(c.id);
    else if (n === '3') {
      if (window.confirm('删除「' + (c.title || '新对话') + '」？此操作不可恢复。')) deleteChat(c.id);
    }
  }

  // ============================================================
  // 系统提示词
  // ============================================================
  function paintSystem() {
    const box = $('set-system');
    if (!box) return;
    const v = state.system || '';
    box.textContent = v ? (v.length > 12 ? v.slice(0, 12) + '…' : v) : '未设置';
  }

  function renderPresets() {
    const box = $('preset-list');
    if (!box) return;
    box.innerHTML = '';
    SYSTEM_PRESETS.forEach((p) => {
      const b = el('button', 'preset');
      b.type = 'button';
      b.textContent = p.label;
      b.onclick = () => {
        $('system-input').value = p.text;
        haptic();
      };
      box.appendChild(b);
    });
  }

  function openSystemSheet() {
    $('system-input').value = state.system || '';
    renderPresets();
    openSheet('system-sheet');
  }

  function saveSystem() {
    state.system = $('system-input').value.trim().slice(0, 4000);
    syncCurrent();
    paintSystem();
    paintMe();
    closeSheet('system-sheet');
    toast(state.system ? '已设置系统提示词' : '已清除系统提示词');
    // 记住最近使用，供下次新建对话参考（不自动套用）
    if (state.system) lsSet(SYSTEM_KEY, state.system);
  }

  // ============================================================
  // 连接诊断
  // ============================================================
  function paintConn() {
    const mode = connLabel();
    const pairs = [
      ['login-proxy', mode],
      ['set-mode', mode],
      ['diag-mode', mode],
    ];
    pairs.forEach(([id, v]) => {
      const e = $(id);
      if (e) e.textContent = v;
    });
  }

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
      return { ok: false, ms: Date.now() - started, reason: e && e.name === 'AbortError' ? '超时' : '连不上' };
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
      el2.className = 'row-value';
    }
    if (net) {
      net.textContent = '检测中…';
      net.className = '';
    }

    const viaNative = !!(window.RaccoonNative && window.RaccoonNative.available());
    let r;
    try {
      r = isDirect() ? await window.RaccoonDirect.probe(8000) : await probeProxy(proxyBase());
    } catch {
      r = { ok: false, message: '检测失败' };
    }
    const ok = !!r.ok;
    const label = ok
      ? '已连接' + (r.ms ? ' · ' + r.ms + 'ms' : '') + (isDirect() ? (viaNative ? ' · 原生' : ' · 浏览器') : '')
      : r.message || r.reason || '连不上';

    if (el2) {
      el2.textContent = ok ? '已连接' : label;
      el2.className = 'row-value ' + (ok ? 'conn-ok' : 'conn-bad');
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
    window.RaccoonDirect.clearAuth();
    loadMe().then((ok) => {
      if (ok) {
        showView('app');
        setTab('chat');
        enterApp();
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
      if (!v) return toast('没找到可用的代理，保持直连');
    }

    const r = await probeProxy(v);
    if (!r.ok) return toast(v + '：' + (r.reason || '无法使用'));
    lsSet(PROXY_KEY, v);
    applyConnChange('已切换到代理 ' + v);
  }

  function useDirect() {
    lsDel(PROXY_KEY);
    applyConnChange('已恢复直连');
  }

  // ============================================================
  // 语音
  // ============================================================
  let recog = null;
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      const b = $('btn-voice');
      if (b) b.classList.add('hidden');
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
      updateSendState();
    };
    recog.onend = () => $('btn-voice').classList.remove('listening');
    recog.onerror = () => $('btn-voice').classList.remove('listening');
  }

  function toggleVoice() {
    if (!recog) return;
    const btn = $('btn-voice');
    if (btn.classList.contains('listening')) {
      try {
        recog.stop();
      } catch {}
      return;
    }
    try {
      recog.start();
      btn.classList.add('listening');
      haptic();
    } catch {}
  }

  // ============================================================
  // 进入应用
  // ============================================================
  async function enterApp() {
    if (!state.chats.length) loadChats();
    paintMe();
    paintModelBar();
    await Promise.all([loadMe(), loadCatalog()]);
    paintModelBar();
    paintMe();
    if (!state.messages.length) rebuildThread();
    else rebuildThread();
    updateSendState();
  }

  // ============================================================
  // 绑定
  // ============================================================
  function bind() {
    // --- 登录 ---
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

    // --- 弹层关闭 ---
    document.querySelectorAll('[data-close]').forEach((n) => {
      n.onclick = () => closeSheet(n.getAttribute('data-close'));
    });

    // --- 标签页 ---
    document.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => {
        setTab(t.getAttribute('data-tab'));
        haptic();
      };
    });

    // --- 顶栏 ---
    $('model-name').onclick = () => {
      renderModelList();
      openSheet('model-sheet');
    };
    $('effort-chip').onclick = () => {
      if (!reasoningSupported()) {
        toast('当前模型不支持深度思考，请换一个带「推理」标记的模型');
        return;
      }
      renderEffortList();
      openSheet('effort-sheet');
    };
    $('btn-compose').onclick = () => newChat();
    $('btn-points').onclick = () => {
      setTab('me');
    };

    // --- 输入 ---
    const ta = $('input');
    ta.addEventListener('input', () => {
      autoGrow();
      updateSendState();
    });
    ta.addEventListener('focus', () => $('composer').querySelector('.composer-box').classList.add('focus'));
    ta.addEventListener('blur', () => $('composer').querySelector('.composer-box').classList.remove('focus'));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    $('btn-send').onclick = () => (state.streaming ? stopStreaming() : send());
    $('btn-voice').onclick = toggleVoice;

    // --- 附件 ---
    $('btn-attach').onclick = () => openSheet('attach-sheet');
    $('att-camera').onclick = () => {
      closeSheet('attach-sheet');
      $('file-camera').click();
    };
    $('att-photo').onclick = () => {
      closeSheet('attach-sheet');
      $('file-image').click();
    };
    $('att-file').onclick = () => {
      closeSheet('attach-sheet');
      $('file-doc').click();
    };
    $('file-image').addEventListener('change', (e) => {
      addImageFiles(e.target.files);
      e.target.value = '';
    });
    $('file-camera').addEventListener('change', (e) => {
      addImageFiles(e.target.files);
      e.target.value = '';
    });
    $('file-doc').addEventListener('change', (e) => {
      addDocFiles(e.target.files);
      e.target.value = '';
    });

    // --- 滚动 ---
    $('messages').addEventListener('scroll', () => {
      updateScrollButton();
      const bar = document.querySelector('.appbar');
      if (bar) bar.classList.toggle('scrolled', $('messages').scrollTop > 2);
    }, { passive: true });
    $('btn-scroll-bottom').onclick = () => scrollBottom(true);

    // --- 代码复制（事件委托，流式刷新也不会丢） ---
    $('messages').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.code-copy') : null;
      if (!btn) return;
      const block = btn.closest('.code-block');
      const pre = block ? block.querySelector('pre') : null;
      copyText(pre ? pre.textContent : '', '代码已复制');
    });

    // --- 历史 ---
    $('btn-new-chat').onclick = () => newChat();
    $('chat-search').addEventListener('input', (e) => {
      state.chatFilter = e.target.value;
      renderChatList();
    });

    // --- 我的 ---
    $('row-effort').onclick = () => {
      if (!reasoningSupported()) {
        toast('当前模型不支持深度思考，请换一个带「推理」标记的模型');
        return;
      }
      renderEffortList();
      openSheet('effort-sheet');
    };
    $('row-system').onclick = () => openSystemSheet();
    $('btn-system-save').onclick = saveSystem;
    $('row-export').onclick = () => exportCurrent();
    $('btn-test-conn').onclick = () => testConn();
    $('row-proxy').onclick = () => useProxy();
    $('btn-conn-login').onclick = () => openDiag();
    $('diag-retest').onclick = () => testConn();
    $('diag-proxy').onclick = () => useProxy();
    $('diag-direct').onclick = () => useDirect();
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
      if (!window.confirm('确定退出登录？')) return;
      logout(false);
    };

    // --- 键盘 ---
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (closeTopSheet()) return;
      }
    });
  }

  // ============================================================
  // 启动
  // ============================================================
  (async function init() {
    bind();
    loadPrefs();
    paintConn();
    setupVoice();
    autoGrow();
    updateSendState();
    paintAttachments();

    // 配置
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

    // 已登录：直接进主界面
    const localAuth = window.RaccoonDirect.hasAuth() || !isDirect();
    let entered = false;
    if (localAuth) {
      try {
        const d = await api('/api/me');
        if (d && d.ok) {
          applyMe(d);
          showView('app');
          setTab('chat');
          await enterApp();
          entered = true;
        }
      } catch (e) {
        const m = (e && e.message) || '';
        if (m && !/^未登录|登录已失效/.test(m)) showMsg(m);
      }
    }

    if (!entered) {
      showView('login');
    }

    // 收起启动遮罩
    const boot = $('boot');
    if (boot) {
      setTimeout(() => boot.classList.add('gone'), 120);
      setTimeout(() => {
        boot.style.display = 'none';
        state.booted = true;
      }, 420);
    }

    // 便于排查：#chats / #settings
    if (location.hash === '#chats' && entered) setTab('history');
    else if (location.hash === '#settings' && entered) setTab('me');

    // 键盘弹起时贴底
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (document.activeElement === $('input')) setTimeout(() => scrollBottom(true), 60);
      });
    }
  })();
})();
