/* ============================================================
   输入区：文本 / 附件 / 语音
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, el, icon } = RC;

  const LIMITS = {
    imageEdge: 1400,
    imageQuality: 0.86,
    maxImages: 6,
    maxDocBytes: 200 * 1024,
    maxDocs: 5,
  };

  // ---------- 自适应高度 ----------
  function autoGrow() {
    const ta = $('input');
    if (!ta) return;
    ta.style.height = 'auto';
    const h = Math.min(ta.scrollHeight || 34, 140);
    ta.style.height = h + 'px';
  }

  function fillComposer(text) {
    const ta = $('input');
    if (!ta) return;
    ta.value = text;
    autoGrow();
    updateSend();
    try { ta.focus({ preventScroll: true }); } catch {}
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function clearComposer() {
    const ta = $('input');
    if (ta) ta.value = '';
    S.drafts = [];
    renderDrafts();
    autoGrow();
    updateSend();
  }

  // ---------- 发送按钮状态 ----------
  function updateSend() {
    const btn = $('btn-send');
    if (!btn) return;
    const streaming = S.streaming;
    const ta = $('input');
    const hasText = !!(ta && ta.value.trim());
    const hasDraft = S.drafts.length > 0;

    btn.classList.toggle('streaming', streaming);
    const sendIco = btn.querySelector('.ico-send');
    const stopIco = btn.querySelector('.ico-stop');
    if (sendIco) sendIco.classList.toggle('hidden', streaming);
    if (stopIco) stopIco.classList.toggle('hidden', !streaming);
    btn.disabled = streaming ? false : !(hasText || hasDraft);
    btn.setAttribute('aria-label', streaming ? '停止生成' : '发送');

    // 思考标签
    const thinkLabel = $('think-label');
    const btnThink = $('btn-think');
    if (thinkLabel) {
      const ok = RC.reasoningSupported();
      const e = S.prefs.effort;
      if (!ok) {
        thinkLabel.textContent = '不支持';
        if (btnThink) btnThink.classList.remove('on');
      } else if (!e || e === 'off') {
        thinkLabel.textContent = '思考关';
        if (btnThink) btnThink.classList.remove('on');
      } else {
        const eff = RC.EFFORTS.find((x) => x.id === e);
        thinkLabel.textContent = '思考 ' + (eff ? eff.name : '');
        if (btnThink) btnThink.classList.add('on');
      }
    }
  }

  // ---------- 文件读取 ----------
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(new Error('读取失败'));
      fr.readAsDataURL(file);
    });
  }

  function readAsText(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(new Error('读取失败'));
      fr.readAsText(file);
    });
  }

  async function compressImage(file) {
    const dataUrl = await readAsDataURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('图片解码失败'));
      i.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, LIMITS.imageEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    if (scale === 1 && dataUrl.length < 700 * 1024) {
      return { dataUrl, w: tw, h: th };
    }

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, tw, th);
    let out = dataUrl;
    try {
      out = canvas.toDataURL('image/jpeg', LIMITS.imageQuality);
    } catch {
      out = dataUrl;
    }
    return { dataUrl: out, w: tw, h: th };
  }

  async function addImages(files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) return;

    if (!RC.visionSupported()) {
      RC.toast('当前模型不支持识图，请先切换到支持识图的模型');
      return;
    }

    const used = S.drafts.filter((a) => a.type === 'image').length;
    const room = LIMITS.maxImages - used;
    if (room <= 0) {
      RC.toast('一次最多 ' + LIMITS.maxImages + ' 张图片');
      return;
    }

    let added = 0;
    for (const f of list.slice(0, room)) {
      try {
        const c = await compressImage(f);
        S.drafts.push({
          type: 'image',
          name: f.name || '图片',
          dataUrl: c.dataUrl,
          w: c.w,
          h: c.h,
        });
        added++;
      } catch {
        RC.toast('有一张图片读取失败');
      }
    }
    if (added) RC.haptic(6);
    renderDrafts();
    updateSend();
  }

  async function addDocs(files) {
    const list = Array.from(files || []);
    if (!list.length) return;

    const room = LIMITS.maxDocs - S.drafts.filter((a) => a.type === 'text').length;
    if (room <= 0) {
      RC.toast('一次最多 ' + LIMITS.maxDocs + ' 个文件');
      return;
    }

    let added = 0;
    for (const f of list.slice(0, room)) {
      if (f.size > LIMITS.maxDocBytes) {
        RC.toast(f.name + ' 超过 200KB');
        continue;
      }
      try {
        const text = await readAsText(f);
        S.drafts.push({ type: 'text', name: f.name || '文本', text });
        added++;
      } catch {
        RC.toast(f.name + ' 读取失败');
      }
    }
    if (added) RC.haptic(6);
    renderDrafts();
    updateSend();
  }

  // ---------- 草稿附件渲染 ----------
  function renderDrafts() {
    const box = $('draft');
    if (!box) return;
    box.innerHTML = '';
    if (!S.drafts.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');

    S.drafts.forEach((a, i) => {
      const chip = el('div', 'draft-chip');
      if (a.type === 'image') {
        const img = el('img');
        img.src = a.dataUrl;
        img.alt = a.name || '图片';
        chip.appendChild(img);
      } else {
        const box2 = el('div', 'ico');
        box2.appendChild(icon('file', 'sm'));
        chip.appendChild(box2);
      }
      chip.appendChild(el('span', 'nm', a.type === 'image' ? '图片' : a.name));

      const x = el('button', 'x');
      x.type = 'button';
      x.setAttribute('aria-label', '移除 ' + (a.name || '附件'));
      x.appendChild(icon('close'));
      x.addEventListener('click', () => {
        S.drafts.splice(i, 1);
        renderDrafts();
        updateSend();
      });
      chip.appendChild(x);
      box.appendChild(chip);
    });
  }

  // ---------- 语音 ----------
  let recog = null;

  function setupVoice() {
    const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    const btn = $('btn-voice');
    if (!SR) {
      if (btn) btn.classList.add('hidden');
      return;
    }
    try {
      recog = new SR();
    } catch {
      if (btn) btn.classList.add('hidden');
      return;
    }
    recog.lang = 'zh-CN';
    recog.interimResults = true;
    recog.continuous = false;

    let finalText = '';
    recog.onstart = () => { finalText = ''; };
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      const ta = $('input');
      if (ta) ta.value = finalText + interim;
      autoGrow();
      updateSend();
    };
    recog.onend = () => { if (btn) btn.classList.remove('live'); };
    recog.onerror = () => { if (btn) btn.classList.remove('live'); };
  }

  function toggleVoice() {
    const btn = $('btn-voice');
    if (!recog || !btn) return;
    if (btn.classList.contains('live')) {
      try { recog.stop(); } catch {}
      return;
    }
    try {
      recog.start();
      btn.classList.add('live');
      RC.haptic(12);
    } catch {
      RC.toast('语音输入启动失败');
    }
  }

  // ---------- 绑定 ----------
  function bind() {
    const ta = $('input');
    const inner = $('composer-inner');

    ta.addEventListener('input', () => {
      autoGrow();
      updateSend();
    });
    ta.addEventListener('focus', () => { if (inner) inner.classList.add('focus'); });
    ta.addEventListener('blur', () => { if (inner) inner.classList.remove('focus'); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (S.prefs.sendOnEnter) {
          e.preventDefault();
          RC.sendMessage();
        }
      }
    });

    $('btn-send').addEventListener('click', () => {
      if (S.streaming) RC.stopStreaming();
      else RC.sendMessage();
    });

    $('btn-attach').addEventListener('click', () => {
      const tip = $('attach-tip');
      if (tip) {
        tip.textContent = RC.visionSupported()
          ? '图片需要模型支持识图；文本文件会直接读入当前对话'
          : '当前模型不支持识图，图片发送会失败；文本文件仍可导入';
      }
      RC.openSheet('sheet-attach');
    });

    // 附件按钮（v4.0 改成了 #attach-grid 动态生成，这里做兼容）
    const grid = $('attach-grid');
    if (grid) {
      // 如果网格是空的，补上三个按钮
      if (!grid.querySelector('[data-attach]')) {
        ['camera', 'photo', 'file'].forEach(kind => {
          const btn = el('button', 'attach-btn');
          btn.setAttribute('data-attach', kind);
          btn.innerHTML = RC.icon(kind === 'camera' ? 'camera' : kind === 'photo' ? 'image' : 'file-code');
          btn.appendChild(document.createTextNode(kind === 'camera' ? '相机' : kind === 'photo' ? '相册' : '文件'));
          btn.addEventListener('click', () => {
            RC.closeSheet('sheet-attach');
            if (kind === 'camera') $('file-camera').click();
            else if (kind === 'photo') $('file-image').click();
            else $('file-doc').click();
          });
          grid.appendChild(btn);
        });
      }
      // 或者旧版直接绑 id（兼容老版本）
      const attCamera = $('att-camera');
      if (attCamera) attCamera.addEventListener('click', () => { RC.closeSheet('sheet-attach'); $('file-camera').click(); });
      const attPhoto = $('att-photo');
      if (attPhoto) attPhoto.addEventListener('click', () => { RC.closeSheet('sheet-attach'); $('file-image').click(); });
      const attFile = $('att-file');
      if (attFile) attFile.addEventListener('click', () => { RC.closeSheet('sheet-attach'); $('file-doc').click(); });
    }

    $('file-image').addEventListener('change', (e) => {
      addImages(e.target.files);
      e.target.value = '';
    });
    $('file-camera').addEventListener('change', (e) => {
      addImages(e.target.files);
      e.target.value = '';
    });
    $('file-doc').addEventListener('change', (e) => {
      addDocs(e.target.files);
      e.target.value = '';
    });

    $('btn-voice').addEventListener('click', toggleVoice);
    $('btn-think').addEventListener('click', () => {
      if (!RC.reasoningSupported()) {
        RC.toast('当前模型不支持深度思考，换一个带「推理」标记的模型');
        return;
      }
      RC.renderEffortList && RC.renderEffortList();
      RC.openSheet('sheet-effort');
    });

    setupVoice();
  }

  Object.assign(RC, {
    LIMITS,
    autoGrow, fillComposer, clearComposer, updateSend,
    addImages, addDocs, renderDrafts,
    setupVoice, toggleVoice, bindComposer: bind,
  });
})(window);
