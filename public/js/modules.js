/* ============================================================
   小浣熊 v4.0 · 扩展模块：文件管理 / 终端 / Git / 代码编辑器
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, $$, el, icon, toast, haptic, openSheet, closeSheet, confirmBox } = RC;

  // ============================================================
  // 文件管理器
  // ============================================================
  let fmState = {
    cwd: '',
    entries: [],
    selected: new Set(),
    viewMode: 'list', // list | grid
    sortBy: 'name',   // name | size | modified
    sortDesc: false,
  };

  const FM_ROOT = '/Documents/Raccoon';

  async function fmInit() {
    fmState.cwd = FM_ROOT;
    await fmLoad();
    fmBind();
  }

  async function fmLoad() {
    const box = $('file-manager');
    if (!box) return;

    try {
      const res = await RC.api('/api/fs/list', {
        method: 'POST',
        body: { path: fmState.cwd }
      });
      if (res.ok && Array.isArray(res.entries)) {
        fmState.entries = res.entries;
      } else {
        fmState.entries = [];
        if (!res.ok) toast(res.message || '读取目录失败');
      }
    } catch (e) {
      fmState.entries = [];
      toast(e.message || '读取目录失败');
    }
    fmRender();
  }

  function fmRender() {
    const box = $('file-manager');
    if (!box) return;
    box.innerHTML = '';

    // 路径栏
    const pathBar = el('div', 'fm-pathbar');
    pathBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border-divider);background:var(--surface-raised);flex-wrap:wrap';
    const parts = fmState.cwd.replace(FM_ROOT, '').split('/').filter(Boolean);
    let currentPath = FM_ROOT;
    const homeBtn = el('button', 'btn btn-ghost btn-sm');
    homeBtn.innerHTML = '<svg class="i"><use href="#i-folder"/></svg> Raccoon';
    homeBtn.onclick = () => { fmState.cwd = FM_ROOT; fmLoad(); };
    pathBar.appendChild(homeBtn);
    parts.forEach((part, i) => {
      currentPath += '/' + part;
      const sep = el('span', '', '/');
      sep.style.cssText = 'color:var(--text-muted);font-size:13px';
      pathBar.appendChild(sep);
      const btn = el('button', 'btn btn-ghost btn-sm');
      btn.textContent = part;
      btn.style.cssText = 'font-size:13px;padding:0 8px;min-height:28px';
      btn.onclick = () => { fmState.cwd = currentPath; fmLoad(); };
      pathBar.appendChild(btn);
    });
    box.appendChild(pathBar);

    // 工具栏
    const toolbar = el('div', 'fm-toolbar');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border-divider);background:var(--surface-base);flex-wrap:wrap';
    const newFolderBtn = el('button', 'btn btn-secondary btn-sm');
    newFolderBtn.innerHTML = '<svg class="i"><use href="#i-plus"/></svg> 新建文件夹';
    newFolderBtn.onclick = fmNewFolder;
    const newFileBtn = el('button', 'btn btn-secondary btn-sm');
    newFileBtn.innerHTML = '<svg class="i"><use href="#i-file-code"/></svg> 新建文件';
    newFileBtn.onclick = fmNewFile;
    const uploadBtn = el('button', 'btn btn-secondary btn-sm');
    uploadBtn.innerHTML = '<svg class="i"><use href="#i-upload"/></svg> 上传';
    uploadBtn.onclick = () => $('file-upload').click();
    const viewToggle = el('button', 'btn btn-ghost btn-sm');
    viewToggle.innerHTML = fmState.viewMode === 'list' ? '<svg class="i"><use href="#i-minimize"/></svg>' : '<svg class="i"><use href="#i-maximize"/></svg>';
    viewToggle.title = '切换视图';
    viewToggle.onclick = () => { fmState.viewMode = fmState.viewMode === 'list' ? 'grid' : 'list'; fmRender(); };
    toolbar.append(newFolderBtn, newFileBtn, uploadBtn, viewToggle);
    box.appendChild(toolbar);

    // 文件列表
    const list = el('div', 'fm-list');
    list.style.cssText = 'flex:1;overflow:auto;padding:8px';
    if (fmState.entries.length === 0) {
      const empty = el('div', 'empty');
      empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:32px;text-align:center';
      empty.innerHTML = '<div class="empty-art"><img src="/img/brand-sm.jpg" width="64" height="64"></div><h2>目录为空</h2><p>点击上方按钮新建文件或文件夹</p>';
      list.appendChild(empty);
    } else {
      if (fmState.viewMode === 'list') {
        const table = el('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:14px';
        table.innerHTML = '<thead><tr style="text-align:left;color:var(--text-muted);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.05em"><th style="padding:8px 12px">名称</th><th style="padding:8px 12px;width:100px">大小</th><th style="padding:8px 12px;width:160px">修改时间</th><th style="padding:8px 12px;width:60px"></th></tr></thead><tbody></tbody>';
        const tbody = table.querySelector('tbody');
        fmState.entries.forEach(entry => {
          const tr = el('tr');
          tr.style.cssText = 'cursor:pointer;border-bottom:1px solid var(--border-divider);transition:background var(--duration-fast)';
          tr.onmouseenter = () => tr.style.background = 'var(--surface-hover)';
          tr.onmouseleave = () => tr.style.background = '';
          tr.onclick = (e) => {
            if (e.target.closest('button')) return;
            if (entry.isDir) { fmState.cwd = entry.path; fmLoad(); }
            else { fmOpenFile(entry); }
          };
          const isSel = fmState.selected.has(entry.path);
          if (isSel) tr.style.background = 'var(--surface-selected)';
          const nameTd = el('td');
          nameTd.style.padding = '10px 12px';
          nameTd.style.display = 'flex';
          nameTd.style.alignItems = 'center';
          nameTd.style.gap = '10px';
          const iconEl = el('span');
          iconEl.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--surface-sunken);color:var(--icon-primary)';
          iconEl.innerHTML = entry.isDir ? '<svg class="i i-md"><use href="#i-folder"/></svg>' : '<svg class="i i-md"><use href="#i-file-code"/></svg>';
          const nameText = el('span');
          nameText.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)';
          nameText.textContent = entry.name;
          nameTd.append(iconEl, nameText);
          const sizeTd = el('td');
          sizeTd.style.padding = '10px 12px';
          sizeTd.style.color = 'var(--text-muted)';
          sizeTd.style.fontSize = '13px';
          sizeTd.style.fontFamily = 'var(--font-mono)';
          sizeTd.textContent = entry.isDir ? '—' : RC.fmtBytes(entry.size);
          const timeTd = el('td');
          timeTd.style.padding = '10px 12px';
          timeTd.style.color = 'var(--text-muted)';
          timeTd.style.fontSize = '13px';
          timeTd.textContent = RC.fmtTime(entry.modified);
          const actionsTd = el('td');
          actionsTd.style.padding = '10px 12px';
          actionsTd.style.textAlign = 'right';
          const menuBtn = el('button', 'icon-btn sm');
          menuBtn.innerHTML = '<svg class="i"><use href="#i-more"/></svg>';
          menuBtn.onclick = (e) => { e.stopPropagation(); fmShowMenu(entry, menuBtn); };
          actionsTd.appendChild(menuBtn);
          tr.append(nameTd, sizeTd, timeTd, actionsTd);
          tbody.appendChild(tr);
        });
        list.appendChild(table);
      } else {
        // Grid view
        const grid = el('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px';
        fmState.entries.forEach(entry => {
          const card = el('div');
          card.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:12px;border-radius:var(--r-card);border:1px solid var(--border-divider);background:var(--surface-raised);cursor:pointer;transition:var(--transition-card)';
          card.onmouseenter = () => { card.style.borderColor = 'var(--border-focus)'; card.style.boxShadow = 'var(--shadow-sm)'; card.style.transform = 'translateY(-2px)'; };
          card.onmouseleave = () => { card.style.borderColor = 'var(--border-divider)'; card.style.boxShadow = 'none'; card.style.transform = 'none'; };
          card.onclick = (e) => {
            if (e.target.closest('button')) return;
            if (entry.isDir) { fmState.cwd = entry.path; fmLoad(); }
            else { fmOpenFile(entry); }
          };
          const isSel = fmState.selected.has(entry.path);
          if (isSel) { card.style.borderColor = 'var(--border-focus)'; card.style.background = 'var(--surface-selected)'; }
          const iconBox = el('div');
          iconBox.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:var(--surface-sunken);color:var(--icon-primary);margin-bottom:8px';
          iconBox.innerHTML = entry.isDir ? '<svg class="i i-lg"><use href="#i-folder"/></svg>' : '<svg class="i i-lg"><use href="#i-file-code"/></svg>';
          const nameEl = el('div');
          nameEl.style.cssText = 'font-size:13px;color:var(--text-primary);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%';
          nameEl.textContent = entry.name;
          card.append(iconBox, nameEl);
          grid.appendChild(card);
        });
        list.appendChild(grid);
      }
    }
    box.appendChild(list);
  }

  function fmShowMenu(entry, anchor) {
    // 简单的右键菜单实现
    const existing = document.querySelector('.fm-context');
    if (existing) existing.remove();
    const menu = el('div', 'fm-context');
    menu.style.cssText = 'position:fixed;z-index:1000;background:var(--surface-raised);border:1px solid var(--border-primary);border-radius:var(--r-control);box-shadow:var(--shadow-lg);min-width:160px;padding:4px 0';
    const rect = anchor.getBoundingClientRect();
    menu.style.left = (rect.left - 160) + 'px';
    menu.style.top = rect.bottom + 'px';
    const items = [
      { label: entry.isDir ? '打开' : '编辑', icon: entry.isDir ? 'i-folder' : 'i-file-code', action: () => entry.isDir ? (fmState.cwd = entry.path, fmLoad()) : fmOpenFile(entry) },
      { label: '重命名', icon: 'i-edit', action: () => fmRename(entry) },
      { label: '复制路径', icon: 'i-copy', action: () => { RC.copyText(entry.path); toast('已复制路径'); } },
      { label: '下载', icon: 'i-download', action: () => fmDownload(entry) },
      { label: '删除', icon: 'i-trash', danger: true, action: () => fmDelete(entry) },
    ];
    items.forEach(it => {
      const btn = el('button');
      btn.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;border:none;background:none;color:' + (it.danger ? 'var(--text-error)' : 'var(--text-primary)') + ';font:var(--style-body4);text-align:left;cursor:pointer';
      btn.innerHTML = '<svg class="i"><use href="#' + it.icon + '"/></svg>' + it.label;
      btn.onmouseenter = () => btn.style.background = 'var(--surface-hover)';
      btn.onmouseleave = () => btn.style.background = 'none';
      btn.onclick = () => { it.action(); menu.remove(); };
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  async function fmNewFolder() {
    const name = await RC.prompt('新建文件夹名称');
    if (!name) return;
    try {
      const res = await RC.api('/api/fs/mkdir', { method: 'POST', body: { path: fmState.cwd + '/' + name } });
      if (res.ok) { toast('已创建'); fmLoad(); }
      else toast(res.message || '创建失败');
    } catch (e) { toast(e.message || '创建失败'); }
  }

  async function fmNewFile() {
    const name = await RC.prompt('新建文件名称（含扩展名）');
    if (!name) return;
    try {
      const res = await RC.api('/api/fs/write', { method: 'POST', body: { path: fmState.cwd + '/' + name, content: '' } });
      if (res.ok) { toast('已创建'); fmLoad(); fmOpenFile({ path: res.path, name, isDir: false }); }
      else toast(res.message || '创建失败');
    } catch (e) { toast(e.message || '创建失败'); }
  }

  async function fmRename(entry) {
    const name = await RC.prompt('重命名', entry.name);
    if (!name || name === entry.name) return;
    try {
      const res = await RC.api('/api/fs/rename', { method: 'POST', body: { from: entry.path, to: fmState.cwd + '/' + name } });
      if (res.ok) { toast('已重命名'); fmLoad(); }
      else toast(res.message || '重命名失败');
    } catch (e) { toast(e.message || '重命名失败'); }
  }

  async function fmDelete(entry) {
    const ok = await confirmBox('删除「' + entry.name + '」？此操作不可恢复。', { okText: '删除', danger: true });
    if (!ok) return;
    try {
      const res = await RC.api('/api/fs/delete', { method: 'POST', body: { path: entry.path } });
      if (res.ok) { toast('已删除'); fmLoad(); }
      else toast(res.message || '删除失败');
    } catch (e) { toast(e.message || '删除失败'); }
  }

  async function fmDownload(entry) {
    if (entry.isDir) { toast('文件夹下载暂不支持'); return; }
    try {
      const res = await RC.api('/api/fs/read', { method: 'POST', body: { path: entry.path } });
      if (res.ok && res.content != null) {
        const blob = new Blob([res.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = entry.name;
        a.click();
        URL.revokeObjectURL(url);
        toast('下载已开始');
      } else {
        toast(res.message || '读取失败');
      }
    } catch (e) { toast(e.message || '下载失败'); }
  }

  function fmOpenFile(entry) {
    if (entry.isDir) return;
    editorOpen(entry.path, entry.name);
  }

  async function fmUpload() {
    const input = $('file-upload');
    if (!input || !input.files.length) return;
    const files = Array.from(input.files);
    for (const f of files) {
      try {
        const text = await f.text();
        const res = await RC.api('/api/fs/write', { method: 'POST', body: { path: fmState.cwd + '/' + f.name, content: text } });
        if (!res.ok) toast(f.name + ' 上传失败：' + (res.message || ''));
      } catch (e) { toast(f.name + ' 上传失败：' + e.message); }
    }
    input.value = '';
    fmLoad();
  }

  function fmBind() {
    $('file-upload').addEventListener('change', fmUpload);
  }

  // ============================================================
  // 代码编辑器
  // ============================================================
  let editorState = {
    path: '',
    name: '',
    content: '',
    language: 'plaintext',
    modified: false,
    cm: null,
  };

  function editorOpen(path, name) {
    editorState.path = path;
    editorState.name = name;
    editorState.language = detectLanguage(name);
    openSheet('sheet-editor');
    $('editor-title').textContent = name;
    setTimeout(() => editorLoad(), 100);
  }

  async function editorLoad() {
    try {
      const res = await RC.api('/api/fs/read', { method: 'POST', body: { path: editorState.path } });
      if (res.ok) {
        editorState.content = res.content || '';
        editorInit();
      } else {
        toast(res.message || '读取文件失败');
        closeSheet('sheet-editor');
      }
    } catch (e) {
      toast(e.message || '读取文件失败');
      closeSheet('sheet-editor');
    }
  }

  // ---- CodeMirror 6 动态加载（失败自动降级到 textarea）----
  let cmModules = null;

  async function tryLoadCodeMirror() {
    if (cmModules) return cmModules;
    const cdn = 'https://cdn.jsdelivr.net/npm';
    const [cm, langJs, langPy, langHtml, langCss, langJson, langMd, langXml, langShell] =
      await Promise.all([
        import(`${cdn}/codemirror@6/+esm`),
        import(`${cdn}/@codemirror/lang-javascript@6/+esm`),
        import(`${cdn}/@codemirror/lang-python@6/+esm`),
        import(`${cdn}/@codemirror/lang-html@6/+esm`),
        import(`${cdn}/@codemirror/lang-css@6/+esm`),
        import(`${cdn}/@codemirror/lang-json@6/+esm`),
        import(`${cdn}/@codemirror/lang-markdown@6/+esm`),
        import(`${cdn}/@codemirror/lang-xml@6/+esm`),
        import(`${cdn}/@codemirror/lang-shell@6/+esm`),
      ]);
    cmModules = { cm, langJs, langPy, langHtml, langCss, langJson, langMd, langXml, langShell };
    return cmModules;
  }

  function getLangExtensions(m, ext) {
    try {
      if (ext === 'js') return [m.langJs.javascript()];
      if (ext === 'jsx') return [m.langJs.javascript({ jsx: true })];
      if (ext === 'ts') return [m.langJs.javascript({ typescript: true })];
      if (ext === 'tsx') return [m.langJs.javascript({ jsx: true, typescript: true })];
      if (ext === 'py') return [m.langPy.python()];
      if (ext === 'html') return [m.langHtml.html()];
      if (ext === 'css') return [m.langCss.css()];
      if (ext === 'json') return [m.langJson.json()];
      if (ext === 'md') return [m.langMd.markdown()];
      if (ext === 'xml' || ext === 'svg') return [m.langXml.xml()];
      if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return [m.langShell.shell()];
    } catch {}
    return [];
  }

  function editorInit() {
    const box = $('editor');
    if (!box) return;
    box.innerHTML = '';
    editorInitTextarea(box);
    // 异步升级到 CodeMirror
    tryLoadCodeMirror().then((m) => editorInitCM(box, m)).catch(() => {});
  }

  function editorInitCM(box, m) {
    const { cm } = m;
    const ext = editorState.name.split('.').pop().toLowerCase();
    const dark = RC.effectiveTheme() === 'dark';
    const theme = cm.EditorView.theme({
      '&': { backgroundColor: dark ? '#1c1719' : '#faf1ee', color: dark ? '#f2e9e7' : '#2e262c', fontSize: '13px', height: '100%' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto' },
      '.cm-gutters': { backgroundColor: dark ? '#171315' : '#f5e8e2', color: dark ? '#958085' : '#c29d8c', border: 'none' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: dark ? '#3a1a1c' : '#fef2f2' },
      '.cm-activeLine': { backgroundColor: dark ? '#231c1f' : '#efe0d8' },
      '.cm-cursor': { borderLeftColor: dark ? '#d9969d' : '#a5525d' },
    });
    const editor = new cm.EditorView({
      doc: editorState.content,
      extensions: [
        cm.basicSetup,
        cm.lineNumbers(),
        cm.highlightActiveLine(),
        cm.bracketMatching(),
        cm.closeBrackets(),
        cm.indentOnInput(),
        ...getLangExtensions(m, ext),
        theme,
        cm.EditorView.updateListener.of((v) => {
          if (v.docChanged) editorState.modified = true;
        }),
      ],
      parent: box,
    });
    // 移除降级用的 textarea
    box.querySelectorAll('textarea').forEach((t) => t.remove());
    editorState.cm = editor;
    box.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); editorSave(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); editorRun(); }
    });
  }

  function editorInitTextarea(box) {
    const ta = el('textarea');
    ta.style.cssText = 'width:100%;height:100%;border:none;outline:none;resize:none;padding:16px;font-family:var(--font-mono);font-size:13px;line-height:1.6;background:var(--core-paper-1000);color:var(--core-paper-00)';
    ta.value = editorState.content;
    ta.spellcheck = false;
    ta.addEventListener('input', () => { editorState.content = ta.value; editorState.modified = true; });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const start = ta.selectionStart; ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = start + 2; editorState.content = ta.value; editorState.modified = true; }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); editorSave(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); editorRun(); }
    });
    box.appendChild(ta);
  }

  async function editorSave() {
    if (!editorState.modified) return;
    try {
      const content = editorState.cm ? editorState.cm.state.doc.toString() : editorState.content;
      const res = await RC.api('/api/fs/write', { method: 'POST', body: { path: editorState.path, content } });
      if (res.ok) { editorState.modified = false; editorState.content = content; toast('已保存'); }
      else toast(res.message || '保存失败');
    } catch (e) { toast(e.message || '保存失败'); }
  }

  async function editorRun() {
    if (!editorState.path) return;
    const ext = editorState.name.split('.').pop().toLowerCase();
    let cmd = '';
    if (ext === 'js') cmd = 'node';
    else if (ext === 'py') cmd = 'python3';
    else if (ext === 'sh') cmd = 'bash';
    else { toast('暂不支持直接运行 ' + ext + ' 文件'); return; }
    toast('正在运行...');
    try {
      const res = await RC.api('/api/exec', { method: 'POST', body: { cmd, args: [editorState.path], cwd: FM_ROOT, timeout: 30000 } });
      if (res.ok) {
        terminalShowOutput(res.stdout || '', res.stderr || '', res.code);
        openSheet('sheet-terminal');
      } else {
        toast(res.message || '运行失败');
      }
    } catch (e) { toast(e.message || '运行失败'); }
  }

  function detectLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
      py: 'python', html: 'htmlmixed', css: 'css', json: 'json',
      md: 'markdown', yaml: 'yaml', yml: 'yaml', xml: 'xml',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      c: 'clike', cpp: 'clike', cc: 'clike', h: 'clike', hpp: 'clike',
      java: 'clike', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
      swift: 'swift', kt: 'kotlin', scala: 'clike', dart: 'dart',
      lua: 'lua', pl: 'perl', pm: 'perl', r: 'r', sql: 'sql',
      toml: 'toml', ini: 'properties', cfg: 'properties',
    };
    return map[ext] || 'plaintext';
  }

  // ============================================================
  // 终端
  // ============================================================
  let termState = { ws: null, buffer: '', pending: '' };

  function terminalShowOutput(stdout, stderr, code) {
    const box = $('terminal');
    if (!box) return;
    const now = new Date().toLocaleTimeString();
    const add = (text, cls) => {
      const div = el('div');
      div.style.cssText = 'font-family:var(--font-mono);font-size:13px;line-height:1.6;padding:2px 0;white-space:pre-wrap;word-break:break-word';
      if (cls) div.style.color = cls;
      div.textContent = text;
      box.appendChild(div);
    };
    add('[' + now + '] $ ' + cmd + ' ' + editorState.path, 'var(--text-muted)');
    if (stdout) add(stdout, 'var(--text-primary)');
    if (stderr) add(stderr, 'var(--text-error)');
    add('[退出码: ' + code + ']', code === 0 ? 'var(--text-success)' : 'var(--text-error)');
    box.scrollTop = box.scrollHeight;
  }

  function terminalConnect() {
    // WebSocket 连接后端终端（简化版，实际需要后端支持）
    // 这里仅做演示，真实实现需要后端 WebSocket 服务
  }

  function terminalDisconnect() {
    if (termState.ws) { termState.ws.close(); termState.ws = null; }
  }

  function terminalBind() {
    $('#term-clear').onclick = () => { $('terminal').innerHTML = ''; };
    $('#term-kill').onclick = () => { toast('终止功能需后端支持'); };
  }

  // ============================================================
  // Git
  // ============================================================
  async function gitLoad() {
    const box = $('git-body');
    if (!box) return;
    box.innerHTML = '<div class="sheet-loading"><div class="spinner"></div><p>加载中...</p></div>';
    try {
      const res = await RC.api('/api/git/status', { method: 'POST', body: { cwd: FM_ROOT } });
      if (res.ok) {
        gitRender(res);
      } else {
        box.innerHTML = '<div class="sheet-error"><svg class="i i-xl"><use href="#i-warn"/></svg><h3>加载失败</h3><p>' + (res.message || '未知错误') + '</p></div>';
      }
    } catch (e) {
      box.innerHTML = '<div class="sheet-error"><svg class="i i-xl"><use href="#i-warn"/></svg><h3>加载失败</h3><p>' + e.message + '</p></div>';
    }
  }

  function gitRender(status) {
    const box = $('git-body');
    box.innerHTML = '';
    // 分支信息
    const branchInfo = el('div');
    branchInfo.style.cssText = 'padding:12px 16px;background:var(--surface-sunken);border-radius:var(--r-control);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
    branchInfo.innerHTML = '<div><strong style="color:var(--text-primary)">分支：</strong><span style="color:var(--text-accent);font-family:var(--font-mono);margin-left:8px">' + (status.branch || 'main') + '</span></div><div style="font-size:13px;color:var(--text-muted)">远程：' + (status.remote || '未配置') + '</div>';
    box.appendChild(branchInfo);

    // 状态区域
    const sections = [
      { key: 'staged', label: '已暂存', color: 'var(--text-success)', icon: 'i-check' },
      { key: 'unstaged', label: '未暂存', color: 'var(--text-warning)', icon: 'i-edit' },
      { key: 'untracked', label: '未跟踪', color: 'var(--text-muted)', icon: 'i-plus' },
    ];
    sections.forEach(sec => {
      const files = status[sec.key] || [];
      if (!files.length) return;
      const label = el('div', 'section-label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';
      label.innerHTML = '<svg class="i" style="color:' + sec.color + '"><use href="#' + sec.icon + '"/></svg>' + sec.label + ' (' + files.length + ')';
      box.appendChild(label);
      files.forEach(f => {
        const row = el('div', 'list-row');
        row.style.minHeight = '44px';
        row.style.padding = '8px 16px';
        row.innerHTML = '<span class="icon" style="color:' + sec.color + '"><svg class="i"><use href="#i-file-code"/></use></svg></span><span class="label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + f + '</span>';
        box.appendChild(row);
      });
    });

    // 最近提交
    if (status.log && status.log.length) {
      const label = el('div', 'section-label');
      label.innerHTML = '<svg class="i"><use href="#i-history"/></svg> 最近提交';
      box.appendChild(label);
      status.log.slice(0, 10).forEach(c => {
        const row = el('div', 'list-row');
        row.style.minHeight = '44px';
        row.style.padding = '8px 16px';
        row.innerHTML = '<span class="label" style="flex:1"><strong style="color:var(--text-primary)">' + c.hash.slice(0, 7) + '</strong> <span style="color:var(--text-secondary);margin-left:8px">' + c.message.split('\n')[0] + '</span></span><span class="val" style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">' + RC.fmtTime(c.timestamp) + '</span>';
        box.appendChild(row);
      });
    }
  }

  async function gitPull() {
    toast('正在拉取...');
    try {
      const res = await RC.api('/api/git/pull', { method: 'POST', body: { cwd: FM_ROOT } });
      if (res.ok) { toast('拉取成功'); gitLoad(); }
      else toast(res.message || '拉取失败');
    } catch (e) { toast(e.message || '拉取失败'); }
  }

  async function gitPush() {
    toast('正在推送...');
    try {
      const res = await RC.api('/api/git/push', { method: 'POST', body: { cwd: FM_ROOT } });
      if (res.ok) { toast('推送成功'); gitLoad(); }
      else toast(res.message || '推送失败');
    } catch (e) { toast(e.message || '推送失败'); }
  }

  async function gitInitRepo() {
    const ok = await confirmBox('在 ' + FM_ROOT + ' 初始化 Git 仓库？', { okText: '初始化' });
    if (!ok) return;
    try {
      const res = await RC.api('/api/git/init', { method: 'POST', body: { cwd: FM_ROOT } });
      if (res.ok) { toast('初始化成功'); gitLoad(); }
      else toast(res.message || '初始化失败');
    } catch (e) { toast(e.message || '初始化失败'); }
  }

  // ============================================================
  // 绑定入口
  // ============================================================
  function bindModules() {
    // 文件管理
    $('#row-files').addEventListener('click', () => { fmInit(); openSheet('sheet-files'); });
    $('#file-new-folder').onclick = fmNewFolder;
    $('#file-new-file').onclick = fmNewFile;
    $('#file-upload').onclick = () => $('file-upload-input').click();

    // 终端
    $('#row-terminal').addEventListener('click', () => { terminalConnect(); openSheet('sheet-terminal'); });
    $('#term-clear').onclick = () => { $('terminal').innerHTML = ''; };
    $('#term-kill').onclick = terminalDisconnect;

    // Git
    $('#row-git').addEventListener('click', () => { gitLoad(); openSheet('sheet-git'); });
    $('#git-pull').onclick = gitPull;
    $('#git-push').onclick = gitPush;

    // 编辑器
    $('#editor-save').onclick = editorSave;
    $('#editor-run').onclick = editorRun;

    // Sheet 打开时加载
    const origOpenSheet = RC.openSheet;
    RC.openSheet = function(id) {
      origOpenSheet(id);
      if (id === 'sheet-files') { fmInit(); }
      if (id === 'sheet-git') { gitLoad(); }
      if (id === 'sheet-terminal') { terminalConnect(); }
    };
  }

  // 暴露给 RC
  Object.assign(RC, {
    fmInit, fmLoad, fmRender, fmNewFolder, fmNewFile, fmRename, fmDelete, fmDownload, fmOpenFile, fmUpload,
    editorOpen, editorSave, editorRun,
    gitLoad, gitPull, gitPush, gitInitRepo,
    bindModules,
  });
})(window);