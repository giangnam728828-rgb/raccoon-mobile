// ============================================================
// 工具模块：设备操作 / 插件 / 外部链接
// ============================================================
(function (global) {
  const RC = global.RC || {};
  const $ = (id) => document.getElementById(id);

  const showToast = (text) => {
    if (RC.toast) RC.toast(text);
    else console.log('[toast]', text);
  };
  const openSheet = (id) => {
    if (RC.openSheet) RC.openSheet(id);
  };

  // ---------- 设备操作 ----------
  let deviceEnabled = false;
  let accessibilityServiceAvailable = false;

  function checkDeviceSupport() {
    // 无障碍能力依赖原生插件；没有插件时明确显示未就绪，不静默失败
    const nat = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RaccoonDevice;
    accessibilityServiceAvailable = !!nat;
    deviceEnabled = !!nat;
    updateDeviceStatus();
    return !!nat;
  }

  function updateDeviceStatus() {
    const dot = $('dev-status')?.querySelector('.dev-dot');
    const text = $('dev-status-text');
    if (!dot || !text) return;
    if (accessibilityServiceAvailable) {
      dot.classList.add('on');
      text.textContent = '无障碍服务待开启，点下方按钮授权';
    } else {
      dot.classList.remove('on');
      text.textContent = '当前构建未包含设备操作插件';
    }
  }

  async function dumpScreen() {
    if (!accessibilityServiceAvailable) {
      showToast('当前构建没有设备操作插件');
      return null;
    }
    try {
      const d = await window.Capacitor.Plugins.RaccoonDevice.dump();
      const out = $('dev-output');
      if (out) {
        out.textContent = d && d.ok ? JSON.stringify(d.nodes || [], null, 2) : (d && d.message) || '读取失败';
      }
      if (d && d.ok) showToast('屏幕节点已读取');
      else showToast((d && d.message) || '读取失败');
      return d;
    } catch (err) {
      console.error(err);
      showToast('读取失败：' + (err && err.message));
      return null;
    }
  }

  async function tapByText(text) {
    if (!accessibilityServiceAvailable) {
      showToast('当前构建没有设备操作插件');
      return;
    }
    try {
      const d = await window.Capacitor.Plugins.RaccoonDevice.tapByText({ text });
      showToast(d && d.ok ? `已点击：“${d.hit || text}”` : (d && d.message) || '未找到');
    } catch (err) {
      console.error(err);
      showToast('点击失败：' + (err && err.message));
    }
  }

  async function tapByXY(x, y) {
    if (!accessibilityServiceAvailable) {
      showToast('当前构建没有设备操作插件');
      return;
    }
    try {
      const d = await window.Capacitor.Plugins.RaccoonDevice.tap({ x, y });
      showToast(d && d.ok ? `已点击坐标 (${x}, ${y})` : '点击失败');
    } catch (err) {
      console.error(err);
      showToast('点击失败：' + (err && err.message));
    }
  }

  async function globalAction(action) {
    if (!accessibilityServiceAvailable) {
      showToast('当前构建没有设备操作插件');
      return;
    }
    try {
      await window.Capacitor.Plugins.RaccoonDevice.global({ action });
      showToast('已发送全局按键');
    } catch (err) {
      console.error(err);
      showToast('操作失败：' + (err && err.message));
    }
  }

  /** 打开系统无障碍设置页（插件存在时才有用） */
  async function openA11ySettings() {
    if (!accessibilityServiceAvailable) {
      showToast('当前构建没有设备操作插件');
      return;
    }
    try {
      await window.Capacitor.Plugins.RaccoonDevice.openSettings();
    } catch (err) {
      console.error(err);
      showToast('打开设置失败');
    }
  }

  // ---------- 插件管理 ----------
  const PLUGINS = [
    { id: 'file-manager', name: '文件管理', desc: '访问本地文件系统', default: true },
    { id: 'terminal', name: '终端', desc: '运行命令与构建', default: true },
    { id: 'git', name: 'Git', desc: '版本控制', default: true },
    { id: 'device', name: '设备操作', desc: '读屏、点击、手势', default: true },
    { id: 'editor', name: '代码编辑器', desc: '在线编辑与运行', default: true },
  ];

  function loadPluginPrefs() {
    const raw = localStorage.getItem('raccoon-plugins');
    if (raw) return JSON.parse(raw);
    const prefs = {};
    PLUGINS.forEach(p => { prefs[p.id] = p.default; });
    savePluginPrefs(prefs);
    return prefs;
  }

  function savePluginPrefs(prefs) {
    localStorage.setItem('raccoon-plugins', JSON.stringify(prefs));
  }

  function renderPlugins() {
    const prefs = loadPluginPrefs();
    const list = $('plugin-list');
    if (!list) return;
    list.innerHTML = '';
    PLUGINS.forEach(p => {
      const row = document.createElement('div');
      row.className = 'setting-row';
      const enabled = !!prefs[p.id];
      row.innerHTML = `
        <div>
          <div class="lbl">${p.name}</div>
          <div class="hint">${p.desc}</div>
        </div>
        <input type="checkbox" class="switch" data-plugin="${p.id}" ${enabled ? 'checked' : ''}>
      `;
      list.appendChild(row);
    });
    // Bind switches
    list.querySelectorAll('.switch').forEach(chk => {
      chk.addEventListener('change', () => {
        const prefs = loadPluginPrefs();
        prefs[chk.dataset.plugin] = chk.checked;
        savePluginPrefs(prefs);
        showToast(`${chk.closest('.setting-row').querySelector('.lbl').textContent} ${chk.checked ? '已启用' : '已禁用'}`);
      });
    });
  }

  // ---------- 外部链接 ----------
  async function openExternal(url) {
    try {
      if (window.Capacitor && window.Capacitor.Plugins?.Browser) {
        await window.Capacitor.Plugins.Browser.open({ url });
        return;
      }
      // Fallback: system open or new tab
      if (window.open) {
        const w = window.open(url, '_system');
        if (!w) window.location.href = url;
      } else {
        location.href = url;
      }
    } catch (err) {
      console.error(err);
      window.open(url, '_blank');
    }
  }

  // ---------- UI 绑定 ----------
  function bindDeviceSheet() {
    const btnDump = $('dev-dump');
    const btnCopy = $('dev-copy-dump');
    const btnTapText = $('dev-tap-text');
    const inputText = $('dev-text');
    const btnTapXY = $('dev-tap-xy');
    const inputXY = $('dev-xy');
    const keys = document.querySelectorAll('[data-devkey]');

    btnDump?.addEventListener('click', dumpScreen);
    btnCopy?.addEventListener('click', () => {
      const txt = $('dev-output')?.textContent || '';
      navigator.clipboard.writeText(txt).then(() => showToast('已复制')).catch(() => showToast('复制失败'));
    });
    btnTapText?.addEventListener('click', () => tapByText(inputText.value.trim()));
    btnTapXY?.addEventListener('click', () => {
      const xy = inputXY.value.trim().split(',').map(Number);
      if (xy.length === 2 && Number.isFinite(xy[0]) && Number.isFinite(xy[1])) {
        tapByXY(xy[0], xy[1]);
      } else {
        showToast('坐标格式错误，应为 x,y');
      }
    });
    keys.forEach(k => {
      k.addEventListener('click', () => {
        const action = k.dataset.devkey;
        if (action === 'back') globalAction('BACK');
        else if (action === 'home') globalAction('HOME');
        else if (action === 'recents') globalAction('RECENTS');
        else if (action === 'notifications') globalAction('NOTIFICATIONS');
      });
    });
  }

  function bindMeRows() {
    $('row-device')?.addEventListener('click', () => openSheet('sheet-device'));
    $('row-plugins')?.addEventListener('click', () => { renderPlugins(); openSheet('sheet-plugins'); });
    $('row-privacy')?.addEventListener('click', () => openExternal('https://xiaohuanxiong.com/privacy'));
    $('row-terms')?.addEventListener('click', () => openExternal('https://xiaohuanxiong.com/terms'));
    $('row-github')?.addEventListener('click', () => openExternal('https://github.com/giangnam728828-rgb/raccoon-mobile'));
  }

  // Export
  Object.assign(RC, {
    checkDeviceSupport, bindDeviceSheet, bindMeRows,
    dumpScreen, tapByText, tapByXY, globalAction,
    renderPlugins, openExternal,
  });

  global.RC = RC;
})(window);
