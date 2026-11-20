/* ============================================================
   小浣熊 v4.0 · 设置 / 模型 / 思考强度 / 我的
   设置用「注册表」组织：新增一项只需往 SETTINGS 里加一条
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, el, icon } = RC;

  // ---------- 思考强度 ----------
  const EFFORTS = [
    { id: 'off', name: '关闭', desc: '不展示思考过程，响应最快' },
    { id: 'minimal', name: '极简', desc: '几乎不推理，适合随手聊' },
    { id: 'low', name: '轻量', desc: '简单问题的快速推理' },
    { id: 'medium', name: '标准', desc: '速度与质量的平衡点' },
    { id: 'high', name: '深入', desc: '多步推理，适合分析题' },
    { id: 'xhigh', name: '更深', desc: '复杂问题，耗时更长' },
    { id: 'max', name: '最强', desc: '最完整的推理，最慢' },
  ];

  function effortName() {
    const e = EFFORTS.find((x) => x.id === S.prefs.effort);
    return e ? e.name : '关闭';
  }

  // ============================================================
  // 设置注册表
  // 每项：{ id, group, label, icon, type, value(), render?(), onTap?() }
  // type: 'nav' | 'switch' | 'text' | 'cycle'
  // ============================================================
  const SETTINGS = [
    {
      id: 'theme', group: '外观', label: '主题', icon: 'palette', type: 'cycle',
      value: () => RC.THEME_NAMES[S.prefs.theme] || '跟随系统',
      cycle: () => {
        const order = ['auto', 'light', 'dark'];
        const i = order.indexOf(S.prefs.theme);
        RC.setTheme(order[(i + 1) % order.length]);
        RC.toast('主题：' + RC.THEME_NAMES[S.prefs.theme]);
      },
    },
    {
      id: 'font', group: '外观', label: '正文字号', icon: 'type', type: 'cycle',
      value: () => RC.fontStepName(),
      cycle: () => RC.cycleFontScale(),
    },
    {
      id: 'thought', group: '对话', label: '自动展开思考', icon: 'spark', type: 'switch',
      value: () => !!S.prefs.showThought,
      toggle: (v) => {
        S.prefs.showThought = v;
        RC.savePrefs();
      },
    },
    {
      id: 'enter', group: '对话', label: '回车键发送', icon: 'send', type: 'switch',
      desc: '关闭后回车换行，用按钮发送',
      value: () => !!S.prefs.sendOnEnter,
      toggle: (v) => {
        S.prefs.sendOnEnter = v;
        RC.savePrefs();
      },
    },
    {
      id: 'haptic', group: '对话', label: '触感反馈', icon: 'bolt', type: 'switch',
      value: () => !!S.prefs.haptic,
      toggle: (v) => {
        S.prefs.haptic = v;
        RC.savePrefs();
      },
    },
  ];

  function renderSettings() {
    const box = $('settings-body');
    if (!box) return;
    box.innerHTML = '';

    const groups = [];
    SETTINGS.forEach((it) => {
      if (groups.indexOf(it.group) < 0) groups.push(it.group);
    });

    groups.forEach((g) => {
      const label = el('div', 'group-label');
      label.textContent = g;
      box.appendChild(label);

      SETTINGS.filter((x) => x.group === g).forEach((it) => {
        const row = el('button', 'setting-row');
        row.type = 'button';
        row.appendChild(icon(it.icon));
        row.appendChild(el('span', 'lbl', it.label));

        if (it.type === 'switch') {
          const sw = el('button', 'switch');
          sw.type = 'button';
          sw.setAttribute('role', 'switch');
          sw.setAttribute('aria-checked', it.value() ? 'true' : 'false');
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            it.toggle(!it.value());
            sw.setAttribute('aria-checked', it.value() ? 'true' : 'false');
            RC.haptic(6);
          });
          row.appendChild(sw);
        } else {
          row.appendChild(el('span', 'val', it.value()));
          row.appendChild(icon('chevron-right', 'sm chevron'));
          row.classList.add('cycle');
          row.addEventListener('click', () => {
            if (it.cycle) {
              it.cycle();
              renderSettings();
            }
          });
        }
        box.appendChild(row);
      });
    });

    // 关于
    const about = el('div', 'group-label');
    about.textContent = '关于';
    box.appendChild(about);

    const ver = el('div', 'setting-row');
    ver.appendChild(icon('info'));
    ver.appendChild(el('span', 'lbl', '版本'));
    ver.appendChild(el('span', 'val mono', RC.version));
    box.appendChild(ver);

    const reset = el('button', 'setting-row');
    reset.type = 'button';
    reset.appendChild(icon('refresh'));
    reset.appendChild(el('span', 'lbl', '恢复默认设置'));
    reset.addEventListener('click', async () => {
      const ok = await RC.confirmBox('恢复默认设置？对话记录不会被删除。', { okText: '恢复' });
      if (!ok) return;
      S.prefs = Object.assign({}, RC.DEFAULTS, { nation: S.prefs.nation, model: S.prefs.model });
      RC.savePrefs();
      RC.applyTheme();
      RC.applyFontScale();
      renderSettings();
      RC.updateSend();
      RC.renderMe();
      RC.toast('已恢复默认');
    });
    box.appendChild(reset);
  }

  // ---------- 模型列表 ----------
  function modelGroup(m) {
    if (m.supportsImages && m.supportsReasoning) return '识图 + 推理';
    if (m.supportsImages) return '支持识图';
    if (m.supportsReasoning) return '支持推理';
    return '通用对话';
  }

  function renderModelList() {
    const box = $('model-list');
    if (!box) return;
    box.innerHTML = '';

    if (!S.models.length) {
      box.appendChild(el('p', 'sheet-tip', '暂无可用模型，请检查网络后重试。'));
      return;
    }

    const order = ['识图 + 推理', '支持识图', '支持推理', '通用对话'];
    const groups = new Map();
    S.models.forEach((m) => {
      const g = modelGroup(m);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    });

    Array.from(groups.keys())
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .forEach((g) => {
        const label = el('div', 'model-group-label');
        label.textContent = g;
        box.appendChild(label);

        groups.get(g).forEach((m) => {
          const row = el('div', 'model-option' + (m.id === S.prefs.model ? ' on' : ''));
          row.setAttribute('role', 'button');
          row.tabIndex = 0;

          const iconEl = el('span', 'icon');
          iconEl.appendChild(icon('spark'));
          row.appendChild(iconEl);

          const info = el('div', 'info');
          const name = el('div', 'name');
          name.textContent = m.name;
          if (m.supportsReasoning) name.appendChild(icon('bolt'));
          info.appendChild(name);

          const tags = el('div', 'tags');
          if (m.contextLength) {
            tags.appendChild(el('span', 'tag', RC.fmtContext(m.contextLength) + ' 上下文'));
          }
          if (m.supportsImages) tags.appendChild(el('span', 'tag', '识图'));
          if (m.supportsReasoning) tags.appendChild(el('span', 'tag', '推理'));
          if (!tags.childNodes.length) tags.appendChild(el('span', 'tag', '对话'));
          info.appendChild(tags);
          row.appendChild(info);

          if (m.id === S.prefs.model) {
            const c = el('span', 'check');
            c.appendChild(icon('check'));
            row.appendChild(c);
          }

          const pick = () => {
            S.prefs.model = m.id;
            RC.savePrefs();
            RC.paintModelBar();
            renderModelList();
            RC.closeSheet('sheet-model');
            RC.haptic(6);
            RC.updateSend();
            RC.renderMe();
          };
          row.addEventListener('click', pick);
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pick();
            }
          });
          box.appendChild(row);
        });
      });
  }

  // ---------- 思考强度列表 ----------
  function renderEffortList() {
    const box = $('effort-list');
    if (!box) return;
    box.innerHTML = '';

    if (!RC.reasoningSupported()) {
      box.appendChild(el('p', 'sheet-tip',
        '当前模型不提供推理强度设置。换一个带「推理」标记的模型即可开启深度思考。'));
      return;
    }

    const note = el('p', 'effort-note', '推理越深，回答越周全，但等待也更久。');
    box.appendChild(note);

    EFFORTS.forEach((e) => {
      const row = el('div', 'effort-option' + (e.id === S.prefs.effort ? ' on' : ''));
      row.setAttribute('role', 'button');
      row.tabIndex = 0;

      const info = el('div', 'info');
      const name = el('div', 'name');
      name.textContent = e.name;
      info.appendChild(name);
      info.appendChild(el('div', 'desc', e.desc));
      row.appendChild(info);

      if (e.id === S.prefs.effort) {
        const c = el('span', 'check');
        c.appendChild(icon('check'));
        row.appendChild(c);
      }

      const pick = () => {
        S.prefs.effort = e.id;
        RC.savePrefs();
        RC.paintModelBar();
        renderEffortList();
        RC.closeSheet('sheet-effort');
        RC.haptic(6);
        RC.updateSend();
        RC.renderMe();
      };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          pick();
        }
      });
      box.appendChild(row);
    });
  }

  // ---------- 顶栏标题 ----------
  function paintTitle() {
    const el = document.getElementById('chat-title');
    if (!el) return;
    const cur = RC.currentChat();
    const title = (cur && cur.title) || '新对话';
    el.textContent = title;
    el.title = title;
  }

  // ---------- 顶栏模型/思考 ----------
  function paintModelBar() {
    const m = RC.currentModel();
    const nameEl = $('model-name');
    if (nameEl) {
      nameEl.textContent = m ? shortName(m.name) : (S.models.length ? '选择模型' : '默认模型');
    }
    const effEl = $('effort-name');
    const btn = $('btn-effort');
    if (effEl) {
      if (!RC.reasoningSupported()) {
        effEl.textContent = '不支持推理';
        if (btn) { btn.classList.remove('on'); btn.disabled = true; }
      } else {
        btn && (btn.disabled = false);
        if (S.prefs.effort === 'off') {
          effEl.textContent = '思考关';
          if (btn) btn.classList.remove('on');
        } else {
          effEl.textContent = effortName();
          if (btn) btn.classList.add('on');
        }
      }
    }
    RC.updateSend();
    paintTitle();
  }

  function shortName(n) {
    const s = String(n || '').trim();
    return s.length > 16 ? s.slice(0, 16) + '…' : s || '默认';
  }

  // ---------- 我的 ----------
  function renderMe() {
    const set = (id, v) => {
      const e = $(id);
      if (e) e.textContent = v;
    };
    const st = RC.stats();

    set('me-name', S.name || '小浣熊');
    set('me-phone', S.phone || '—');
    set('st-points', String(S.points == null ? '—' : S.points));
    set('st-chats', String(st.chats));
    set('st-msgs', String(st.messages));

    set('set-model', shortName(RC.currentModel() ? RC.currentModel().name : '—'));
    set('set-effort', RC.reasoningSupported() ? effortName() : '不支持');
    set('set-system', S.system ? (S.system.length > 12 ? S.system.slice(0, 12) + '…' : S.system) : '未设置');
    set('set-prompts', (RC.allPrompts().length) + ' 条');
    set('set-theme', RC.THEME_NAMES[S.prefs.theme] || '跟随系统');
    set('set-fontsize', RC.fontStepName());
    set('set-storage', RC.fmtBytes(RC.storageBytes()));
    set('set-backup', RC.isDirect() ? '需代理' : '可用');
    set('set-channel', RC.channelLabel());
    set('set-version', 'v' + RC.version);

    const dot = $('status-dot');
    if (dot) dot.classList.toggle('connected', !!S.loggedIn);

    const chip = $('points');
    if (chip) chip.textContent = String(S.points == null ? '—' : S.points);
  }

  // ---------- 绑定「我的」 ----------
  function bindMe() {
    const open = (id, fn) => {
      const e = $(id);
      if (e) e.addEventListener('click', fn);
    };

    open('btn-settings', () => {
      renderSettings();
      RC.openSheet('sheet-settings');
    });
    open('row-theme', () => {
      const order = ['auto', 'light', 'dark'];
      const i = order.indexOf(S.prefs.theme);
      RC.setTheme(order[(i + 1) % order.length]);
      RC.toast('主题：' + RC.THEME_NAMES[S.prefs.theme]);
      renderMe();
    });
    open('row-fontsize', () => RC.cycleFontScale());
    open('row-model', () => {
      RC.renderModelList();
      RC.openSheet('sheet-model');
    });
    open('row-effort', () => {
      if (!RC.reasoningSupported()) {
        RC.toast('当前模型不支持深度思考');
        return;
      }
      RC.renderEffortList();
      RC.openSheet('sheet-effort');
    });
    open('row-system', () => {
      RC.openSystemSheet();
    });
    open('row-prompts', () => {
      RC.renderPrompts();
      RC.openSheet('sheet-prompts');
    });
    open('row-export', () => {
      RC.exportCurrent();
    });
    open('row-storage', async () => {
      const ok = await RC.confirmBox(
        '本地已用 ' + RC.fmtBytes(RC.storageBytes()) +
        '，共 ' + RC.stats().chats + ' 个对话。清理会删除所有本地对话记录。',
        { okText: '清理', danger: true }
      );
      if (!ok) return;
      RC.clearAllData();
    });
    open('row-conn', async () => {
      RC.openSheet('sheet-diag');
      RC.testConn();
    });
    open('row-channel', () => RC.useProxy());
    open('row-checkin', async () => {
      try {
        const d = await RC.checkin();
        RC.toast((d && d.message) || (d && d.ok ? '已领取' : '领取失败'));
      } catch (e) {
        RC.toast(e.message || '领取失败');
      }
      RC.refreshMe();
    });
    open('row-onboarding', async () => {
      try {
        const d = await RC.onboarding();
        RC.toast((d && d.message) || (d && d.ok ? '已领取' : '领取失败'));
      } catch (e) {
        RC.toast(e.message || '领取失败');
      }
      RC.refreshMe();
    });
    open('row-backup', () => RC.syncUpload());
    open('row-restore', () => RC.syncDownload());
    open('row-files', () => {
      RC.fmInit && RC.fmInit();
      RC.openSheet('sheet-files');
    });
    open('row-terminal', () => {
      RC.openSheet('sheet-terminal');
    });
    open('row-git', () => {
      RC.gitLoad && RC.gitLoad();
      RC.openSheet('sheet-git');
    });
    open('row-about', () => {
      RC.toast('小浣熊移动端 v' + RC.version);
    });
    open('row-privacy', () => {
      global.open('https://example.com/privacy', '_blank');
    });
    open('row-terms', () => {
      global.open('https://example.com/terms', '_blank');
    });
    open('row-github', () => {
      global.open('https://github.com/giangnam728828-rgb/raccoon-mobile', '_blank');
    });
    open('row-logout', async () => {
      const ok = await RC.confirmBox('退出登录？本地对话记录会保留。', {
        okText: '退出', danger: true,
      });
      if (ok) RC.logout(false);
    });
  }

  Object.assign(RC, {
    EFFORTS, SETTINGS,
    effortName, renderSettings, renderModelList, renderEffortList,
    paintModelBar, paintTitle, renderMe, bindMe, shortName, modelGroup,
  });
})(window);