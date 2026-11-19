/* ============================================================
   提示词库
   ============================================================ */
(function (global) {
  'use strict';

  const RC = global.RC;
  const S = RC.state;
  const { $, el, icon } = RC;

  function promptRow(p) {
    const row = el('div', 'prompt-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const main = el('div', 'prompt-main');
    main.appendChild(el('div', 'prompt-name', p.name));
    main.appendChild(el('div', 'prompt-text', p.text));
    row.appendChild(main);

    if (!p.builtin) {
      const del = el('button', 'del');
      del.type = 'button';
      del.setAttribute('aria-label', '删除 ' + p.name);
      del.appendChild(icon('trash', 'sm'));
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await RC.confirmBox('删除提示词「' + p.name + '」？', {
          okText: '删除', danger: true,
        });
        if (!ok) return;
        RC.deletePrompt(p.id);
        renderPrompts();
        RC.renderMe();
        RC.toast('已删除');
      });
      row.appendChild(del);
    }

    const use = () => {
      RC.fillComposer(p.text);
      RC.closeSheet('sheet-prompts');
    };
    row.addEventListener('click', use);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        use();
      }
    });
    return row;
  }

  function renderPrompts() {
    const box = $('prompt-list');
    if (!box) return;
    box.innerHTML = '';

    const mine = S.prompts;
    const builtin = RC.BUILTIN_PROMPTS;

    if (mine.length) {
      const l = el('div', 'section-label');
      l.textContent = '我的提示词';
      box.appendChild(l);
      mine.forEach((p) => box.appendChild(promptRow(p)));
    }

    const l2 = el('div', 'section-label');
    l2.textContent = '内置提示词';
    box.appendChild(l2);
    builtin.forEach((p) => box.appendChild(promptRow(p)));
  }

  function openAddPrompt() {
    let sheet = $('sheet-prompt-new');
    if (!sheet) {
      sheet = el('div', 'sheet hidden');
      sheet.id = 'sheet-prompt-new';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.innerHTML =
        '<div class="sheet-scrim" data-close></div>' +
        '<div class="sheet-panel tall">' +
        '<div class="sheet-grip"></div>' +
        '<div class="sheet-head"><span class="t">新建提示词</span>' +
        '<button class="icon-btn sm" data-close type="button" aria-label="关闭">' +
        '<svg class="i"><use href="#i-close"/></svg></button></div>' +
        '<div class="sheet-body">' +
        '<div class="field"><label for="pn-name">名称</label>' +
        '<input id="pn-name" class="input" placeholder="例如：周报总结" maxlength="40"></div>' +
        '<div class="field" style="margin-top:14px"><label for="pn-text">内容</label>' +
        '<textarea id="pn-text" class="input" style="min-height:150px" ' +
        'placeholder="例如：把下面的工作记录整理成周报，分「本周完成 / 进行中 / 下周计划」三段。"></textarea></div>' +
        '</div>' +
        '<div class="sheet-actions"><button id="pn-save" class="btn btn-primary btn-block" type="button">保存</button></div>' +
        '</div>';
      document.body.appendChild(sheet);
      RC.bindSheets();
    }

    const nameEl = sheet.querySelector('#pn-name');
    const textEl = sheet.querySelector('#pn-text');
    nameEl.value = '';
    textEl.value = '';

    const saveBtn = sheet.querySelector('#pn-save');
    const fresh = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(fresh, saveBtn);
    fresh.addEventListener('click', () => {
      const name = nameEl.value.trim();
      const text = textEl.value.trim();
      if (!text) {
        RC.toast('提示词内容不能为空');
        return;
      }
      RC.addPrompt(name || text.slice(0, 16), text);
      RC.closeSheet('sheet-prompt-new');
      renderPrompts();
      RC.renderMe();
      RC.toast('已保存');
    });

    RC.openSheet('sheet-prompt-new');
  }

  function bindPrompts() {
    const add = $('prompt-add');
    if (add) add.addEventListener('click', openAddPrompt);
  }

  Object.assign(RC, { renderPrompts, bindPrompts, openAddPrompt });
})(window);
