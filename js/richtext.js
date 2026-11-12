/* Editor di testo formattato: grassetto, corsivo, sottolineato, barrato, codice in linea, blocco di codice */
(function (Q) {
  'use strict';
  const h = Q.h;
  let activeRefresh = null;
  document.addEventListener('selectionchange', () => { if (activeRefresh) activeRefresh(); });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const K = isMac ? '⌘' : 'Ctrl+';

  Q.RichEditor = function ({ value, placeholder, onChange, rows = 2 }) {
    const area = h('div', {
      class: 'rte-area', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true',
      'data-placeholder': placeholder || '', style: { minHeight: (rows * 1.5 + 1.3) + 'em' },
    });
    area.innerHTML = Q.richHtml(value);

    const emit = () => onChange(area.innerHTML ? Q.sanitizeHtml(area.innerHTML) : '');
    const closestIn = (tag) => {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      let n = sel.getRangeAt(0).startContainer;
      while (n && n !== area) {
        if (n.nodeType === 1 && n.tagName === tag) return n;
        n = n.parentNode;
      }
      return null;
    };
    const inside = () => {
      const sel = getSelection();
      return sel.rangeCount > 0 && area.contains(sel.getRangeAt(0).commonAncestorContainer);
    };
    const exec = (cmd, val) => {
      area.focus();
      document.execCommand(cmd, false, val == null ? null : val);
      emit();
      refresh();
    };

    function toggleInlineCode() {
      area.focus();
      if (closestIn('PRE')) return;
      const sel = getSelection();
      if (!sel.rangeCount) return;
      const code = closestIn('CODE');
      if (code) {
        const r = document.createRange();
        r.selectNode(code);
        sel.removeAllRanges();
        sel.addRange(r);
        document.execCommand('insertText', false, code.textContent);
      } else {
        const r = sel.getRangeAt(0);
        if (r.collapsed) {
          document.execCommand('insertHTML', false, '<code data-new="1">codice</code>');
          const el = area.querySelector('code[data-new]');
          if (el) {
            el.removeAttribute('data-new');
            const nr = document.createRange();
            nr.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(nr);
          }
        } else {
          document.execCommand('insertHTML', false, '<code>' + esc(r.toString()) + '</code>');
        }
      }
      emit();
      refresh();
    }
    function toggleCodeBlock() {
      area.focus();
      document.execCommand('formatBlock', false, closestIn('PRE') ? 'div' : 'pre');
      emit();
      refresh();
    }
    function clearFormat() {
      area.focus();
      document.execCommand('removeFormat');
      if (closestIn('PRE')) document.execCommand('formatBlock', false, 'div');
      emit();
      refresh();
    }

    const buttons = [
      { ico: h('span', { class: 'i-b' }, 'B'), title: `Grassetto (${K}B)`, run: () => exec('bold'), on: () => document.queryCommandState('bold') },
      { ico: h('span', { class: 'i-i' }, 'I'), title: `Corsivo (${K}I)`, run: () => exec('italic'), on: () => document.queryCommandState('italic') },
      { ico: h('span', { class: 'i-u' }, 'U'), title: `Sottolineato (${K}U)`, run: () => exec('underline'), on: () => document.queryCommandState('underline') },
      { ico: h('span', { class: 'i-s' }, 'S'), title: `Barrato (${K}⇧X)`, run: () => exec('strikeThrough'), on: () => document.queryCommandState('strikeThrough') },
      'sep',
      { ico: h('span', { class: 'i-code' }, '</>'), title: `Codice nel testo (${K}E)`, run: toggleInlineCode, on: () => !!closestIn('CODE') && !closestIn('PRE') },
      { ico: h('span', { class: 'i-block' }, h('span', null, '{ }'), h('small', null, 'blocco')), title: 'Blocco di codice (più righe)', wide: true, run: toggleCodeBlock, on: () => !!closestIn('PRE') },
      'sep',
      { ico: h('span', { class: 'i-clear' }, 'T', h('sub', null, '×')), title: 'Rimuovi formattazione', run: clearFormat },
    ];
    const btnEls = [];
    const bar = h('div', { class: 'rte-bar' }, buttons.map((b) => {
      if (b === 'sep') return h('span', { class: 'rte-sep' });
      const el = h('button', {
        type: 'button', class: 'rte-btn' + (b.wide ? ' wide' : ''), title: b.title, tabindex: '-1',
        onmousedown: (e) => e.preventDefault(),
        onclick: () => b.run(),
      }, b.ico);
      btnEls.push([el, b]);
      return el;
    }));

    function refresh() {
      if (!inside()) return;
      for (const [el, b] of btnEls) if (b.on) el.classList.toggle('on', !!b.on());
    }

    area.addEventListener('focus', () => {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('defaultParagraphSeparator', false, 'div');
      activeRefresh = refresh;
    });
    area.addEventListener('blur', () => { btnEls.forEach(([el]) => el.classList.remove('on')); });
    area.addEventListener('input', () => {
      if (area.innerHTML === '<br>') area.innerHTML = '';
      emit();
    });
    area.addEventListener('keyup', refresh);
    area.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && k === 'e') { e.preventDefault(); toggleInlineCode(); }
      else if (mod && e.shiftKey && k === 'x') { e.preventDefault(); exec('strikeThrough'); }
      else if (e.key === 'Tab' && closestIn('PRE')) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      else if (e.key === 'Enter' && !e.shiftKey && closestIn('PRE')) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    });
    area.addEventListener('paste', (e) => {
      e.preventDefault();
      const cd = e.clipboardData;
      const html = cd.getData('text/html');
      const txt = cd.getData('text/plain');
      if (closestIn('PRE') || !html) document.execCommand('insertText', false, txt);
      else document.execCommand('insertHTML', false, Q.sanitizeHtml(html));
      emit();
    });
    area.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault(); });

    const wrap = h('div', { class: 'rte' }, bar, area);
    wrap.focusArea = () => area.focus();
    return wrap;
  };
})(window.Q);
