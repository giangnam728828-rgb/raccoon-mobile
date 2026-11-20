/* ============================================================
   对话流：渲染 / 流式 / 滚动 / 消息操作
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, el, icon, state } = RC;

  // ---------- 滚动 ----------
  function threadEl() {
    return $('thread');
  }

  function nearBottom(slack) {
    const box = threadEl();
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < (slack || 150);
  }

  function scrollBottom(force) {
    const box = threadEl();
    if (!box) return;
    if (force || nearBottom()) {
      box.scrollTop = box.scrollHeight;
      if (S.unread) {
        S.unread = 0;
      }
    }
    updateJump();
  }

  function updateJump() {
    const btn = $('jump-bottom');
    if (!btn) return;
    const show = !nearBottom(120);
    btn.classList.toggle('hidden', !show);
    const n = $('new-count');
    if (n) {
      if (S.unread > 0) {
        n.textContent = String(Math.min(S.unread, 99));
        n.classList.remove('hidden');
        btn.classList.add('has-new');
      } else {
        n.classList.add('hidden');
        btn.classList.remove('has-new');
      }
    }
  }

  function bindScroll() {
    const box = threadEl();
    if (!box) return;
    box.addEventListener('scroll', () => updateJump(), { passive: true });
  }

  // ---------- 思考块 ----------
  function buildThink(m) {
    const details = el('details', 'think');
    details.hidden = true;
    const summary = el('summary');
    summary.appendChild(icon('spark'));
    const label = el('span', null, '思考过程');
    summary.appendChild(label);
    const body = el('div', 'think-body');
    details.appendChild(summary);
    details.appendChild(body);
    return { details, summary, label, body };
  }

  // ---------- 用户消息 ----------
  function buildUserRow(m) {
    const row = el('div', 'msg msg-user');

    if (m.attachments && m.attachments.length) {
      const imgs = m.attachments.filter((a) => a.type === 'image');
      const docs = m.attachments.filter((a) => a.type === 'text');
      if (imgs.length) {
        const grid = el('div', 'att-grid');
        imgs.forEach((a) => {
          const img = el('img');
          img.src = a.dataUrl || '';
          img.alt = a.name || '图片';
          img.loading = 'lazy';
          grid.appendChild(img);
        });
        row.appendChild(grid);
      }
      if (docs.length) {
        const grid = el('div', 'att-grid');
        docs.forEach((a) => {
          const chip = el('div', 'att-file');
          chip.appendChild(icon('file', 'sm'));
          chip.appendChild(el('span', 'nm', a.name || '文件'));
          grid.appendChild(chip);
        });
        row.appendChild(grid);
      }
    }

    const note = el('div', 'user-note selectable');
    note.textContent = m.content || '';
    row.appendChild(note);

    m.ui = { row, note };

    row.addEventListener('click', () => {
      if (S.streaming) return;
      openMessageActions(m);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (S.streaming) return;
      openMessageActions(m);
    });

    return row;
  }

  // ---------- 助手消息 ----------
  function buildAiRow(m) {
    const row = el('div', 'msg msg-ai');
    const sheet = el('div', 'ai-sheet');
    row.appendChild(sheet);

    const think = buildThink(m);
    sheet.appendChild(think.details);

    const waiting = el('div', 'waiting');
    waiting.innerHTML = '<i></i><i></i><i></i>';
    sheet.appendChild(waiting);

    const body = el('div', 'body md selectable');
    sheet.appendChild(body);

    const errBox = el('div', 'inline-err');
    errBox.hidden = true;
    const errIcon = icon('warn', 'sm');
    const errText = el('span');
    errBox.appendChild(errIcon);
    errBox.appendChild(errText);
    sheet.appendChild(errBox);

    const acts = el('div', 'acts');
    const bCopy = mkAct('copy', '复制', () => RC.copyText(m.content, '已复制'));
    const bRetry = mkAct('refresh', '重试', () => RC.retryFrom(m));
    acts.appendChild(bCopy);
    acts.appendChild(bRetry);
    acts.appendChild(el('span', 'spacer'));
    const meta = el('span', 'meta');
    acts.appendChild(meta);
    row.appendChild(acts);

    let mdAt = 0;
    let mdLen = -1;
    let openedByStream = false;

    function renderNow(final) {
      // 思考
      const hasR = !!(m.reasoning && m.reasoning.length);
      think.details.hidden = !hasR;
      if (hasR) {
        if (think.body.textContent !== m.reasoning) think.body.textContent = m.reasoning;
        if (m.streaming && S.prefs.showThought && !openedByStream) {
          openedByStream = true;
          think.details.open = true;
        }
        if (!m.streaming && openedByStream) {
          openedByStream = false;
          think.details.open = false;
        }
        if (m.streaming) {
          think.label.textContent = '正在思考…';
        } else {
          think.label.textContent = '思考过程';
        }
      }

      // 正文：流式时按「增长量 + 时间」双重阈值重解析
      const text = m.content || '';
      const now = Date.now();
      const grew = text.length - mdLen;
      const shouldParse =
        final ||
        mdLen < 0 ||
        (grew >= 24 && now - mdAt >= 110) ||
        (grew > 0 && now - mdAt >= 260) ||
        (text.length === 0 && mdLen !== 0);

      if (shouldParse) {
        mdAt = now;
        mdLen = text.length;
        if (text) {
          body.innerHTML = global.MD.render(text);
        } else {
          body.innerHTML = '';
        }
        body.classList.toggle('caret', !!m.streaming && !!text);
      }

      // 等待点
      const showWait = m.streaming && !text;
      waiting.style.display = showWait ? 'flex' : 'none';

      // 错误
      if (m.error) {
        errBox.hidden = false;
        errText.textContent = m.error;
      } else {
        errBox.hidden = true;
      }

      row.classList.toggle('streaming', !!m.streaming);
      acts.classList.toggle('hidden', !!m.streaming || (!text && !m.error));

      // 用量
      if (m.usage && (m.usage.total_tokens || m.usage.prompt_tokens || m.usage.completion_tokens)) {
        const total = m.usage.total_tokens ||
          (m.usage.prompt_tokens || 0) + (m.usage.completion_tokens || 0);
        meta.textContent = total ? total + ' tokens' : '';
      } else {
        meta.textContent = '';
      }
    }

    m.ui = { row, body, acts, render: renderNow, setStreaming: () => {} };
    renderNow(true);
    return row;
  }

  function mkAct(ico, label, onClick) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    // Tooltip (title) for desktop
    b.title = label;
    b.appendChild(icon(ico));
    // No text label - icon only per design
    // b.appendChild(document.createTextNode(label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function createRow(m) {
    return m.role === 'user' ? buildUserRow(m) : buildAiRow(m);
  }

  // ---------- 渲染线程 ----------
  function renderThread() {
    const box = threadEl();
    if (!box) return;
    box.innerHTML = '';

    // v9 修复：空对话始终显示空态（不管是不是新建的）
    // 保险：如果当前 chatId 对应的对话确实没有消息，就强制同步为空
    const cur = RC.currentChat && RC.currentChat();
    if (cur && Array.isArray(cur.messages) && cur.messages.length === 0 && S.messages.length) {
      S.messages = [];
    }

    if (!S.messages.length) {
      box.appendChild(buildEmpty());
      updateJump();
      return;
    }

    const frag = document.createDocumentFragment();
    S.messages.forEach((m) => {
      m.ui = null;
      frag.appendChild(createRow(m));
    });
    box.appendChild(frag);
    scrollBottom(true);
  }

  // ---------- 空态 ----------
  function buildEmpty() {
    const wrap = el('div', 'empty');

    const art = el('div', 'empty-art');
    const img = el('img');
    img.src = '/img/brand-sm.jpg';
    img.alt = '';
    img.width = 74;
    img.height = 74;
    art.appendChild(img);
    wrap.appendChild(art);

    // v9: 优化的空态文案
    wrap.appendChild(el('h2', 'empty-title', '开始对话'));
    wrap.appendChild(el('p', 'empty-subtitle', '提问、拍照，或丢一份文件进来'));

    const quick = [
      { ico: 'pen', title: '写点什么', hint: '文案 / 邮件 / 总结', text: '帮我写' },
      { ico: 'spark', title: '想清楚一件事', hint: '分析 / 对比 / 决策', text: '帮我分析' },
      { ico: 'file', title: '读完这份材料', hint: '提取要点 / 找问题', text: '帮我总结下面的内容：\n\n' },
      { ico: 'search', title: '查一查', hint: '概念 / 出处 / 用法', text: '我想了解' },
    ];

    const list = el('div', 'quick-list');
    quick.forEach((q) => {
      const b = el('button', 'quick-item');
      b.type = 'button';
      b.appendChild(icon(q.ico));
      const tx = el('span', 'tx', q.title);
      b.appendChild(tx);
      b.appendChild(el('span', 'hint', q.hint));
      b.addEventListener('click', () => {
        RC.fillComposer(q.text);
      });
      list.appendChild(b);
    });
    wrap.appendChild(list);

    return wrap;
  }

  // ---------- 追加单条 ----------
  function appendRow(m) {
    const box = threadEl();
    if (!box) return;
    const empty = box.querySelector('.empty');
    if (empty) empty.remove();
    box.appendChild(m.ui ? m.ui.row : createRow(m));
  }

  // ---------- 节流重绘 ----------
  let pending = null;
  function scheduleRender(m) {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      if (m && m.ui && m.ui.render) m.ui.render(false);
      if (nearBottom()) scrollBottom(true);
      else updateJump();
    });
  }

  // ---------- 图片全屏 ----------
  function openImage(src, alt) {
    if (!src) return;
    let box = document.getElementById('lightbox');
    if (!box) {
      box = el('div', 'lightbox hidden');
      box.id = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', '图片预览');

      const img = el('img');
      const close = el('button', 'lb-close');
      close.type = 'button';
      close.setAttribute('aria-label', '关闭');
      close.appendChild(icon('close'));

      box.appendChild(img);
      box.appendChild(close);
      document.body.appendChild(box);

      const hide = () => box.classList.add('hidden');
      close.addEventListener('click', hide);
      box.addEventListener('click', (e) => {
        if (e.target === box) hide();
      });
    }
    const img = box.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    box.classList.remove('hidden');
  }

  function bindImageZoom() {
    const thread = $('thread');
    if (!thread || thread.dataset.zoomBound) return;
    thread.dataset.zoomBound = '1';
    thread.addEventListener('click', (e) => {
      const img = e.target.closest ? e.target.closest('.att-grid img') : null;
      if (!img) return;
      e.stopPropagation();
      openImage(img.src, img.alt);
    });
  }

  // ---------- 消息操作 ----------
  function openMessageActions(m) {
    const isAi = m.role === 'ai';
    const items = [];

    if (isAi) {
      items.push({
        icon: 'copy',
        label: '复制回答',
        onSelect: () => RC.copyText(m.content, '已复制'),
      });
      if (m.reasoning) {
        items.push({
          icon: 'spark',
          label: '复制思考过程',
          onSelect: () => RC.copyText(m.reasoning, '已复制思考过程'),
        });
      }
      items.push({
        icon: 'refresh',
        label: '重新生成',
        onSelect: () => RC.retryFrom(m),
      });
      items.push({
        icon: 'volume',
        label: '朗读',
        onSelect: () => RC.speak(m.content),
      });
      items.push({
        icon: 'share',
        label: '分享',
        onSelect: () => RC.shareMessage(m),
      });
    } else {
      items.push({
        icon: 'copy',
        label: '复制',
        onSelect: () => RC.copyText(m.content, '已复制'),
      });
      items.push({
        icon: 'edit',
        label: '编辑并重发',
        onSelect: () => RC.editMessage(m),
      });
    }

    items.push({
      icon: 'trash',
      label: isAi ? '删除这条回答' : '删除这条提问',
      danger: true,
      onSelect: () => RC.deleteMessage(m),
    });

    RC.openActions(items);
  }

  // ---------- 朗读 ----------
  let speaking = null;
  function speak(text) {
    if (!('speechSynthesis' in global)) {
      RC.toast('当前环境不支持朗读');
      return;
    }
    if (speaking) {
      global.speechSynthesis.cancel();
      speaking = null;
      if (currentSpeakBtn) currentSpeakBtn.classList.remove('live');
      currentSpeakBtn = null;
      return;
    }
    const clean = String(text || '')
      .replace(/```[\s\S]*?```/g, '。代码块。')
      .replace(/[#*_>`|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean.slice(0, 4000));
    u.lang = 'zh-CN';
    u.rate = 1.02;
    u.onend = () => {
      speaking = null;
      if (currentSpeakBtn) currentSpeakBtn.classList.remove('live');
      currentSpeakBtn = null;
    };
    u.onerror = u.onend;
    speaking = u;
    global.speechSynthesis.speak(u);
    RC.toast('正在朗读，再点一次停止');
  }
  let currentSpeakBtn = null;

  function stopSpeak() {
    if (speaking && global.speechSynthesis) {
      global.speechSynthesis.cancel();
      speaking = null;
    }
  }

  // ---------- 消息操作实现（由 app.js 注入业务） ----------
  function retryFrom(m) {
    if (S.streaming) return;
    const idx = S.messages.indexOf(m);
    if (idx < 0) return;
    let ui = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (S.messages[i].role === 'user') { ui = i; break; }
    }
    if (ui < 0) return;
    const prev = S.messages[ui];
    S.messages = S.messages.slice(0, ui);
    renderThread();
    RC.syncCurrent();
    RC.fillComposer(prev.content || '');
    S.drafts = (prev.attachments || []).slice();
    RC.renderDrafts();
    RC.sendMessage();
  }

  function editMessage(m) {
    const idx = S.messages.indexOf(m);
    if (idx < 0) return;
    const old = m.content || '';
    openTextEditor('编辑提问', old, (next) => {
      if (!next.trim()) return;
      // 截断到此条之前，用新内容重发
      S.messages = S.messages.slice(0, idx);
      renderThread();
      RC.syncCurrent();
      RC.fillComposer(next);
      RC.sendMessage();
    });
  }

  function deleteMessage(m) {
    const idx = S.messages.indexOf(m);
    if (idx < 0) return;
    S.messages.splice(idx, 1);
    renderThread();
    RC.syncCurrent();
    RC.renderMe && RC.renderMe();
    RC.toast('已删除');
  }

  // 简易文本编辑弹层（复用系统 prompt 太丑，这里用确认框思路）
  function openTextEditor(title, value, onSave) {
    // 复用系统提示词弹层不合适，这里就地造一个
    let sheet = $('sheet-editor');
    if (!sheet) {
      sheet = el('div', 'sheet hidden');
      sheet.id = 'sheet-editor';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.innerHTML =
        '<div class="sheet-scrim" data-close></div>' +
        '<div class="sheet-panel tall">' +
        '<div class="sheet-grip"></div>' +
        '<div class="sheet-head"><span class="t"></span>' +
        '<button class="icon-btn sm" data-close type="button" aria-label="关闭">' +
        '<svg class="i"><use href="#i-close"/></svg></button></div>' +
        '<div class="sheet-body"><textarea class="input" id="editor-input" ' +
        'style="min-height:160px" spellcheck="false"></textarea></div>' +
        '<div class="sheet-actions"><button class="btn btn-primary btn-block" ' +
        'id="editor-save" type="button">保存</button></div>' +
        '</div>';
      document.body.appendChild(sheet);
      RC.bindSheets();
    }
    sheet.querySelector('.t').textContent = title;
    const ta = sheet.querySelector('#editor-input');
    ta.value = String(value || '');
    const saveBtn = sheet.querySelector('#editor-save');
    // 替换监听
    const fresh = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(fresh, saveBtn);
    fresh.addEventListener('click', () => {
      const v = ta.value;
      RC.closeSheet('sheet-editor');
      onSave(v);
    });
    RC.openSheet('sheet-editor');
  }

  Object.assign(RC, {
    threadEl, nearBottom, scrollBottom, updateJump, bindScroll,
    renderThread, buildEmpty, appendRow, scheduleRender, createRow,
    openMessageActions, retryFrom, editMessage, deleteMessage,
    speak, stopSpeak, openTextEditor, openImage, bindImageZoom,
  });
})(window);
