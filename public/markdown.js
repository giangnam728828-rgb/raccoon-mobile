/*
 * 轻量 Markdown 渲染（无依赖、无 CDN）。
 *
 * 为什么不用 marked：App 在弱网 / 断网下也要能渲染历史消息，多一个外链就多一个白屏机会。
 * 支持的语法覆盖模型输出的绝大多数场景：标题、段落、列表、引用、代码块、行内代码、
 * 粗体 / 斜体 / 删除线、链接、表格、分隔线。
 *
 * 所有文本先转义再拼接，链接只放行 http(s)，避免 XSS。
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function inline(src) {
    var s = src;
    s = s.replace(/`([^`\n]+)`/g, function (_, a) {
      return '<code class="md-code">' + a + '</code>';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, text, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    });
    // 裸链接（避免重复处理已经在 a 标签里的）
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
    return s;
  }

  function codeBlock(lang, code) {
    var l = String(lang || '').toLowerCase().slice(0, 16);
    return (
      '<div class="code-block">' +
      '<div class="code-head"><span class="code-lang">' +
      esc(l || 'code') +
      '</span><button class="code-copy" type="button">复制</button></div>' +
      '<pre><code>' +
      esc(code) +
      '</code></pre></div>'
    );
  }

  function isBlank(line) {
    return !line || !line.trim();
  }

  function isBlockStart(line) {
    return (
      /^\s*```/.test(line) ||
      /^#{1,6}\s+/.test(line) ||
      /^\s*>\s?/.test(line) ||
      /^\s*([-*+]|\d+\.)\s+/.test(line) ||
      /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)
    );
  }

  function splitRow(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) {
      return c.trim();
    });
  }

  function render(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (isBlank(line)) {
        i += 1;
        continue;
      }

      // 代码块（流式时可能还没闭合，先按代码块渲染）
      var fence = /^\s*```(\S*)\s*$/.exec(line);
      if (fence) {
        var buf = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        out.push(codeBlock(fence[1], buf.join('\n')));
        continue;
      }

      // 分隔线
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line) && !/^\s*[-*+]\s+/.test(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      // 标题
      var head = /^(#{1,6})\s+(.*)$/.exec(line);
      if (head) {
        var lv = Math.min(head[1].length + 1, 6); // h1 留给页面标题，正文从 h2 起
        out.push('<h' + lv + '>' + inline(esc(head[2].trim())) + '</h' + lv + '>');
        i += 1;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }

      // 表格
      if (
        line.indexOf('|') >= 0 &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:\-]+\|[\s:|\-]*$/.test(lines[i + 1])
      ) {
        var headCells = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !isBlank(lines[i])) {
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        var html = '<div class="md-table"><table><thead><tr>';
        for (var hc = 0; hc < headCells.length; hc++) html += '<th>' + inline(esc(headCells[hc])) + '</th>';
        html += '</tr></thead><tbody>';
        for (var r = 0; r < rows.length; r++) {
          html += '<tr>';
          for (var c = 0; c < headCells.length; c++) {
            html += '<td>' + inline(esc(rows[r][c] == null ? '' : rows[r][c])) + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        out.push(html);
        continue;
      }

      // 列表
      var li = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (li) {
        var ordered = /\d+\./.test(li[2]);
        var items = [];
        var baseIndent = li[1].length;
        while (i < lines.length) {
          var m2 = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (!m2) break;
          if (m2[1].length < baseIndent) break;
          var ord2 = /\d+\./.test(m2[2]);
          if (m2[1].length === baseIndent && ord2 !== ordered) break;
          var indent = m2[1].length > baseIndent ? ' class="md-sub"' : '';
          items.push('<li' + indent + '>' + inline(esc(m2[3])) + '</li>');
          i += 1;
        }
        out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }

      // 段落
      var para = [];
      while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i])) {
        para.push(lines[i]);
        i += 1;
      }
      if (!para.length) {
        i += 1;
        continue;
      }
      out.push('<p>' + inline(esc(para.join('\n'))).replace(/\n/g, '<br>') + '</p>');
    }

    return out.join('\n');
  }

  global.MD = { render: render, escape: esc };
})(typeof window !== 'undefined' ? window : globalThis);
