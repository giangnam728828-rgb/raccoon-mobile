/* ============================================================
   核心：命名空间 / DOM / 格式化 / Toast / 弹层
   ============================================================ */
(function (global) {
  'use strict';

  const RC = (global.RC = global.RC || {});
  RC.version = '3.0.0';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  function raf(fn) {
    let queued = false;
    return function (...args) {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn.apply(this, args);
      });
    };
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ---------- 格式化 ----------
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const hm = p(d.getHours()) + ':' + p(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    if (d.getFullYear() === now.getFullYear()) return d.getMonth() + 1 + '月' + d.getDate() + '日';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1048576).toFixed(1) + ' MB';
  }

  function fmtContext(n) {
    const v = Number(n) || 0;
    if (!v) return '';
    if (v >= 1000000) return (Math.round(v / 100000) / 10) + 'M';
    if (v >= 1000) return Math.round(v / 1000) + 'K';
    return String(v);
  }

  // ---------- 触感 ----------
  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch {}
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(text, ms) {
    const t = $('toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), ms || 2200);
  }

  // ---------- 弹层 ----------
  const sheetStack = [];

  function openSheet(id) {
    const s = $(id);
    if (!s) return;
    s.classList.remove('hidden');
    if (sheetStack.indexOf(id) < 0) sheetStack.push(id);
    // 弹层里第一个可聚焦元素
    const focusable = s.querySelector('input, textarea, button');
    if (focusable && s.querySelector('input, textarea')) {
      setTimeout(() => {
        try { focusable.focus({ preventScroll: true }); } catch {}
      }, 240);
    }
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
    if (!id) return false;
    closeSheet(id);
    return true;
  }

  function closeAllSheets() {
    while (sheetStack.length) closeSheet(sheetStack[sheetStack.length - 1]);
  }

  // 确认对话框（Promise）
  let confirmResolve = null;
  function confirmBox(text, opts) {
    const o = opts || {};
    const box = $('sheet-confirm');
    if (!box) return Promise.resolve(false);
    $('confirm-text').textContent = text;
    const ok = $('confirm-ok');
    ok.textContent = o.okText || '确定';
    ok.className = 'btn btn-block ' + (o.danger ? 'btn-rose' : 'btn-primary');
    $('confirm-cancel').textContent = o.cancelText || '取消';
    openSheet('sheet-confirm');
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  function settleConfirm(v) {
    closeSheet('sheet-confirm');
    const r = confirmResolve;
    confirmResolve = null;
    if (r) r(v);
  }

  // ---------- 剪切板 ----------
  function copyText(text, tip) {
    const s = String(text == null ? '' : text);
    if (!s) return;
    const done = () => toast(tip || '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done).catch(() => legacyCopy(s, done));
    } else {
      legacyCopy(s, done);
    }
  }

  function legacyCopy(s, done) {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
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

  // ---------- 分享 ----------
  async function share(payload) {
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    // 回退：复制文本
    if (payload.text) {
      copyText(payload.text, '已复制，可粘贴分享');
      return true;
    }
    return false;
  }

  // ---------- 其它 ----------
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  Object.assign(RC, {
    $, $$, el, icon, esc, clamp, raf, debounce, sleep, uid,
    fmtTime, fmtBytes, fmtContext, haptic,
    toast, openSheet, closeSheet, closeTopSheet, closeAllSheets,
    confirmBox, settleConfirm,
    copyText, share,
  });
})(window);
