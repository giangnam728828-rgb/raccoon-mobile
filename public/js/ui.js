/* ============================================================
   小浣熊 v4.0 · 壳：视图切换 / 标签页 / 主题 / 弹层装配
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, $$ } = RC;

  // ---------- 视图 ----------
  function showView(name) {
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === name));
  }

  // ---------- 标签页 ----------
  const PANES = { chat: 'pane-chat', history: 'pane-history', me: 'pane-me' };

  function setTab(name, opts) {
    if (!PANES[name]) return;
    const silent = opts && opts.silent;
    S.tab = name;
    Object.keys(PANES).forEach((k) => {
      const p = $(PANES[k]);
      if (p) p.classList.toggle('on', k === name);
    });
    $$('.tab').forEach((t) => {
      const on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    if (name === 'history') RC.renderHistory && RC.renderHistory();
    if (name === 'me') RC.renderMe && RC.renderMe();
    if (name === 'chat') {
      RC.scrollBottom && RC.scrollBottom(true);
      S.unread = 0;
      RC.updateJump && RC.updateJump();
    }
    if (!silent) RC.haptic && RC.haptic(6);
  }

  // ---------- 主题 ----------
  const THEME_NAMES = { auto: '跟随系统', light: '浅色', dark: '深色' };
  const darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function effectiveTheme() {
    const t = S.prefs.theme;
    if (t === 'dark') return 'dark';
    if (t === 'light') return 'light';
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }

  function applyTheme() {
    const t = effectiveTheme();
    document.documentElement.setAttribute('data-theme', t);
    const meta = $('theme-color');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#171315' : '#faf1ee');
    const metaCS = document.querySelector('meta[name="color-scheme"]');
    if (metaCS) metaCS.setAttribute('content', t === 'dark' ? 'dark' : 'light');
  }

  function setTheme(mode) {
    S.prefs.theme = mode;
    RC.savePrefs();
    applyTheme();
    RC.renderMe && RC.renderMe();
    RC.renderSettings && RC.renderSettings();
  }

  if (darkQuery) {
    const onScheme = () => {
      if (S.prefs.theme === 'auto') applyTheme();
    };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onScheme);
    else if (darkQuery.addListener) darkQuery.addListener(onScheme);
  }

  // ---------- 字号 ----------
  const FONT_STEPS = [
    { v: 1, name: '标准', px: 16 },
    { v: 1.08, name: '偏大', px: 17.5 },
    { v: 1.18, name: '最大', px: 19 },
  ];

  function fontStepName() {
    const f = FONT_STEPS.find((x) => Math.abs(x.v - S.prefs.fontScale) < 0.01);
    return f ? f.name : '标准';
  }

  function applyFontScale() {
    const f = FONT_STEPS.find((x) => Math.abs(x.v - S.prefs.fontScale) < 0.01) || FONT_STEPS[0];
    document.documentElement.style.setProperty('--reading', f.px + 'px');
    document.documentElement.style.setProperty('--reading-lh', f.v >= 1.18 ? '1.78' : '1.72');
  }

  function cycleFontScale() {
    const i = FONT_STEPS.findIndex((x) => Math.abs(x.v - S.prefs.fontScale) < 0.01);
    const next = FONT_STEPS[(i + 1) % FONT_STEPS.length];
    S.prefs.fontScale = next.v;
    RC.savePrefs();
    applyFontScale();
    RC.renderMe && RC.renderMe();
    RC.toast('字号：' + next.name);
  }

  // ---------- 弹层装配 ----------
  function bindOnce(el, key) {
    if (!el) return false;
    if (el.dataset[`bound${key}`]) return false;
    el.dataset[`bound${key}`] = '1';
    return true;
  }

  function bindSheets() {
    // 点遮罩关闭 - Sheet
    $$('.sheet-scrim').forEach((scrim) => {
      if (!bindOnce(scrim, 'scrim')) return;
      scrim.addEventListener('click', () => {
        const sheet = scrim.parentElement;
        if (sheet && sheet.id) RC.closeSheet(sheet.id);
      });
    });

    // 点遮罩关闭 - Confirm Dialog
    $$('.confirm-backdrop').forEach((backdrop) => {
      if (!bindOnce(backdrop, 'cfbackdrop')) return;
      backdrop.addEventListener('click', () => RC.settleConfirm(false));
    });

    // 关闭按钮
    $$('[data-close]').forEach((btn) => {
      if (btn.classList.contains('sheet-scrim') || btn.classList.contains('confirm-backdrop')) return;
      if (!bindOnce(btn, 'close')) return;
      btn.addEventListener('click', () => {
        const sheet = btn.closest('.sheet');
        if (sheet && sheet.id) RC.closeSheet(sheet.id);
      });
    });

    // 确认框按钮
    const ok = $('confirm-ok');
    if (ok && bindOnce(ok, 'ok')) {
      ok.addEventListener('click', () => RC.settleConfirm(true));
    }
    const cancel = $('confirm-cancel');
    if (cancel && bindOnce(cancel, 'cancel')) {
      cancel.addEventListener('click', () => RC.settleConfirm(false));
    }
  }

  // ---------- 通用操作表 ----------
  function openActions(items) {
    const list = $('action-list');
    if (!list) return;
    list.innerHTML = '';
    items.forEach((it) => {
      const b = RC.el('button', it.danger ? 'danger' : '');
      b.type = 'button';
      if (it.icon) b.appendChild(RC.icon(it.icon));
      b.appendChild(document.createTextNode(it.label));
      b.addEventListener('click', () => {
        RC.closeSheet('sheet-actions');
        setTimeout(() => it.onSelect && it.onSelect(), 60);
      });
      list.appendChild(b);
    });
    RC.openSheet('sheet-actions');
  }

  // ---------- 顶栏滚动阴影 ----------
  function bindScrollShade() {
    const thread = $('thread');
    const bar = $('chat-appbar');
    if (!thread || !bar) return;
    thread.addEventListener('scroll', () => {
      bar.classList.toggle('scrolled', thread.scrollTop > 2);
    }, { passive: true });
  }

  // ---------- 返回键 ----------
  function onBack() {
    if (RC.closeTopSheet()) return true;
    if (S.tab !== 'chat') {
      setTab('chat');
      return true;
    }
    return false;
  }

  Object.assign(RC, {
    showView, setTab,
    THEME_NAMES, FONT_STEPS,
    effectiveTheme, applyTheme, setTheme,
    fontStepName, applyFontScale, cycleFontScale,
    bindSheets, openActions, bindScrollShade, onBack,
  });
})(window);