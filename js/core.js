/* Quiz LIM — funzioni di base condivise tra regia e schermo LIM */
window.Q = window.Q || {};
(function (Q) {
  'use strict';

  Q.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  Q.clone = (o) => JSON.parse(JSON.stringify(o));
  Q.shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  Q.norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’`´]/g, "'");
  Q.round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  Q.fmtNum = (n) => String(Q.round2(n)).replace('.', ',');
  Q.fmtPts = (n) => (n > 0 ? '+' : '') + Q.fmtNum(n);
  Q.fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '');
  Q.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  Q.debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  /* ---------- Mini helper DOM ---------- */
  function appendKids(el, kids) {
    for (const c of kids) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) appendKids(el, c);
      else el.append(c instanceof Node ? c : String(c));
    }
  }
  Q.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText = v;
          else for (const sk in v) {
            if (v[sk] == null) continue;
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
            else el.style[sk] = v[sk];
          }
        } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value' || k === 'checked') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    appendKids(el, kids);
    return el;
  };
  Q.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  Q.setVal = (el, v) => { el.value = v; return el; };

  /* ---------- Testo con spazi [[...]] ---------- */
  Q.parseBlanks = function (text) {
    const out = [];
    const re = /\[\[(.*?)\]\]/g;
    const t = String(text || '');
    let last = 0, m, i = 0;
    while ((m = re.exec(t))) {
      if (m.index > last) out.push({ text: t.slice(last, m.index) });
      out.push({ blank: true, i: i++, raw: m[1], alts: m[1].split('|').map((s) => s.trim()).filter(Boolean) });
      last = re.lastIndex;
    }
    if (last < t.length) out.push({ text: t.slice(last) });
    return out;
  };
  /* ---------- Testo formattato (HTML sicuro) ---------- */
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'PRE', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
  const LOOKS_HTML = /<\/?(b|strong|i|em|u|s|strike|del|code|pre|br|p|div|span|ul|ol|li)\b[^>]*>/i;
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const parseDoc = (html) => new DOMParser().parseFromString('<!doctype html><body>' + html + '</body>', 'text/html');

  /* Tiene solo grassetto, corsivo, sottolineato, barrato, codice, a capo e liste; toglie tutti gli attributi */
  Q.sanitizeHtml = function (html) {
    const doc = parseDoc(String(html || ''));
    const walk = (node) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 3) continue;
        if (ch.nodeType !== 1) { ch.remove(); continue; }
        if (DROP.has(ch.tagName)) { ch.remove(); continue; }
        walk(ch);
        if (!ALLOWED.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); continue; }
        for (const a of [...ch.attributes]) ch.removeAttribute(a.name);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  };
  /* HTML pronto da mostrare: i testi vecchi (semplici) vengono convertiti mantenendo gli a capo */
  Q.richHtml = function (s) {
    const t = String(s || '');
    if (!t) return '';
    if (LOOKS_HTML.test(t)) return Q.sanitizeHtml(t);
    return escHtml(t).replace(/\n/g, '<br>');
  };
  const plainCache = new Map();
  Q.stripHtml = function (s) {
    const t = String(s || '');
    if (!/[<&]/.test(t)) return t;
    if (plainCache.has(t)) return plainCache.get(t);
    const prepared = t.replace(/<br\s*\/?>/gi, '\n').replace(/<(p|div|li|pre)\b/gi, '\n$&').replace(/<\/(p|div|li|pre)>/gi, '\n$&');
    const out = parseDoc(prepared).body.textContent;
    if (plainCache.size > 300) plainCache.clear();
    plainCache.set(t, out);
    return out;
  };
  /* Inserisce gli spazi [[...]] dentro il testo formattato: makeBlank(i, alternative) restituisce i nodi da mettere al posto del segnaposto */
  Q.fillBlanks = function (container, text, makeBlank) {
    container.innerHTML = Q.richHtml(text);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let i = 0;
    for (const node of nodes) {
      const t = node.nodeValue;
      if (t.indexOf('[[') < 0) continue;
      const re = /\[\[(.*?)\]\]/g;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(t))) {
        if (m.index > last) frag.append(t.slice(last, m.index));
        const alts = m[1].split('|').map((x) => x.trim()).filter(Boolean);
        for (const n of [].concat(makeBlank(i++, alts))) if (n) frag.append(n);
        last = re.lastIndex;
      }
      if (last < t.length) frag.append(t.slice(last));
      node.replaceWith(frag);
    }
  };

  Q.blanksOf = (text) => Q.parseBlanks(Q.stripHtml(text)).filter((s) => s.blank);
  Q.plainText = (text) => Q.stripHtml(text).replace(/\[\[(.*?)\]\]/g, '___').replace(/\s+/g, ' ').trim();

  /* ---------- Tipi di domanda ---------- */
  Q.TYPES = {
    multiple: 'Scelta multipla',
    tf: 'Vero o falso',
    open: 'Domanda aperta',
    cloze: 'Completamento',
    dropdown: 'Scelta da tendina',
    match: 'Collegamento',
    calc: 'Esercizio di calcolo',
  };
  Q.TYPE_ICONS = { multiple: '☑', tf: '⚖', open: '💬', cloze: '✎', dropdown: '▾', match: '⇄', calc: '🧮' };

  Q.newQuestion = function (type) {
    const base = { id: Q.uid(), type, text: '', image: null, time: null };
    switch (type) {
      case 'multiple':
        return { ...base, options: [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }] };
      case 'tf': return { ...base, answer: true };
      case 'open': return { ...base, answer: '' };
      case 'cloze': return { ...base, bank: true, distractors: '' };
      case 'dropdown': return { ...base };
      case 'match': return { ...base, pairs: [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }] };
      case 'calc': return { ...base, board: true, stepPoints: 1, steps: [{ label: '', value: '', unit: '' }, { label: '', value: '', unit: '' }, { label: '', value: '', unit: '' }] };
    }
    return base;
  };

  Q.newQuiz = () => ({
    id: Q.uid(),
    title: 'Nuovo quiz',
    description: '',
    settings: {
      timer: 0,
      shuffleQuestions: false,
      shuffleAnswers: true,
      correctionStep: false,
      scoring: { enabled: true, correct: 1, wrong: 0, blank: 0, partial: false },
    },
    questions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  Q.validate = function (q) {
    const w = [];
    if (!Q.stripHtml(q.text).trim()) w.push('Testo mancante');
    switch (q.type) {
      case 'multiple': {
        const filled = (q.options || []).filter((o) => String(o.text || '').trim());
        if (filled.length < 2) w.push('Servono almeno 2 opzioni');
        if (!filled.some((o) => o.correct)) w.push('Nessuna opzione corretta');
        break;
      }
      case 'cloze':
        if (!Q.blanksOf(q.text).length) w.push('Nessuno spazio [[...]] da completare');
        break;
      case 'dropdown': {
        const b = Q.blanksOf(q.text);
        if (!b.length) w.push('Nessuna tendina [[...]]');
        else if (b.some((x) => x.alts.length < 2)) w.push('Ogni tendina richiede almeno 2 opzioni separate da |');
        break;
      }
      case 'calc':
        if (!(q.steps || []).some((x) => String(x.label || '').trim())) w.push('Aggiungi almeno un passaggio della soluzione');
        break;
      case 'match':
        if ((q.pairs || []).filter((p) => String(p.left || '').trim() && String(p.right || '').trim()).length < 2) w.push('Servono almeno 2 coppie complete');
        break;
    }
    return w;
  };

  Q.solutionText = function (q) {
    switch (q.type) {
      case 'multiple': return (q.options || []).filter((o) => o.correct).map((o) => '• ' + o.text).join('\n') || '—';
      case 'tf': return q.answer ? 'VERO' : 'FALSO';
      case 'open': return String(q.answer || '').trim() || '(nessuna risposta attesa indicata)';
      case 'cloze': return Q.blanksOf(q.text).map((b, i) => `${i + 1}) ${b.alts.join(' / ')}`).join('\n');
      case 'dropdown': return Q.blanksOf(q.text).map((b, i) => `${i + 1}) ${b.alts[0] || ''}`).join('\n');
      case 'match': return (q.pairs || []).map((p) => `${p.left} → ${p.right}`).join('\n');
      case 'calc': return (q.steps || []).map((x, i) => `${i + 1}) ${x.label}: ${x.value} ${x.unit || ''}`.trim()).join('\n');
    }
    return '';
  };

  Q.answerText = function (q, a) {
    switch (q.type) {
      case 'multiple': return (a || []).map((i) => q.options[i] && q.options[i].text).filter(Boolean).join(' | ');
      case 'tf': return a === true ? 'Vero' : a === false ? 'Falso' : '';
      case 'cloze':
      case 'dropdown': return Q.blanksOf(q.text).map((_, i) => (a && a[i]) || '_').join(' | ');
      case 'match': return Object.entries(a || {}).map(([l, r]) => `${(q.pairs[l] || {}).left} → ${(q.pairs[r] || {}).right}`).join(' | ');
      case 'calc': return (q.steps || []).map((x, i) => (a && a[i]) || '_').join(' | ');
    }
    return '';
  };

  Q.STATUS = {
    correct: { label: 'Corretta', icon: '✔' },
    wrong: { label: 'Errata', icon: '✘' },
    blank: { label: 'Non risposta', icon: '—' },
    pending: { label: 'Da valutare', icon: '?' },
  };

  /* ---------- Numeri scritti all'italiana: 13.230.000 · 26,46 · 1 000 · 26.46 ---------- */
  Q.parseNum = function (v) {
    let t = String(v ?? '').trim().replace(/\s/g, '').replace(/[^\d.,\-+eE]/g, '');
    if (!t || !/\d/.test(t)) return null;
    if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  /* uguale entro la tolleranza (percentuale) */
  Q.numClose = (a, b, tolPct) => {
    if (a == null || b == null) return false;
    if (b === 0) return Math.abs(a) < 1e-9;
    return Math.abs(a - b) <= Math.abs(b) * (Number(tolPct) || 0) / 100 + 1e-9;
  };

  /* ---------- Codice del quiz e link ---------- */
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // niente 0/O, 1/I/L
  Q.newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  Q.normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  Q.fmtCode = (c) => String(c || '').slice(0, 3) + ' ' + String(c || '').slice(3);
  /* Cartella in cui si trova l'app (funziona anche da /CODICE/... dopo il reindirizzamento) */
  Q.appBase = () => location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  Q.links = (code, base = Q.appBase()) => ({
    quiz: base + code,
    live: base + code + '/live',
    remote: base + code + '/remote',
    liveEntry: base + 'live',
    remoteEntry: base + 'remote',
  });
  Q.isLocalHost = () => location.protocol === 'file:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);

  Q.MODES = {
    guided: 'Lezione guidata',
    students: 'Interrogazione a sorteggio',
    teams: 'Sfida a squadre',
  };

  Q.TEAM_PRESETS = [
    { name: 'Rossi', color: '#dc2626' }, { name: 'Blu', color: '#2563eb' },
    { name: 'Verdi', color: '#16a34a' }, { name: 'Gialli', color: '#ca8a04' },
    { name: 'Viola', color: '#7c3aed' }, { name: 'Arancioni', color: '#ea580c' },
    { name: 'Azzurri', color: '#0891b2' }, { name: 'Rosa', color: '#db2777' },
  ];

  /* Calcolo punti di una risposta */
  Q.pointsFor = function (status, fraction, sc) {
    if (!sc || !sc.enabled) return 0;
    if (status === 'correct') return Number(sc.correct) || 0;
    if (status === 'blank') return Number(sc.blank) || 0;
    if (status === 'wrong') {
      if (sc.partial && fraction > 0) return Q.round2((Number(sc.correct) || 0) * fraction);
      return Number(sc.wrong) || 0;
    }
    return 0;
  };

  /* Classifica: s = stato sessione (participants, teams, responses, mode, settings) */
  Q.standings = function (s) {
    const ents = s.mode === 'teams' ? s.teams || [] : s.participants || [];
    const map = new Map(ents.map((e) => [e.id, { id: e.id, name: e.name, color: e.color, points: 0, correct: 0, wrong: 0, blank: 0, answered: 0 }]));
    for (const k in s.responses || {}) {
      const r = s.responses[k];
      if (!r || !(r.revealed || r.confirmed) || !['correct', 'wrong', 'blank'].includes(r.status)) continue;
      const e = map.get(s.mode === 'teams' ? r.tid : r.pid);
      if (!e) continue;
      e.answered++;
      e[r.status]++;
      e.points += Number(r.points) || 0;
    }
    const scoring = s.settings && s.settings.scoring && s.settings.scoring.enabled;
    const arr = [...map.values()].map((e) => ({ ...e, points: Q.round2(e.points) }));
    arr.sort((a, b) => scoring
      ? b.points - a.points || b.correct - a.correct || a.name.localeCompare(b.name)
      : b.correct - a.correct || a.wrong - b.wrong || a.name.localeCompare(b.name));
    let rank = 0, prev = null;
    arr.forEach((e, i) => {
      const key = scoring ? e.points + '/' + e.correct : e.correct + '/' + e.wrong;
      if (key !== prev) { rank = i + 1; prev = key; }
      e.rank = rank;
    });
    return arr;
  };

  /* ---------- Utility file ---------- */
  Q.download = function (name, content, mime = 'application/json') {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  Q.pickFile = (accept) => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept || '';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
  Q.readText = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
  Q.resizeImage = (file, max = 1400) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let data = c.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
    img.src = url;
  });
  Q.slug = (s) => String(s || 'quiz').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
  Q.csv = (rows) => '﻿' + rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');

  /* ---------- Finestra di conferma con stile (al posto di confirm()) ---------- */
  Q.confirm = function ({ title, message, ok = 'Conferma', cancel = 'Annulla', danger = false, icon } = {}) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const close = (v) => {
        back.classList.add('closing');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => { back.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }, 160);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      };
      const okBtn = Q.h('button', { type: 'button', class: 'btn ' + (danger ? 'danger-solid' : 'primary'), onclick: () => close(true) }, ok);
      const back = Q.h('div', { class: 'dlg-back', onmousedown: (e) => { if (e.target === back) close(false); } },
        Q.h('div', { class: 'dlg' + (danger ? ' danger' : ''), role: 'dialog', 'aria-modal': 'true' },
          Q.h('div', { class: 'dlg-icon' }, icon || (danger ? '⚠' : '?')),
          Q.h('div', { class: 'dlg-body' },
            Q.h('h3', null, title || 'Confermi?'),
            message ? Q.h('p', null, message) : null),
          Q.h('div', { class: 'dlg-actions' },
            Q.h('button', { type: 'button', class: 'btn ghost', onclick: () => close(false) }, cancel),
            okBtn)));
      document.body.append(back);
      document.addEventListener('keydown', onKey, true);
      okBtn.focus();
    });
  };

  /* Finestra generica con contenuto (es. «Collega dispositivi») */
  Q.modal = function ({ title, content, onClose }) {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => {
      back.classList.add('closing');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => back.remove(), 160);
      if (onClose) onClose();
    };
    const back = Q.h('div', { class: 'dlg-back', onmousedown: (e) => { if (e.target === back) close(); } },
      Q.h('div', { class: 'dlg wide', role: 'dialog', 'aria-modal': 'true' },
        Q.h('div', { class: 'dlg-head' }, Q.h('h3', null, title), Q.h('button', { type: 'button', class: 'icon-btn', title: 'Chiudi', onclick: close }, '✕')),
        content));
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    return close;
  };

  /* ---------- Notifiche ---------- */
  Q.toast = function (msg, kind = 'info') {
    let box = document.getElementById('toast');
    if (!box) { box = Q.h('div', { id: 'toast' }); document.body.append(box); }
    const t = Q.h('div', { class: 'toast ' + kind }, msg);
    box.append(t);
    setTimeout(() => t.classList.add('hide'), 2600);
    setTimeout(() => t.remove(), 3100);
  };

  /* ---------- Suoni (WebAudio, nessun file esterno) ---------- */
  let actx = null;
  Q.muted = false;
  Q.unlockAudio = () => {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* niente audio */ }
  };
  Q.sound = function (kind) {
    if (Q.muted) return;
    try {
      Q.unlockAudio();
      if (!actx) return;
      const seqs = {
        correct: [[660, 0.12], [880, 0.22]],
        wrong: [[220, 0.18], [180, 0.3]],
        timeout: [[880, 0.12], [0, 0.08], [880, 0.12], [0, 0.08], [880, 0.35]],
        tick: [[1400, 0.025]],
        draw: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]],
      };
      const seq = seqs[kind];
      if (!seq) return;
      let t = actx.currentTime;
      for (const [f, d] of seq) {
        if (f) {
          const o = actx.createOscillator(), g = actx.createGain();
          o.type = kind === 'wrong' ? 'triangle' : 'sine';
          o.frequency.value = f;
          const vol = kind === 'tick' ? 0.08 : 0.25;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          o.connect(g).connect(actx.destination);
          o.start(t);
          o.stop(t + d + 0.02);
        }
        t += d;
      }
    } catch (e) { /* niente audio */ }
  };
})(window.Q);
