/* ============================================================
   小浣熊 v7 · 设置 / 模型 / 思考强度 / 我的
   新增：主题色选择器（7 套配色）+ 动态材质开关 + 丰富功能分组
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

  // ---------- 主题色配置 ----------
  const THEMES = [
    { id: 'aurora', name: '极光青', sw1: '#38d6d0', sw2: '#5b8cff' },
    { id: 'ocean', name: '海洋蓝', sw1: '#5b8cff', sw2: '#38d6d0' },
    { id: 'violet', name: '紫罗兰', sw1: '#a78bfa', sw2: '#f472b6' },
    { id: 'rose', name: '玫瑰粉', sw1: '#fb7185', sw2: '#fbbf24' },
    { id: 'emerald', name: '翡翠绿', sw1: '#34d399', sw2: '#38bdf8' },
    { id: 'amber', name: '琥珀黄', sw1: '#fbbf24', sw2: '#fb7185' },
    { id: 'slate', name: '板岩灰', sw1: '#94a3b8', sw2: '#38d6d0' },
  ];

  function effortName() {
    const e = EFFORTS.find((x) => x.id === S.prefs.effort);
    return e ? e.name : '关闭';
  }

  // ============================================================
  // 设置注册表（按分组组织）
  // ============================================================
  const SETTINGS = [
    // ===== 外观 =====
    {
      id: 'theme-color', group: '外观', label: '主题色', icon: 'palette', type: 'custom',
      value: () => S.prefs.accent || 'aurora',
      render: (row, it) => {
        const wrap = el('div', 'theme-swatches');
        THEMES.forEach((t) => {
          const item = el('div', 'swatch-item');
          const sw = el('div', 'swatch' + ((it.value() === t.id) ? ' on' : ''));
          sw.style.setProperty('--sw1', t.sw1);
          sw.style.setProperty('--sw2', t.sw2);
          sw.setAttribute('title', t.name);
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            S.prefs.accent = t.id;
            document.documentElement.setAttribute('data-accent', t.id);
            RC.savePrefs();
            renderSettings();
            RC.haptic(6);
            RC.toast('主题色：' + t.name);
          });
          item.appendChild(sw);
          const nm = el('span', 'theme-name', t.name);
          item.appendChild(nm);
          wrap.appendChild(item);
        });
        row.appendChild(wrap);
      },
    },
    {
      id: 'fx', group: '外观', label: '动态材质', icon: 'spark', type: 'cycle',
      value: () => (S.prefs.fx === false ? '关闭' : '开启'),
      cycle: () => {
        S.prefs.fx = !S.prefs.fx;
        document.documentElement.setAttribute('data-fx', S.prefs.fx ? 'on' : 'off');
        RC.savePrefs();
        RC.toast(S.prefs.fx ? '动态材质已开启' : '动态材质已关闭');
      },
    },
    {
      id: 'theme', group: '外观', label: '明暗主题', icon: 'palette', type: 'cycle',
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

    // ===== 对话 =====
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
    {
      id: 'system', group: '对话', label: '系统提示词', icon: 'cog', type: 'nav',
      onTap: () => RC.openSystemSheet(),
    },
    {
      id: 'prompts', group: '对话', label: '快捷指令', icon: 'star', type: 'nav',
      onTap: () => {
        RC.renderPrompts();
        RC.openSheet('sheet-prompts');
      },
    },

    // ===== 工具 =====
    {
      id: 'files', group: '工具', label: '文件管理', icon: 'folder', type: 'nav',
      onTap: () => RC.setTab('files'),
    },
    {
      id: 'device', group: '工具', label: '设备控制', icon: 'phone', type: 'nav',
      onTap: () => RC.setTab('device'),
    },
    {
      id: 'terminal', group: '工具', label: '终端', icon: 'terminal', type: 'nav',
      onTap: () => {
        RC.openSheet('sheet-terminal');
      },
    },
    {
      id: 'git', group: '工具', label: 'Git 版本控制', icon: 'git', type: 'nav',
      onTap: () => {
        RC.gitLoad && RC.gitLoad();
        RC.openSheet('sheet-git');
      },
    },
    {
      id: 'plugins', group: '工具', label: '插件中心', icon: 'puzzle', type: 'nav',
      onTap: () => {
        RC.renderPlugins && RC.renderPlugins();
        RC.openSheet('sheet-plugins');
      },
    },

    // ===== 数据 =====
    {
      id: 'export', group: '数据', label: '导出当前对话', icon: 'download', type: 'action',
      action: () => RC.exportCurrent(),
    },
    {
      id: 'storage', group: '数据', label: '清理本地数据', icon: 'trash', type: 'danger',
      value: () => RC.fmtBytes(RC.storageBytes()),
      onTap: async () => {
        const ok = await RC.confirmBox(
          '本地已用 ' + RC.fmtBytes(RC.storageBytes()) +
          '，共 ' + RC.stats().chats + ' 个对话。清理会删除所有本地对话记录。',
          { okText: '清理', danger: true }
        );
        if (!ok) return;
        RC.clearAllData();
      },
    },
    {
      id: 'backup', group: '数据', label: '云端备份', icon: 'cloud-upload', type: 'nav',
      onTap: () => RC.syncUpload(),
    },
    {
      id: 'restore', group: '数据', label: '从云端恢复', icon: 'cloud-download', type: 'nav',
      onTap: () => RC.syncDownload(),
    },

    // ===== 连接 =====
    {
      id: 'conn', group: '连接', label: '连接诊断', icon: 'wifi', type: 'nav',
      onTap: async () => {
        RC.openSheet('sheet-diag');
        RC.testConn();
      },
    },
    {
      id: 'channel', group: '连接', label: '网络通道', icon: 'network', type: 'nav',
      onTap: () => RC.useProxy(),
    },
    {
      id: 'checkin', group: '积分', label: '每日签到', icon: 'gift', type: 'action',
      action: async () => {
        try {
          const d = await RC.checkin();
          RC.toast((d && d.message) || (d && d.ok ? '已领取' : '领取失败'));
        } catch (e) {
          RC.toast(e.message || '领取失败');
        }
        RC.refreshMe();
      },
    },
    {
      id: 'onboarding', group: '积分', label: '新手奖励', icon: 'star', type: 'action',
      action: async () => {
        try {
          const d = await RC.onboarding();
          RC.toast((d && d.message) || (d && d.ok ? '已领取' : '领取失败'));
        } catch (e) {
          RC.toast(e.message || '领取失败');
        }
        RC.refreshMe();
      },
    },

    // ===== 关于 =====
    {
      id: 'about', group: '关于', label: '版本信息', icon: 'info', type: 'text',
      value: () => 'v' + RC.version,
    },
    {
      id: 'reset', group: '关于', label: '恢复默认设置', icon: 'refresh', type: 'danger',
      onTap: async () => {
        const ok = await RC.confirmBox('恢复默认设置？对话记录不会被删除。', { okText: '恢复' });
        if (!ok) return;
        S.prefs = Object.assign({}, RC.DEFAULTS, { nation: S.prefs.nation, model: S.prefs.model });
        RC.savePrefs();
        RC.applyTheme();
        RC.applyFontScale();
        document.documentElement.setAttribute('data-accent', S.prefs.accent || 'aurora');
        document.documentElement.setAttribute('data-fx', S.prefs.fx !== false ? 'on' : 'off');
        renderSettings();
        RC.updateSend();
        RC.renderMe();
        RC.toast('已恢复默认');
      },
    },
    {
      id: 'privacy', group: '关于', label: '隐私政策', icon: 'shield', type: 'link', href: 'https://example.com/privacy', target: '_blank',
    },
    {
      id: 'terms', group: '关于', label: '服务条款', icon: 'file-text', type: 'link', href: 'https://example.com/terms', target: '_blank',
    },
    {
      id: 'github', group: '关于', label: 'GitHub 仓库', icon: 'github', type: 'link', href: 'https://github.com/giangnam728828-rgb/raccoon-mobile', target: '_blank',
    },
  ];

  function renderSettings() {
    const box = $('settings-body');
    if (!box) return;
    box.innerHTML = '';

    const groups = {};
    SETTINGS.forEach((it) => {
      groups[it.group] = groups[it.group] || [];
      groups[it.group].push(it);
    });

    Object.keys(groups).forEach((g) => {
      // 分组容器
      const groupEl = el('div', 'settings-group-v8');
      
      // 分组标题
      const title = el('div', 'settings-group-title-v8', g);
      groupEl.appendChild(title);

      groups[g].forEach((it) => {
        const row = el('button', 'setting-row-modern');
        row.type = 'button';
        
        // 左侧图标和标签
        const labelWrap = el('div', 'setting-label-modern');
        const iconEl = icon(it.icon);
        iconEl.setAttribute('class', 'setting-icon-modern');
        labelWrap.appendChild(iconEl);
        const lbl = el('span', '', it.label);
        lbl.style.fontWeight = '600';
        labelWrap.appendChild(lbl);
        row.appendChild(labelWrap);

        if (it.type === 'custom') {
          // 自定义渲染（如主题色选择器）
          row.style.cssText = 'flex-direction:column;align-items:stretch;padding:var(--s-3);margin:0';
          const customRow = el('div', 'setting-row-modern');
          const cw = el('div', 'setting-label-modern');
          const ci = icon(it.icon);
          ci.setAttribute('class', 'setting-icon-modern');
          cw.appendChild(ci);
          const cl = el('span', '', it.label);
          cl.style.fontWeight = '600';
          cw.appendChild(cl);
          customRow.appendChild(cw);
          
          const wrap = el('div', 'theme-swatches-v8');
          THEMES.forEach((t) => {
            const item = el('div', 'swatch-item-v8');
            const sw = el('div', 'swatch-v8' + ((it.value() === t.id) ? ' on' : ''));
            sw.style.setProperty('--sw1', t.sw1);
            sw.style.setProperty('--sw2', t.sw2);
            sw.setAttribute('title', t.name);
            sw.addEventListener('click', (e) => {
              e.stopPropagation();
              S.prefs.accent = t.id;
              document.documentElement.setAttribute('data-accent', t.id);
              RC.savePrefs();
              renderSettings();
              RC.haptic(6);
              RC.toast('主题色：' + t.name);
            });
            item.appendChild(sw);
            const nm = el('span', 'theme-name-v8', t.name);
            item.appendChild(nm);
            wrap.appendChild(item);
          });
          customRow.appendChild(wrap);
          groupEl.appendChild(customRow);
          return;
        } else if (it.type === 'switch') {
          const sw = el('label', 'toggle-modern');
          const chk = el('input', '');
          chk.type = 'checkbox';
          chk.checked = it.value();
          const slider = el('span', 'toggle-slider-modern');
          sw.appendChild(chk);
          sw.appendChild(slider);
          chk.addEventListener('change', () => {
            it.toggle(chk.checked);
            RC.haptic(6);
          });
          row.appendChild(sw);
        } else if (it.type === 'nav' || it.type === 'action' || it.type === 'danger') {
          row.addEventListener('click', () => {
            if (it.action) {
              it.action();
              renderMe();
            } else if (it.onTap) {
              it.onTap();
            }
          });
          row.classList.add('cycle');
          const val = el('span', 'setting-value-modern', it.value ? it.value() : '');
          row.appendChild(val);
          const arrow = icon('chevron-right');
          arrow.style.width = '16px';
          arrow.style.height = '16px';
          arrow.style.color = 'var(--text-muted)';
          row.appendChild(arrow);
        } else if (it.type === 'link') {
          row.addEventListener('click', () => {
            window.open(it.href, it.target || '_blank');
          });
          row.classList.add('cycle');
          const arrow = icon('external-link');
          arrow.style.width = '16px';
          arrow.style.height = '16px';
          arrow.style.color = 'var(--text-muted)';
          row.appendChild(arrow);
        } else {
          row.appendChild(el('span', 'setting-value-modern', it.value()));
          row.classList.add('cycle');
          row.addEventListener('click', () => {
            if (it.cycle) {
              it.cycle();
              renderSettings();
            }
          });
        }
        groupEl.appendChild(row);
      });
      box.appendChild(groupEl);
    });
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
    if (!btn && !effEl) return;
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
    open('row-files', () => RC.setTab('files'));
    open('row-device', () => RC.setTab('device'));
    open('row-terminal', () => {
      RC.openSheet('sheet-terminal');
    });
    open('row-git', () => {
      RC.gitLoad && RC.gitLoad();
      RC.openSheet('sheet-git');
    });
    open('row-plugins', () => {
      RC.renderPlugins && RC.renderPlugins();
      RC.openSheet('sheet-plugins');
    });
    open('row-about', () => {
      RC.toast('小浣熊 · v' + RC.version);
    });
    open('row-logout', async () => {
      const ok = await RC.confirmBox('退出登录？本地对话记录会保留。', {
        okText: '退出', danger: true,
      });
      if (ok) RC.logout(false);
    });
  }

  Object.assign(RC, {
    EFFORTS, SETTINGS, THEMES,
    effortName, renderSettings, renderModelList, renderEffortList,
    paintModelBar, paintTitle, renderMe, bindMe, shortName, modelGroup,
  });
})(window);
