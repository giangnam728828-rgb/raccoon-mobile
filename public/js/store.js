/* ============================================================
   状态与持久化
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const { clamp } = RC;

  const K = {
    chats: 'raccoon.chats.v2',
    active: 'raccoon.chat.active.v2',
    prefs: 'raccoon.prefs.v3',
    prompts: 'raccoon.prompts.v1',
    proxy: 'raccoon.proxy.v2',
    device: 'raccoon.device',
    legacyChats: 'raccoon.chats.v1',
    legacyActive: 'raccoon.chat.active',
    legacyPrefs: 'raccoon.prefs.v2',
  };

  // ---------- 安全存储 ----------
  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function lsSet(key, v) {
    try { localStorage.setItem(key, v); return true; } catch { return false; }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch {}
  }
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, v) {
    try {
      if (v == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  }

  // ---------- 默认偏好 ----------
  const DEFAULTS = {
    model: '',
    effort: 'off',
    theme: 'dark',        // auto | light | dark (v6 默认深色工具风格)
    fontScale: 1,         // 1 | 1.08 | 1.18
    haptic: true,
    nation: '+86',
    sendOnEnter: true,
    showThought: true,    // 流式时自动展开思考
  };

  const state = {
    // 账号
    loggedIn: false,
    uid: '',
    name: '',
    phone: '',
    points: 0,
    lastError: '',
    // 模型
    models: [],
    // 偏好
    prefs: Object.assign({}, DEFAULTS),
    // 会话
    chats: [],
    chatId: '',
    messages: [],
    system: '',
    // 流式
    streaming: false,
    abort: null,
    // 草稿附件
    drafts: [],
    // 提示词
    prompts: [],
    // UI
    tab: 'chat',
    search: '',
    unread: 0,
  };

  // ---------- 偏好 ----------
  function loadPrefs() {
    let p = readJSON(K.prefs, null);
    if (!p) {
      // 从旧版本迁移
      const old = readJSON(K.legacyPrefs, null);
      if (old) {
        p = {
          model: old.model || '',
          effort: old.effort || 'off',
          nation: old.nation || '+86',
        };
      }
    }
    state.prefs = Object.assign({}, DEFAULTS, p || {});
    state.prefs.fontScale = clamp(Number(state.prefs.fontScale) || 1, 0.9, 1.4);
    if (['auto', 'light', 'dark'].indexOf(state.prefs.theme) < 0) state.prefs.theme = 'auto';
  }

  function savePrefs() {
    writeJSON(K.prefs, state.prefs);
  }

  function setPref(key, value) {
    state.prefs[key] = value;
    savePrefs();
  }

  // ---------- 会话 ----------
  function newChatId() {
    return global.RaccoonDirect ? global.RaccoonDirect.newSessionId() : RC.uid();
  }

  function slimMessages(msgs) {
    return (msgs || []).map((m) => ({
      role: m.role,
      content: m.content,
      reasoning: m.reasoning || '',
      // 图片 base64 不落盘（体积太大），文本附件保留
      attachments: (m.attachments || []).filter((a) => a.type === 'text'),
      usage: m.usage || null,
      ts: m.ts || 0,
    }));
  }

  function normalizeChat(c) {
    return {
      id: String(c.id),
      title: c.title || '新对话',
      messages: Array.isArray(c.messages) ? slimMessages(c.messages) : [],
      system: c.system || '',
      pinned: !!c.pinned,
      createdAt: c.createdAt || c.updatedAt || Date.now(),
      updatedAt: c.updatedAt || 0,
    };
  }

  function sortChats() {
    state.chats.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function loadChats() {
    let list = readJSON(K.chats, null);

    if (!Array.isArray(list)) {
      // 从 v1 迁移
      const legacy = readJSON(K.legacyChats, null);
      list = Array.isArray(legacy) ? legacy : [];
      if (list.length) {
        setTimeout(() => RC.toast('已迁移 ' + list.length + ' 个历史对话'), 800);
      }
    }

    state.chats = list
      .filter((c) => c && c.id)
      .map(normalizeChat);
    sortChats();

    let active = lsGet(K.active, '') || lsGet(K.legacyActive, '');
    if (!state.chats.some((c) => c.id === active)) {
      active = state.chats[0] ? state.chats[0].id : '';
    }
    if (!active) {
      const id = newChatId();
      state.chats.unshift({
        id, title: '新对话', messages: [], system: '', pinned: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      active = id;
    }
    state.chatId = active;
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
      ts: m.ts || 0,
      streaming: false,
      error: '',
    }));
    state.system = (cur && cur.system) || '';
    state.drafts = [];
  }

  let saveWarned = false;
  function saveChats() {
    state.chats.forEach((c) => {
      if (!c.updatedAt) c.updatedAt = Date.now();
    });
    const ok = writeJSON(K.chats, state.chats.map((c) => ({
      id: c.id,
      title: c.title,
      system: c.system || '',
      pinned: !!c.pinned,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: slimMessages(c.messages),
    })));
    lsSet(K.active, state.chatId || '');
    if (!ok && !saveWarned) {
      saveWarned = true;
      RC.toast('本地存储已满，旧对话可能无法保存');
    }
    return ok;
  }

  function syncCurrent() {
    const cur = state.chats.find((c) => c.id === state.chatId);
    if (!cur) return;
    cur.messages = slimMessages(state.messages);
    cur.system = state.system || '';
    const firstUser = cur.messages.find((m) => m.role === 'user');
    if (firstUser) {
      const src = String(firstUser.content || '').replace(/\s+/g, ' ').trim();
      cur.title = src ? src.slice(0, 30) : '图片对话';
    }
    cur.updatedAt = Date.now();
    saveChats();
  }

  function createChat() {
    const id = newChatId();
    const chat = {
      id, title: '新对话', messages: [], system: '', pinned: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    state.chats.unshift(chat);
    state.chatId = id;
    state.messages = [];
    state.system = '';
    state.drafts = [];
    saveChats();
    return chat;
  }

  function switchChat(id) {
    if (id === state.chatId) return false;
    const cur = state.chats.find((c) => c.id === id);
    if (!cur) return false;
    syncCurrent();
    state.chatId = id;
    hydrateCurrent();
    saveChats();
    return true;
  }

  function deleteChat(id) {
    const before = state.chats.length;
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.chats.length === before) return false;
    if (!state.chats.length) {
      createChat();
    } else if (state.chatId === id) {
      state.chatId = state.chats[0].id;
      hydrateCurrent();
    }
    saveChats();
    return true;
  }

  function currentChat() {
    return state.chats.find((c) => c.id === state.chatId) || null;
  }

  function renameChat(id, title) {
    const c = state.chats.find((x) => x.id === id);
    if (!c) return false;
    const t = String(title || '').trim();
    if (!t) return false;
    c.title = t.slice(0, 60);
    c.updatedAt = Date.now();
    saveChats();
    return true;
  }

  function togglePin(id) {
    const c = state.chats.find((x) => x.id === id);
    if (!c) return false;
    c.pinned = !c.pinned;
    sortChats();
    saveChats();
    return c.pinned;
  }

  // ---------- 提示词库 ----------
  const BUILTIN_PROMPTS = [
    { id: 'b1', name: '严谨技术编辑', text: '你是一名严谨的技术编辑。回答先给结论，再给依据；不确定的地方明确说出不确定，不要编造。', builtin: true },
    { id: 'b2', name: '中文润色', text: '你是一名中文写作编辑。保持原意，只改表达：去掉冗余、拆开长句、统一术语，输出润色后的文本。', builtin: true },
    { id: 'b3', name: '代码助手', text: '你是一名资深工程师。给可直接运行的代码，先说改动点，再给代码，最后说明边界与风险。', builtin: true },
    { id: 'b4', name: '结构化分析', text: '你是一名分析师。用「结论—证据—风险—下一步」四段式组织回答，能列表就不用长段落。', builtin: true },
    { id: 'b5', name: '翻译', text: '你是一名专业译者。中文与英文互译，保留原文语气与格式，专有名词首次出现时附原文。', builtin: true },
    { id: 'b6', name: '要点摘要', text: '把内容压缩成要点：先一句话结论，再列不超过 7 条要点，每条一句话，最后标出仍需确认的信息。', builtin: true },
  ];

  function loadPrompts() {
    const saved = readJSON(K.prompts, null);
    state.prompts = Array.isArray(saved) ? saved : [];
  }

  function savePrompts() {
    return writeJSON(K.prompts, state.prompts);
  }

  function allPrompts() {
    return BUILTIN_PROMPTS.concat(state.prompts);
  }

  function addPrompt(name, text) {
    const p = { id: RC.uid(), name: String(name || '').trim().slice(0, 40) || '未命名', text: String(text || '').trim() };
    if (!p.text) return null;
    state.prompts.unshift(p);
    savePrompts();
    return p;
  }

  function deletePrompt(id) {
    const before = state.prompts.length;
    state.prompts = state.prompts.filter((p) => p.id !== id);
    if (state.prompts.length !== before) savePrompts();
  }

  // ---------- 统计 ----------
  function stats() {
    let msgs = 0;
    state.chats.forEach((c) => { msgs += (c.messages || []).length; });
    return { chats: state.chats.length, messages: msgs };
  }

  function storageBytes() {
    let total = 0;
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.indexOf('raccoon.') !== 0) continue;
        const v = localStorage.getItem(k);
        total += (v ? v.length : 0) * 2; // UTF-16
      }
    } catch {}
    return total;
  }

  Object.assign(RC, {
    K, DEFAULTS, state,
    lsGet, lsSet, lsDel, readJSON, writeJSON,
    loadPrefs, savePrefs, setPref,
    newChatId, loadChats, saveChats, syncCurrent, hydrateCurrent,
    createChat, switchChat, deleteChat, currentChat, renameChat, togglePin, sortChats,
    loadPrompts, savePrompts, allPrompts, addPrompt, deletePrompt, BUILTIN_PROMPTS,
    stats, storageBytes,
  });
})(window);
