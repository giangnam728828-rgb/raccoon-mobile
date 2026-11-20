/* ============================================================
   应用主体：登录 / 发送 / 会话 / 导出 / 启动
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, $$, el, icon } = RC;

  const CAPTCHA_SDK = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';

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
  // 登录
  // ============================================================
  function showMsg(text, info) {
    const box = $('login-msg');
    if (!box) return;
    box.textContent = text;
    box.classList.toggle('info', !!info);
    box.classList.remove('hidden');
  }
  function hideMsg() {
    const box = $('login-msg');
    if (box) box.classList.add('hidden');
  }

  function renderNations() {
    const sel = $('nation');
    if (!sel) return;
    sel.innerHTML = '';
    const list = loginCfg.nationCodes && loginCfg.nationCodes.length
      ? loginCfg.nationCodes
      : [{ code: '+86', label: '中国大陆' }];
    list.forEach((n) => {
      const o = document.createElement('option');
      o.value = n.code;
      o.textContent = n.code + ' ' + n.label;
      sel.appendChild(o);
    });
    sel.value = S.prefs.nation || list[0].code;
    if (!sel.value) sel.value = list[0].code;
    S.prefs.nation = sel.value;
  }

  let captchaLoader = null;
  let capRunning = null;

  function loadCaptchaSdk() {
    if (typeof global.initAliyunCaptcha === 'function') return Promise.resolve();
    if (captchaLoader) return captchaLoader;
    captchaLoader = new Promise((resolve, reject) => {
      const cfg = loginCfg.captcha || {};
      global.AliyunCaptchaConfig = { region: cfg.region || 'cn', prefix: cfg.prefix || '' };
      const s = document.createElement('script');
      s.src = CAPTCHA_SDK;
      s.async = true;
      s.onload = () => {
        if (typeof global.initAliyunCaptcha === 'function') resolve();
        else reject(new Error('人机验证组件加载异常，请稍后重试'));
      };
      s.onerror = () => reject(new Error('人机验证组件加载失败，请检查网络'));
      document.head.appendChild(s);
    }).catch((e) => {
      captchaLoader = null;
      throw e;
    });
    return captchaLoader;
  }

  function runCaptcha() {
    if (capRunning) return capRunning;

    capRunning = loadCaptchaSdk().then(() => new Promise((resolve, reject) => {
      let settled = false;
      const startedAt = Date.now();
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
        rem: Math.min(1, (global.innerWidth - 24) / 360),
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

      let p;
      try {
        p = Promise.resolve(global.initAliyunCaptcha(opts));
      } catch (e) {
        return finish(reject, e);
      }
      p.catch(() => finish(reject, new Error('人机验证初始化失败，请重试')));
    })).catch((e) => {
      capRunning = null;
      throw e;
    });

    capRunning.then(() => { capRunning = null; }).catch(() => {});
    return capRunning;
  }

  let countdownTimer = null;

  function startCountdown(sec) {
    const btn = $('btn-send-code');
    let left = RC.clamp(Math.round(sec) || 60, 1, 300);
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
    const nation = $('nation').value || '+86';
    S.prefs.nation = nation;
    RC.savePrefs();

    if (!phone) return showMsg('请输入手机号');
    if (nation === '+86' && !/^1[3-9][0-9]{9}$/.test(phone)) {
      return showMsg('请输入正确的 11 位手机号');
    }

    const btn = $('btn-send-code');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '验证中…';

    try {
      showMsg('正在完成人机验证…', true);
      const captchaToken = await runCaptcha();
      hideMsg();
      btn.textContent = '发送中…';

      const d = await RC.api('/api/login/sms/send', {
        method: 'POST',
        body: { phone, nationCode: nation, captchaToken },
      });

      if (!d.ok) {
        btn.disabled = false;
        btn.textContent = '获取验证码';
        const msg = d.message || '验证码发送失败';
        S.lastError = msg;
        if (/人机验证/.test(msg)) {
          return showMsg(msg + '，请再点一次「获取验证码」重试');
        }
        return showMsg(msg);
      }

      S.verificationId = d.verificationId;
      S.phoneForLogin = phone;
      startCountdown(d.retryAfter || 60);
      $('code').value = '';
      $('code').focus();
      RC.toast('验证码已发送');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
      S.lastError = (e && e.message) || '验证码发送失败';
      showMsg(S.lastError);
    }
  }

  async function doPhoneLogin() {
    hideMsg();
    const phone = $('phone').value.replace(/[\s\-()]/g, '');
    const code = $('code').value.trim().replace(/\s/g, '');
    const nation = $('nation').value || '+86';

    if (!S.verificationId) return showMsg('请先获取验证码');
    if (!/^[0-9]{4,8}$/.test(code)) return showMsg('请输入短信收到的验证码');

    const btn = $('btn-login');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '登录中…';

    try {
      const d = await RC.api('/api/login/sms/verify', {
        method: 'POST',
        body: {
          phone: S.phoneForLogin || phone,
          nationCode: nation,
          verificationId: S.verificationId,
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
      const d = await RC.api('/api/login/token', { method: 'POST', body: { token } });
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
    RC.showView('app');
    RC.setTab('chat');
    enterApp();
  }

  function logout(silent) {
    S.loggedIn = false;
    stopStreaming();
    RC.stopSpeak();
    RC.clearAllSheets();
    if (global.RaccoonDirect) global.RaccoonDirect.clearAuth();

    S.messages = [];
    S.chats = [];
    S.chatId = '';
    S.models = [];
    S.verificationId = '';
    S.points = 0;

    const thread = $('thread');
    if (thread) thread.innerHTML = '';
    const dot = $('status-dot');
    if (dot) dot.classList.remove('on');

    clearInterval(countdownTimer);
    const btn = $('btn-send-code');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
    }
    const code = $('code');
    if (code) code.value = '';

    RC.showView('login');
    RC.renderNations();
    RC.paintModelBar();
    RC.renderMe();

    if (!silent) {
      RC.logoutRemote();
      RC.toast('已退出登录');
    }
  }

  RC.onAuthLost = function () {
    if (!S.loggedIn) return;
    logout(true);
    showMsg('登录已失效，请重新登录');
  };

  // ============================================================
  // 启动进入
  // ============================================================
  async function enterApp() {
    if (!S.chats.length) RC.loadChats();
    RC.paintModelBar();
    RC.renderMe();
    RC.renderThread();

    // 并行拉账号与模型（带超时）
    const results = await Promise.allSettled([
      withTimeout(RC.me(), 5000, '账号'),
      withTimeout(RC.loadCatalog(), 8000, '模型'),
    ]);

    if (results[0].status === 'fulfilled' && results[0].value && results[0].value.ok) {
      applyMe(results[0].value);
    }
    if (results[1].status === 'fulfilled') {
      const r = results[1].value;
      if (r && !r.ok) {
        // 模型拉取失败不阻断，用默认模型兜底
        RC.toast('模型列表未加载，已用默认模型');
      }
    }

    RC.paintModelBar();
    RC.renderMe();
    RC.updateSend();
    if (!S.messages.length) RC.renderThread();
  }

  function applyMe(d) {
    S.loggedIn = true;
    S.uid = d.uid || '';
    S.name = d.name || '小浣熊';
    S.phone = d.phone || '';
    S.points = d.points || 0;
    RC.renderMe();
  }

  async function refreshMe() {
    try {
      const d = await RC.me();
      if (d && d.ok) applyMe(d);
    } catch {}
  }

  // ============================================================
  // 发送
  // ============================================================
  function stopStreaming() {
    if (S.abort) {
      try { S.abort.abort(); } catch {}
    }
    RC.stopSpeak();
  }

  async function sendMessage() {
    if (S.streaming) return;

    const ta = $('input');
    const text = ta.value.trim();
    const drafts = S.drafts.slice();
    if (!text && !drafts.length) return;

    if (!S.prefs.model) {
      S.prefs.model = RC.DEFAULT_MODEL;
    }

    // 图片但模型不支持识图 → 提前拦
    if (drafts.some((a) => a.type === 'image') && !RC.visionSupported()) {
      RC.toast('当前模型不支持识图，请切换模型或移除图片');
      return;
    }

    const userMsg = {
      role: 'user',
      content: text,
      attachments: drafts,
      ts: Date.now(),
    };
    S.messages.push(userMsg);

    ta.value = '';
    S.drafts = [];
    RC.renderDrafts();
    RC.autoGrow();
    RC.renderThread();
    RC.updateSend();
    RC.scrollBottom(true);

    const aiMsg = {
      role: 'ai',
      content: '',
      reasoning: '',
      streaming: true,
      error: '',
      usage: null,
      ts: Date.now(),
    };
    S.messages.push(aiMsg);
    RC.appendRow(aiMsg);

    S.streaming = true;
    S.abort = new AbortController();
    RC.updateSend();
    RC.scrollBottom(true);

    let aborted = false;

    try {
      await RC.streamChat(
        {
          messages: RC.buildMessages(),
          model: S.prefs.model,
          effort: RC.reasoningSupported() ? S.prefs.effort : 'off',
          signal: S.abort.signal,
        },
        {
          onContent: (t) => {
            aiMsg.content += t;
            RC.scheduleRender(aiMsg);
          },
          onReasoning: (t) => {
            aiMsg.reasoning += t;
            RC.scheduleRender(aiMsg);
          },
          onUsage: (u) => {
            if (u) aiMsg.usage = u;
          },
          onError: (msg) => {
            aiMsg.error = aiMsg.error ? aiMsg.error + '；' + msg : msg;
            RC.scheduleRender(aiMsg);
          },
        }
      );
    } catch (e) {
      if (e && e.name === 'AbortError') {
        aborted = true;
        if (!aiMsg.content && !aiMsg.reasoning) aiMsg.content = '（已停止）';
      } else {
        let msg = (e && e.message) || '请求失败';
        if (/Failed to fetch|Load failed|NetworkError/i.test(msg)) {
          msg = RC.isDirect()
            ? '连不上官方服务，请检查网络'
            : '连不上代理 ' + RC.proxyBase();
        }
        if (e && e.auth === false) msg = '登录已失效，请重新登录';
        aiMsg.error = msg;
      }
    } finally {
      aiMsg.streaming = false;
      S.streaming = false;
      S.abort = null;
      if (aiMsg.ui && aiMsg.ui.render) aiMsg.ui.render(true);
      RC.scrollBottom(false);
      RC.updateSend();
      RC.syncCurrent();
      RC.renderMe();
      if (!aborted && (aiMsg.content || aiMsg.reasoning)) {
        refreshMe();
      }
      if (!aborted && aiMsg.error) {
        RC.haptic(20);
      }
    }
  }

  // ============================================================
  // 会话列表
  // ============================================================
  function renderHistory() {
    const box = $('history-list');
    if (!box) return;
    box.innerHTML = '';

    const q = String(S.search || '').trim().toLowerCase();
    const list = q
      ? S.chats.filter((c) => {
          if (String(c.title || '').toLowerCase().indexOf(q) >= 0) return true;
          return (c.messages || []).some(
            (m) => String(m.content || '').toLowerCase().indexOf(q) >= 0
          );
        })
      : S.chats;

    if (!list.length) {
      const p = el('p', 'sheet-tip');
      p.style.textAlign = 'center';
      p.style.paddingTop = '40px';
      p.textContent = q ? '没有匹配的对话' : '还没有对话';
      box.appendChild(p);
      return;
    }

    const pinned = list.filter((c) => c.pinned);
    const normal = list.filter((c) => !c.pinned);

    if (pinned.length && !q) {
      const l = el('div', 'section-label');
      l.textContent = '置顶';
      box.appendChild(l);
      pinned.forEach((c) => box.appendChild(convRow(c)));
    }
    if (normal.length) {
      if (pinned.length && !q) {
        const l = el('div', 'section-label');
        l.textContent = '全部';
        box.appendChild(l);
      }
      normal.forEach((c) => box.appendChild(convRow(c)));
    }
  }

  function convRow(c) {
    const row = el('div', 'conv');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const main = el('div', 'conv-main');
    const title = el('div', 'conv-title');
    if (c.id === S.chatId) title.appendChild(el('span', 'live'));
    if (c.pinned) {
      const pin = el('span', 'pin');
      pin.appendChild(icon('pin'));
      title.appendChild(pin);
    }
    title.appendChild(el('span', 'tx', c.title || '新对话'));
    main.appendChild(title);

    const qCount = (c.messages || []).filter((m) => m.role === 'user').length;
    const meta = el('div', 'conv-meta');
    meta.appendChild(document.createTextNode(qCount ? qCount + ' 问' : '空对话'));
    meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(document.createTextNode(RC.fmtTime(c.updatedAt)));
    main.appendChild(meta);
    row.appendChild(main);

    const more = el('button', 'conv-more');
    more.type = 'button';
    more.setAttribute('aria-label', '更多操作');
    more.appendChild(icon('more'));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      convActions(c);
    });
    row.appendChild(more);

    const open = () => {
      if (RC.switchChat(c.id)) {
        RC.renderThread();
        RC.renderHistory();
        RC.paintModelBar();
        RC.updateSend();
        RC.setTab('chat');
        RC.renderMe();
      }
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return row;
  }

  function convActions(c) {
    RC.openActions([
      {
        icon: 'pin',
        label: c.pinned ? '取消置顶' : '置顶',
        onSelect: () => {
          RC.togglePin(c.id);
          renderHistory();
          RC.renderMe();
          RC.haptic(6);
        },
      },
      {
        icon: 'edit',
        label: '重命名',
        onSelect: () => {
          RC.openTextEditor('重命名对话', c.title || '', (next) => {
            if (!String(next || '').trim()) return;
            RC.renameChat(c.id, next);
            renderHistory();
            if (c.id === S.chatId) RC.paintModelBar();
            RC.toast('已重命名');
          });
        },
      },
      {
        icon: 'share',
        label: '导出',
        onSelect: () => exportChat(c),
      },
      {
        icon: 'trash',
        label: '删除',
        danger: true,
        onSelect: async () => {
          const ok = await RC.confirmBox('删除「' + (c.title || '新对话') + '」？此操作不可恢复。', {
            okText: '删除', danger: true,
          });
          if (!ok) return;
          RC.deleteChat(c.id);
          RC.hydrateCurrent();
          RC.renderThread();
          renderHistory();
          RC.renderMe();
          RC.toast('已删除');
        },
      },
    ]);
  }

  // ============================================================
  // 导出 / 分享
  // ============================================================
  function chatToMarkdown(c) {
    const msgs = c ? (c.messages || []) : S.messages;
    let md = '# ' + ((c && c.title) || '对话') + '\n\n';
    md += '_小浣熊移动端 · ' + new Date().toLocaleString('zh-CN') + '_\n\n';
    msgs.forEach((m) => {
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

  async function exportChat(c) {
    const target = c || RC.currentChat();
    const msgs = target ? (target.messages || []) : S.messages;
    if (!msgs.length) {
      RC.toast('当前对话是空的');
      return;
    }
    const md = chatToMarkdown(target);
    const ok = await RC.share({ title: (target && target.title) || '小浣熊对话', text: md });
    if (ok) RC.toast('已分享');
  }

  function exportCurrent() {
    exportChat(null);
  }

  async function shareMessage(m) {
    const text = String(m.content || '');
    if (!text) return;
    await RC.share({ title: '小浣熊', text });
  }

  // ============================================================
  // 云端备份（服务端按账号隔离存储）
  // ============================================================
  function slimForSync() {
    return S.chats.map((c) => ({
      id: c.id,
      title: c.title,
      system: c.system || '',
      pinned: !!c.pinned,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: (c.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        reasoning: m.reasoning || '',
        attachments: (m.attachments || []).filter((a) => a.type === 'text'),
        usage: m.usage || null,
        ts: m.ts || 0,
      })),
    }));
  }

  async function syncUpload() {
    if (RC.isDirect()) {
      RC.toast('云备份需要连接自建代理（服务端）后才能使用');
      return;
    }
    RC.syncCurrent();
    const chats = slimForSync();
    if (!chats.length) {
      RC.toast('没有可备份的对话');
      return;
    }
    const ok = await RC.confirmBox(
      '把当前 ' + chats.length + ' 个对话备份到服务端？会覆盖上一次备份。',
      { okText: '开始备份' }
    );
    if (!ok) return;
    try {
      RC.toast('正在备份…');
      const r = await RC.api('/api/sync', { method: 'PUT', body: { chats } });
      if (r && r.ok) {
        RC.toast('已备份 ' + (r.count || chats.length) + ' 个对话');
      } else {
        RC.toast((r && r.message) || '备份失败');
      }
    } catch (e) {
      RC.toast(e.message || '备份失败');
    }
  }

  async function syncDownload() {
    if (RC.isDirect()) {
      RC.toast('云备份需要连接自建代理（服务端）后才能使用');
      return;
    }
    try {
      const r = await RC.api('/api/sync');
      if (!r || !r.ok) {
        RC.toast((r && r.message) || '读取备份失败');
        return;
      }
      const chats = Array.isArray(r.chats) ? r.chats : [];
      if (!chats.length) {
        RC.toast('服务端还没有备份');
        return;
      }
      const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN') : '未知时间';
      const ok = await RC.confirmBox(
        '找到 ' + chats.length + ' 个对话（备份于 ' + when + '）。\n恢复会合并到本地，同 ID 的对话以备份为准。',
        { okText: '恢复' }
      );
      if (!ok) return;

      const byId = new Map(S.chats.map((c) => [c.id, c]));
      chats.forEach((c) => {
        if (!c || !c.id) return;
        byId.set(c.id, {
          id: String(c.id),
          title: c.title || '新对话',
          messages: Array.isArray(c.messages) ? c.messages : [],
          system: c.system || '',
          pinned: !!c.pinned,
          createdAt: c.createdAt || Date.now(),
          updatedAt: c.updatedAt || Date.now(),
        });
      });
      S.chats = Array.from(byId.values());
      RC.sortChats();
      RC.saveChats();
      RC.hydrateCurrent();
      RC.renderThread();
      renderHistory();
      RC.renderMe();
      RC.toast('已恢复 ' + chats.length + ' 个对话');
    } catch (e) {
      RC.toast(e.message || '恢复失败');
    }
  }

  // ============================================================
  // 数据清理
  // ============================================================
  function clearAllData() {
    [RC.K.chats, RC.K.active, RC.K.legacyChats, RC.K.legacyActive].forEach((k) => RC.lsDel(k));
    S.chats = [];
    S.chatId = '';
    S.messages = [];
    RC.createChat();
    RC.renderThread();
    renderHistory();
    RC.renderMe();
    RC.toast('已清理本地对话');
  }

  // ============================================================
  // 系统提示词
  // ============================================================
  function openSystemSheet() {
    const ta = $('system-input');
    if (ta) ta.value = S.system || '';
    renderSystemPresets();
    RC.openSheet('sheet-system');
  }

  function renderSystemPresets() {
    const box = $('system-presets');
    if (!box) return;
    box.innerHTML = '';
    RC.BUILTIN_PROMPTS.forEach((p) => {
      const b = el('button', 'pill');
      b.type = 'button';
      b.textContent = p.name;
      b.addEventListener('click', () => {
        const ta = $('system-input');
        if (ta) ta.value = p.text;
        RC.haptic(6);
      });
      box.appendChild(b);
    });
  }

  function saveSystem() {
    const ta = $('system-input');
    S.system = (ta ? ta.value : '').trim().slice(0, 4000);
    RC.syncCurrent();
    RC.closeSheet('sheet-system');
    RC.renderMe();
    RC.toast(S.system ? '已设置系统提示词' : '已清除系统提示词');
  }

  // ============================================================
  // 连接
  // ============================================================
  async function testConn() {
    const el1 = $('set-conn');
    const el2 = $('diag-net');
    if (el1) { el1.textContent = '检测中…'; el1.className = 'val'; }
    if (el2) { el2.textContent = '检测中…'; el2.className = 'val'; }

    let r;
    if (RC.isDirect()) {
      r = await RC.probe(8000);
    } else {
      r = await RC.probeProxy(RC.proxyBase());
    }

    const ok = !!r.ok;
    const label = ok
      ? '已连接' + (r.ms ? ' · ' + r.ms + 'ms' : '')
      : (r.message || r.reason || '连不上');

    if (el1) {
      el1.textContent = ok ? '已连接' : label;
      el1.className = 'val ' + (ok ? 'ok' : 'bad');
    }
    if (el2) {
      el2.textContent = label;
      el2.className = 'val ' + (ok ? 'ok' : 'bad');
    }
    return ok;
  }

  function openDiag() {
    const mode = $('diag-mode');
    if (mode) mode.textContent = RC.channelLabel();
    const auth = $('diag-auth');
    if (auth) auth.textContent = global.RaccoonDirect.hasAuth() ? '已登录' : '未登录';
    const err = $('diag-err');
    if (err) err.textContent = S.lastError || '—';
    RC.openSheet('sheet-diag');
    testConn();
  }

  async function useProxy() {
    if (!global.RaccoonDirect.hasAuth()) {
      openDiag();
      return;
    }
    const cur = RC.proxyBase();
    const input = global.prompt(
      '代理服务地址（例如 http://127.0.0.1:8799）\n留空 = 自动检测；取消 = 不改',
      cur || ''
    );
    if (input === null) return;

    let v = String(input).trim().replace(/\/+$/, '');
    if (!v) {
      RC.toast('正在检测…');
      v = await RC.autoDetectProxy();
      if (!v) {
        RC.toast('没找到可用的代理，保持直连');
        return;
      }
    }
    const r = await RC.probeProxy(v);
    if (!r.ok) {
      RC.toast(v + '：' + (r.reason || '无法使用'));
      return;
    }
    RC.lsSet(RC.K.proxy, v);
    global.RaccoonDirect.clearAuth();
    RC.renderMe();
    RC.toast('已切换到代理');
    reLoginAfterChannelChange();
  }

  function useDirect() {
    RC.lsDel(RC.K.proxy);
    global.RaccoonDirect.clearAuth();
    RC.renderMe();
    RC.toast('已恢复直连');
    reLoginAfterChannelChange();
  }

  function reLoginAfterChannelChange() {
    RC.closeAllSheets();
    refreshMe().then((ok) => {
      if (!S.loggedIn) {
        RC.showView('login');
      }
    });
    setTimeout(() => {
      if (!S.loggedIn) RC.showView('login');
    }, 1200);
  }

  // ============================================================
  // 绑定
  // ============================================================
  function bind() {
    // --- 登录 ---
    $('btn-send-code').addEventListener('click', requestCode);
    $('btn-login').addEventListener('click', doPhoneLogin);
    $('btn-token-go').addEventListener('click', doTokenLogin);
    $('btn-token-toggle').addEventListener('click', () => {
      const p = $('token-panel');
      const hidden = p.classList.toggle('hidden');
      if (!hidden) $('token-input').focus();
    });
    $('nation').addEventListener('change', () => {
      S.prefs.nation = $('nation').value;
      RC.savePrefs();
      S.verificationId = '';
      $('code').value = '';
    });
    $('phone').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (S.verificationId) doPhoneLogin();
        else requestCode();
      }
    });
    $('code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doPhoneLogin();
      }
    });
    $('btn-diag').addEventListener('click', openDiag);

    // --- 标签页 ---
    $$('.tab').forEach((t) => {
      t.addEventListener('click', () => RC.setTab(t.getAttribute('data-tab')));
    });

    // --- 顶栏 ---
    $('btn-model').addEventListener('click', () => {
      RC.renderModelList();
      RC.openSheet('sheet-model');
    });
    $('btn-effort').addEventListener('click', () => {
      if (!RC.reasoningSupported()) {
        RC.toast('当前模型不支持深度思考');
        return;
      }
      RC.renderEffortList();
      RC.openSheet('sheet-effort');
    });
    $('btn-points').addEventListener('click', () => RC.setTab('me'));
    $('btn-new').addEventListener('click', newChat);
    $('btn-history-new').addEventListener('click', () => {
      newChat();
      RC.setTab('chat');
    });

    // --- 搜索 ---
    const search = $('history-search');
    if (search) {
      search.addEventListener('input', RC.debounce((e) => {
        S.search = e.target.value;
        renderHistory();
      }, 120));
    }

    // --- 滚动 ---
    RC.bindScroll();
    $('jump-bottom').addEventListener('click', () => {
      S.unread = 0;
      RC.scrollBottom(true);
    });

    // --- 代码复制（事件委托） ---
    const thread = $('thread');
    thread.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('.code-copy') : null;
      if (!btn) return;
      const block = btn.closest('.code-block');
      const pre = block ? block.querySelector('pre') : null;
      RC.copyText(pre ? pre.textContent : '', '代码已复制');
    });

    // --- 图片放大 ---
    RC.bindImageZoom();

    // --- 输入区 ---
    RC.bindComposer();

    // --- 我的 / 设置 ---
    RC.bindMe();
    RC.bindPrompts();
    RC.bindModules && RC.bindModules();
    $('system-save').addEventListener('click', saveSystem);

    // --- 诊断 ---
    $('diag-retest').addEventListener('click', testConn);
    $('diag-proxy').addEventListener('click', useProxy);
    $('diag-direct').addEventListener('click', useDirect);

    // --- 弹层 ---
    RC.bindSheets();
    RC.bindScrollShade();

    // --- 键盘 ---
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (RC.closeTopSheet()) e.preventDefault();
      }
    });

    // --- 安卓返回键 / 手势 ---
    if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App) {
      try {
        global.Capacitor.Plugins.App.addListener('backButton', () => {
          if (!RC.onBack()) {
            global.Capacitor.Plugins.App.exitApp();
          }
        });
      } catch {}
    }

    // --- 键盘弹起时贴底 ---
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', () => {
        if (document.activeElement === $('input')) {
          setTimeout(() => RC.scrollBottom(true), 60);
        }
      });
    }
  }

  function newChat() {
    if (S.streaming) stopStreaming();
    RC.syncCurrent();
    RC.createChat();
    RC.renderThread();
    RC.renderHistory();
    RC.renderMe();
    RC.paintModelBar();
    RC.updateSend();
    RC.setTab('chat');
    setTimeout(() => {
      try { $('input').focus({ preventScroll: true }); } catch {}
    }, 80);
  }

  // ============================================================
  // 启动
  // ============================================================

  // 带超时的 Promise 包装：网络不通时也不会把启动卡死
  function withTimeout(promise, ms, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error((label || '请求') + '超时')), ms);
      }),
    ]);
  }

  async function init() {
    RC.loadPrefs();
    RC.loadPrompts();
    RC.applyTheme();
    RC.applyFontScale();
    RC.loadChats();

    bind();

    RC.autoGrow();
    RC.updateSend();
    RC.renderDrafts();

    // 界面先可用：立刻显示登录页并收起启动层（网络慢也不卡启动屏）
    const bootEl = $('boot');
    if (bootEl) {
      setTimeout(() => bootEl.classList.add('gone'), 60);
      setTimeout(() => { bootEl.style.display = 'none'; }, 420);
    }
    RC.showView('login');
    RC.renderNations();

    // 配置（带超时，避免卡死）
    try {
      const cfg = await withTimeout(RC.loginConfig(), 5000, '配置');
      if (cfg && cfg.ok) {
        loginCfg = {
          captcha: cfg.captcha || loginCfg.captcha,
          nationCodes: cfg.nationCodes || loginCfg.nationCodes,
          keyRequired: !!cfg.keyRequired,
        };
      }
    } catch {}
    RC.renderNations();

    // 已登录直接进
    let entered = false;
    const hasLocal = global.RaccoonDirect.hasAuth() || !RC.isDirect();
    if (hasLocal) {
      try {
        const d = await withTimeout(RC.me(), 6000, '账号');
        if (d && d.ok) {
          applyMe(d);
          RC.showView('app');
          RC.setTab('chat', { silent: true });
          await enterApp();
          entered = true;
        }
      } catch (e) {
        const m = (e && e.message) || '';
        if (m && !/^未登录|登录已失效/.test(m) && !(e && e.auth === false)) {
          // 网络问题不拦在登录页
        }
      }
    }

    if (!entered) {
      RC.showView('login');
      RC.renderNations();
    }

    // 收起启动层
    const boot = $('boot');
    if (boot) {
      setTimeout(() => boot.classList.add('gone'), 100);
      setTimeout(() => { boot.style.display = 'none'; }, 460);
    }

    // 深链调试
    if (entered) {
      if (location.hash === '#history') RC.setTab('history');
      else if (location.hash === '#me') RC.setTab('me');
    }
  }

  Object.assign(RC, {
    requestCode, doPhoneLogin, doTokenLogin, logout, enterApp, renderNations,
    sendMessage, stopStreaming, newChat,
    renderHistory, exportCurrent, exportChat, shareMessage,
    clearAllData, openSystemSheet, saveSystem, syncUpload, syncDownload,
    testConn, openDiag, useProxy, useDirect,
    refreshMe, init,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { RC.init(); });
  } else {
    RC.init();
  }
})(window);
