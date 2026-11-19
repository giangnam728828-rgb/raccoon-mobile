/* ============================================================
   接口层：通道选择 / 模型 / 登录 / 流式对话
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const K = RC.K;

  // 构建期可注入（CI 用 sed 替换）
  const API_BASE = '';
  const ACCESS_KEY = '';

  const DEFAULT_MODEL = 'raccoon-chat-ml-5-5';

  // ---------- 通道 ----------
  function proxyBase() {
    return String(RC.lsGet(K.proxy, '') || '').trim().replace(/\/+$/, '');
  }
  function isDirect() {
    return !proxyBase();
  }
  function channelLabel() {
    const p = proxyBase();
    if (!p) return '自动 · 直连官方';
    return '代理 · ' + p.replace(/^https?:\/\//, '');
  }

  async function proxyApi(base, path, opts) {
    const o = opts || {};
    const headers = { 'content-type': 'application/json' };
    if (ACCESS_KEY) headers['x-access-key'] = ACCESS_KEY;

    let res;
    try {
      res = await fetch(base + path, {
        method: o.method || 'GET',
        headers: Object.assign(headers, o.headers || {}),
        body: o.body ? JSON.stringify(o.body) : undefined,
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
      throw Object.assign(new Error(data.message || '登录已失效，请重新登录'), { auth: false });
    }
    return data;
  }

  async function api(path, opts) {
    const base = proxyBase();
    let data;
    try {
      data = base ? await proxyApi(base, path, opts) : await global.RaccoonDirect.handle(path, opts);
    } catch (e) {
      if (e && e.auth === false) RC.onAuthLost && RC.onAuthLost();
      throw e;
    }
    if (data && data.auth === false) {
      RC.onAuthLost && RC.onAuthLost();
      throw Object.assign(new Error(data.message || '登录已失效，请重新登录'), { auth: false });
    }
    return data || { ok: false };
  }

  // ---------- 模型 ----------
  // 直连给 {id,name,contextLength,supportsImages,supportsReasoning}
  // 官方原始给 {name,display_name,context_window,supports_reasoning}
  // 两种都接受，避免代理版本不一致时列表变成裸 id
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

    const ctx = raw.contextLength || raw.context_window ||
      (raw.params && raw.params.context_window) || 0;

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
    const d = await api('/api/catalog');
    if (!d || !d.ok || !Array.isArray(d.models)) {
      return { ok: false, message: (d && d.message) || '获取模型列表失败' };
    }
    const seen = new Set();
    const list = [];
    d.models.forEach((raw) => {
      const m = normalizeModel(raw);
      if (!m || seen.has(m.id)) return;
      seen.add(m.id);
      list.push(m);
    });
    S.models = list;

    const preferred = S.prefs.model;
    if (preferred && list.some((m) => m.id === preferred)) {
      // 保留用户选择
    } else if (list.length) {
      // 默认挑一个能力最全的
      const best =
        list.find((m) => m.supportsReasoning && m.supportsImages) ||
        list.find((m) => m.supportsReasoning) ||
        list[0];
      S.prefs.model = best.id;
      RC.savePrefs();
    }
    return { ok: true, models: list };
  }

  function currentModel() {
    return S.models.find((m) => m.id === S.prefs.model) || null;
  }

  function reasoningSupported() {
    const m = currentModel();
    // 模型列表还没加载时，允许用户设置（发请求时再判断）
    if (!S.models.length) return true;
    return !!(m && m.supportsReasoning);
  }

  function visionSupported() {
    const m = currentModel();
    if (!S.models.length) return true;
    return !!(m && m.supportsImages);
  }

  // ---------- 账号 ----------
  async function loginConfig() {
    return api('/api/login/config');
  }

  async function me() {
    return api('/api/me');
  }

  async function checkin() {
    return api('/api/checkin', { method: 'POST' });
  }

  async function onboarding() {
    return api('/api/onboarding', { method: 'POST' });
  }

  async function logoutRemote() {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {}
  }

  // ---------- 探测 ----------
  async function probe(timeoutMs) {
    const nat = global.RaccoonNative;
    if (nat && nat.available()) {
      try {
        const nr = await nat.probe(global.RaccoonDirect.UPSTREAM + '/api/web/auth/v1/user_info');
        if (nr) return nr;
      } catch {}
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs || 8000);
    const started = Date.now();
    try {
      const res = await fetch(global.RaccoonDirect.UPSTREAM + '/api/web/auth/v1/user_info', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined,
      });
      return { ok: true, status: res.status, ms: Date.now() - started };
    } catch (e) {
      return {
        ok: false,
        message: e && e.name === 'AbortError' ? '超时' : '网络不可达',
        ms: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeProxy(base) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const started = Date.now();
    try {
      const r = await fetch(base + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status, ms: Date.now() - started };
      const d = await r.json().catch(() => null);
      if (!d || d.ok !== true || !(d.upstream || d.service)) {
        return { ok: false, reason: '该地址不是小浣熊代理', ms: Date.now() - started };
      }
      return { ok: true, data: d, ms: Date.now() - started };
    } catch (e) {
      return {
        ok: false,
        reason: e && e.name === 'AbortError' ? '超时' : '连不上',
        ms: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function proxyCandidates() {
    const out = [];
    const push = (v) => {
      v = String(v || '').trim().replace(/\/+$/, '');
      if (v && out.indexOf(v) < 0) out.push(v);
    };
    push(proxyBase());
    push(API_BASE);
    push('http://127.0.0.1:8799');
    push('http://localhost:8799');
    const h = location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') push('http://' + h + ':8799');
    return out;
  }

  async function autoDetectProxy() {
    for (const c of proxyCandidates()) {
      const r = await probeProxy(c);
      if (r.ok) return c;
    }
    return '';
  }

  // ---------- 载荷构造 ----------
  function composeUser(role, m) {
    const imgs = (m.attachments || []).filter((a) => a.type === 'image');
    const docs = (m.attachments || []).filter((a) => a.type === 'text');

    let text = m.content || '';
    if (docs.length) {
      const parts = docs.map((d) => '【文件：' + d.name + '】\n' + String(d.text || '').slice(0, 40000));
      text = (text ? text + '\n\n' : '') + parts.join('\n\n');
    }

    if (!imgs.length) return { role: role, content: text };

    const blocks = [{ type: 'text', text: text || '请看下面的图片' }];
    imgs.forEach((a) => blocks.push({ type: 'image_url', image_url: { url: a.dataUrl } }));
    return { role: role, content: blocks };
  }

  function buildMessages() {
    const out = [];
    if (S.system && S.system.trim()) {
      out.push({ role: 'system', content: S.system.trim() });
    }
    S.messages.forEach((m) => {
      if (!m.content && !(m.attachments && m.attachments.length)) return;
      if (m.role === 'user') out.push(composeUser('user', m));
      else if (m.content) out.push({ role: 'assistant', content: m.content });
    });
    return out;
  }

  // ---------- 流式对话 ----------
  async function streamChat(payload, handlers) {
    const body = {
      model: payload.model || S.prefs.model || DEFAULT_MODEL,
      messages: payload.messages,
      stream: true,
      max_tokens: payload.maxTokens || 80000,
      reasoning_effort: payload.effort || 'off',
    };
    if (payload.temperature != null) body.temperature = payload.temperature;

    const h = handlers || {};

    if (isDirect()) {
      return global.RaccoonDirect.chat(
        Object.assign({}, body, { sessionId: S.chatId, signal: payload.signal }),
        {
          onDelta: (d) => {
            if (d.error) h.onError && h.onError(d.error);
            else {
              if (d.content) h.onContent && h.onContent(d.content);
              if (d.reasoning) h.onReasoning && h.onReasoning(d.reasoning);
            }
          },
          onUsage: (u) => h.onUsage && h.onUsage(u),
          onDone: () => h.onDone && h.onDone(),
        }
      );
    }

    return streamViaProxy(body, payload.signal, h);
  }

  async function streamViaProxy(body, signal, h) {
    const base = proxyBase();
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json' },
        ACCESS_KEY ? { 'x-access-key': ACCESS_KEY } : {}
      ),
      body: JSON.stringify(body),
      signal: signal,
    });

    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || ctype.indexOf('application/json') === 0) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) {
        const e = new Error(d.message || '登录已失效，请重新登录');
        e.auth = false;
        throw e;
      }
      throw new Error(d.message || '对话请求失败（HTTP ' + res.status + '）');
    }
    if (!res.body) throw new Error('当前环境不支持流式响应');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.indexOf('data:') !== 0) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let frame;
        try {
          frame = JSON.parse(payload);
        } catch {
          continue;
        }
        if (frame.error) {
          h.onError && h.onError(frame.error.message || '上游返回错误');
          continue;
        }
        if (frame.usage) h.onUsage && h.onUsage(frame.usage);
        const choice = frame.choices && frame.choices[0];
        if (!choice) continue;
        const delta = choice.delta || choice.message || {};
        if (typeof delta.content === 'string' && delta.content) {
          h.onContent && h.onContent(delta.content);
        }
        const r = delta.reasoning_content || delta.reasoning;
        if (typeof r === 'string' && r) h.onReasoning && h.onReasoning(r);
      }
    }
    h.onDone && h.onDone();
  }

  Object.assign(RC, {
    API_BASE, ACCESS_KEY, DEFAULT_MODEL,
    proxyBase, isDirect, channelLabel,
    api, normalizeModel, loadCatalog, currentModel,
    reasoningSupported, visionSupported,
    loginConfig, me, checkin, onboarding, logoutRemote,
    probe, probeProxy, proxyCandidates, autoDetectProxy,
    buildMessages, composeUser, streamChat,
  });
})(window);
