// 小浣熊移动端 —— 前端逻辑（重做版）
(() => {
  const $ = (id) => document.getElementById(id);

  // API 基址：Web 版同源留空；APK 版构建时由 CI 替换为代理地址（如 http://127.0.0.1:8799）
  const API_BASE = '';

  const state = {
    loggedIn: false,
    models: [],
    model: '',
    thinking: false,
    streaming: false,
    messages: [],
    uid: '',
    name: '',
    points: 0,
  };

  const SUGGEST = [
    { icon: '📊', title: '数据分析', text: '帮我分析这组数据，给出结论' },
    { icon: '✍️', title: '写一份文案', text: '写一段产品介绍文案' },
    { icon: '🧩', title: '拆解任务', text: '把这个任务拆成可执行的步骤' },
  ];

  // ---------- 视图 / 弹层 ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    $(name + '-view').classList.add('active');
  }
  function openSheet(id) { $(id).classList.remove('hidden'); }
  function closeSheet(id) { $(id).classList.add('hidden'); }
  function showMsg(text) {
    const el = $('login-msg');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  // ---------- 请求 ----------
  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      headers: { 'content-type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.auth === false) { logout(true); throw new Error('登录已失效，请重新登录'); }
    return data;
  }

  // ---------- 登录 ----------
  async function doQR() {
    $('qr-panel').classList.remove('hidden');
    $('qr-status').textContent = '正在生成二维码…';
    try {
      const d = await api('/api/qrcode', { method: 'POST' });
      if (d.qr) { $('qr-img').src = d.qr; $('qr-status').textContent = '请用微信扫描上方二维码'; pollQR(d.code); }
      else showMsg('二维码生成失败');
    } catch (e) { showMsg(e.message); }
  }

  let pollTimer = null;
  function pollQR(code) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const d = await api('/api/login/poll', { method: 'POST', body: { code } });
        if (d.ok) { clearInterval(pollTimer); pollTimer = null; onLoginSuccess(d); }
        else if (!d.pending) $('qr-status').textContent = d.message || '等待扫码…';
      } catch (e) { $('qr-status').textContent = e.message; }
    }, 2500);
  }

  async function doCode() {
    const code = $('code-input').value.trim();
    if (!code) return showMsg('请粘贴授权码');
    const d = await api('/api/login/exchange', { method: 'POST', body: { code } });
    if (d.ok) onLoginSuccess(d); else showMsg(d.message || '兑换失败');
  }

  async function doToken() {
    const token = $('token-input').value.trim();
    if (!token) return showMsg('请粘贴 token');
    const d = await api('/api/login/token', { method: 'POST', body: { token } });
    if (d.ok) onLoginSuccess(d); else showMsg(d.message || '登录失败');
  }

  function onLoginSuccess(d) {
    state.loggedIn = true;
    state.uid = d.uid || '';
    ['qr-panel', 'code-panel', 'token-panel'].forEach((id) => $(id).classList.add('hidden'));
    $('login-msg').classList.add('hidden');
    showView('chat');
    $('status-dot').classList.add('on');
    enterChat();
  }

  function logout(silent) {
    state.loggedIn = false;
    state.messages = [];
    state.model = '';
    $('messages').innerHTML = '';
    rebuildEmpty();
    $('status-dot').classList.remove('on');
    if (!silent) api('/api/logout', { method: 'POST' });
    showView('login');
  }

  // ---------- 进入聊天 ----------
  async function enterChat() {
    await loadMe();
    await loadCatalog();
    if (!state.model && state.models.length) state.model = state.models[0].id;
    updateModelBar();
    rebuildEmpty();
  }

  async function loadMe() {
    try {
      const d = await api('/api/me');
      if (d.ok) {
        state.name = d.name || '小浣熊';
        state.points = d.points || 0;
        state.uid = d.uid || state.uid;
        $('me-name').textContent = state.name;
        $('points-badge').textContent = '积分 ' + state.points;
        $('set-uid').textContent = state.uid || '—';
        $('set-points').textContent = state.points;
      }
    } catch {}
  }

  async function loadCatalog() {
    try {
      const d = await api('/api/catalog');
      if (d.ok && d.models) {
        state.models = d.models;
        renderModelList();
      }
    } catch {}
  }

  function renderModelList() {
    const list = $('model-list');
    list.innerHTML = '';
    if (!state.models.length) { list.innerHTML = '<p class="panel-tip">暂无可用模型</p>'; return; }
    state.models.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'model-item' + (m.id === state.model ? ' active' : '');
      const meta = [m.id, m.contextLength ? m.contextLength + ' 上下文' : '', m.supportsImages ? '识图' : ''].filter(Boolean).join(' · ');
      el.innerHTML = `
        <div class="mi-main"><div class="nm">${esc(m.name)}</div><div class="meta">${esc(meta)}</div></div>
        <span class="pick">${m.id === state.model ? '已选' : '选择'}</span>`;
      el.onclick = () => { state.model = m.id; updateModelBar(); closeSheet('model-sheet'); renderModelList(); };
      list.appendChild(el);
    });
  }

  function updateModelBar() {
    const m = state.models.find((x) => x.id === state.model);
    $('model-name-val').textContent = m ? m.name : (state.model || '默认');
    $('set-model').textContent = state.model || '—';
    $('set-think').textContent = state.thinking ? '开' : '关';
  }

  // ---------- 消息渲染 ----------
  function rebuildEmpty() {
    const box = $('messages');
    box.innerHTML = '';
    if (!state.messages.length) {
      box.appendChild(buildEmpty());
    } else {
      state.messages.forEach((m) => box.appendChild(buildRow(m)));
    }
    scrollBottom();
  }

  function buildEmpty() {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.id = 'empty-state';
    wrap.innerHTML = `
      <div class="empty-mark">
        <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="22" fill="#1c2433" stroke="#2a3548" stroke-width="1.5"/>
          <path d="M16 20c0-3 2-5 5-5s4 2 4 4-1 4-4 4-5-1-5-3z" fill="#f59e0b"/>
          <path d="M24 20c0-3 2-5 5-5s4 2 4 4-1 4-4 4-5-1-5-3z" fill="#fbbf24"/>
          <circle cx="19" cy="26" r="1.8" fill="#0b0f17"/>
          <circle cx="29" cy="26" r="1.8" fill="#0b0f17"/>
          <path d="M20 31c2 2 6 2 8 0" stroke="#0b0f17" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>开始对话</h2>
      <p class="empty-sub">选择模型、开启深度思考，直接提问</p>
      <div class="suggest"></div>`;
    const suggest = wrap.querySelector('.suggest');
    SUGGEST.forEach((s) => {
      const chip = document.createElement('button');
      chip.className = 'suggest-chip';
      chip.innerHTML = `<b>${s.icon} ${esc(s.title)}</b>　${esc(s.text)}`;
      chip.onclick = () => { $('input').value = s.text; autoGrow(); $('input').focus(); };
      suggest.appendChild(chip);
    });
    return wrap;
  }

  function buildRow(m) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (m.role === 'user' ? 'user' : 'ai');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (m.role === 'ai' && m.reasoning) {
      const r = document.createElement('details');
      r.className = 'reasoning';
      const sum = document.createElement('summary');
      sum.textContent = '深度思考过程';
      const pre = document.createElement('pre');
      pre.textContent = m.reasoning;
      r.appendChild(sum); r.appendChild(pre);
      bubble.appendChild(r);
    }
    if (m.role === 'ai' && m.streaming && !m.content && !m.reasoning) {
      const t = document.createElement('div');
      t.className = 'typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      bubble.appendChild(t);
    }
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = m.content || '';
    if (m.streaming) content.classList.add('cursor');
    bubble.appendChild(content);
    row.appendChild(bubble);
    return row;
  }

  function scrollBottom() { const box = $('messages'); box.scrollTop = box.scrollHeight; }

  function appendMessage(role, content) {
    state.messages.push({ role, content, reasoning: '', streaming: role === 'ai' });
    const box = $('messages');
    const empty = $('empty-state');
    if (empty) empty.remove();
    box.appendChild(buildRow(state.messages[state.messages.length - 1]));
    scrollBottom();
    return state.messages[state.messages.length - 1];
  }

  // ---------- 发送 ----------
  async function send() {
    const input = $('input');
    const text = input.value.trim();
    if (!text || state.streaming) return;

    state.messages.push({ role: 'user', content: text });
    rebuildEmpty();
    input.value = '';
    autoGrow();
    updateSend();

    const ctx = state.messages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const body = {
      model: state.model,
      messages: ctx,
      stream: true,
      max_tokens: 80000,
      reasoning_effort: state.thinking ? 'high' : 'off',
    };

    state.streaming = true;
    updateSend();
    const ai = appendMessage('ai', '');

    try {
      const res = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error('对话请求失败 HTTP ' + res.status);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let row = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t || !t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          let frame; try { frame = JSON.parse(payload); } catch { continue; }
          const choice = frame.choices && frame.choices[0];
          if (!choice) continue;
          const delta = choice.delta || choice.message || {};
          if (delta.content) ai.content += delta.content;
          if (delta.reasoning_content || delta.reasoning) ai.reasoning += (delta.reasoning_content || delta.reasoning);
        }
        // 刷新这一条的渲染
        row = refreshRow(ai);
        scrollBottom();
      }
    } catch (e) {
      ai.content = (ai.content ? ai.content + '\n\n' : '') + '⚠️ ' + e.message;
    } finally {
      ai.streaming = false;
      state.streaming = false;
      updateSend();
      if (row) {
        const fresh = buildRow(ai);
        row.replaceWith(fresh);
      } else {
        rebuildEmpty();
      }
    }
  }

  // 增量刷新单条消息（不重建整列，保留滚动位置体验）
  function refreshRow(m) {
    const old = $('messages').querySelector('.msg-row:last-child');
    const fresh = buildRow(m);
    if (old) { old.replaceWith(fresh); return fresh; }
    return null;
  }

  // ---------- 输入框 ----------
  function autoGrow() {
    const ta = $('input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }
  function updateSend() {
    $('btn-send').disabled = state.streaming || !$('input').value.trim();
  }

  // ---------- 语音 ----------
  let recog = null;
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('btn-voice').style.opacity = .4; return; }
    recog = new SR();
    recog.lang = 'zh-CN';
    recog.interimResults = true;
    recog.continuous = false;
    let finalText = '';
    recog.onstart = () => { finalText = ''; };
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += txt; else interim += txt;
      }
      $('input').value = finalText + interim;
      autoGrow(); updateSend();
    };
    recog.onend = () => { $('btn-voice').classList.remove('listening'); };
    recog.onerror = () => { $('btn-voice').classList.remove('listening'); };
  }
  function toggleVoice() {
    if (!recog) return;
    if ($('btn-voice').classList.contains('listening')) { recog.stop(); return; }
    try { recog.start(); $('btn-voice').classList.add('listening'); } catch {}
  }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 绑定 ----------
  function bind() {
    $('btn-qr').onclick = doQR;
    $('btn-qr-refresh').onclick = doQR;
    $('btn-code').onclick = () => $('code-panel').classList.remove('hidden');
    $('btn-code-go').onclick = doCode;
    $('btn-token').onclick = () => $('token-panel').classList.remove('hidden');
    $('btn-token-go').onclick = doToken;

    // 弹层返回
    document.querySelectorAll('[data-back]').forEach((b) => {
      b.onclick = () => $('qr-panel').classList.add('hidden');
    });
    // 通用关闭
    document.querySelectorAll('[data-close]').forEach((el) => {
      el.onclick = () => closeSheet(el.getAttribute('data-close'));
    });

    $('btn-models').onclick = () => { renderModelList(); openSheet('model-sheet'); };
    $('model-name').onclick = () => { renderModelList(); openSheet('model-sheet'); };
    $('btn-settings').onclick = () => { updateModelBar(); openSheet('settings-sheet'); };

    $('think-toggle').onchange = (e) => { state.thinking = e.target.checked; updateModelBar(); };

    $('btn-send').onclick = send;
    $('input').addEventListener('input', () => { autoGrow(); updateSend(); });
    $('input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('btn-voice').onclick = toggleVoice;

    $('btn-checkin').onclick = async () => {
      const d = await api('/api/checkin', { method: 'POST' });
      toast(d.message || (d.ok ? '已完成' : '失败'));
      loadMe();
    };
    $('btn-onboarding').onclick = async () => {
      const d = await api('/api/onboarding', { method: 'POST' });
      toast(d.message || (d.ok ? '已完成' : '失败'));
      loadMe();
    };
    $('btn-logout').onclick = () => logout(false);
  }

  // 轻量提示
  let toastTimer = null;
  function toast(text) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#1c2433;color:#e8edf5;border:1px solid rgba(255,255,255,.12);padding:10px 18px;border-radius:12px;font-size:13.5px;z-index:99;box-shadow:0 8px 24px -8px rgba(0,0,0,.5);opacity:0;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  // 启动
  (async function init() {
    bind();
    setupVoice();
    updateSend();
    try {
      const d = await api('/api/me');
      if (d.ok) {
        state.loggedIn = true;
        state.uid = d.uid || '';
        state.name = d.name || '小浣熊';
        state.points = d.points || 0;
        $('me-name').textContent = state.name;
        $('points-badge').textContent = '积分 ' + state.points;
        $('status-dot').classList.add('on');
        showView('chat');
        await enterChat();
      }
    } catch {}
  })();
})();
