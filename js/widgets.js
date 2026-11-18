/* Rendering interattivo delle domande (usato da LIM, regia ed editor) e correzione automatica */
(function (Q) {
  'use strict';
  const h = Q.h;
  const LETTERS = 'ABCDEFGHIJKLMNOP';
  const COLORS = ['#2563eb', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#be123c'];
  const NS = 'http://www.w3.org/2000/svg';

  /* Pulisce opzioni/coppie vuote prima dell'uso in classe */
  Q.sanitizeQuestion = function (q0) {
    const q = Q.clone(q0);
    if (q.type === 'multiple') q.options = (q.options || []).filter((o) => String(o.text || '').trim());
    if (q.type === 'match') q.pairs = (q.pairs || []).filter((p) => String(p.left || '').trim() && String(p.right || '').trim());
    if (q.type === 'calc') { q.steps = (q.steps || []).filter((x) => String(x.label || '').trim()); q.board = true; }
    return q;
  };

  /* Ordine di presentazione (calcolato una volta per sessione, condiviso con la LIM) */
  Q.prepareView = function (q, shuffleAnswers) {
    switch (q.type) {
      case 'multiple': {
        const idx = q.options.map((_, i) => i);
        return { order: shuffleAnswers ? Q.shuffle(idx) : idx };
      }
      case 'match': {
        const idx = q.pairs.map((_, i) => i);
        let r = Q.shuffle(idx);
        for (let k = 0; k < 10 && idx.length > 1 && r.every((v, i) => v === i); k++) r = Q.shuffle(idx);
        return { right: r };
      }
      case 'dropdown':
        return { opts: Q.blanksOf(q.text).map((b) => Q.shuffle(b.alts)) };
      case 'cloze': {
        if (!q.bank) return {};
        const words = Q.blanksOf(q.text).map((b) => b.alts[0]).filter(Boolean);
        const extra = String(q.distractors || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        return { bank: Q.shuffle(words.concat(extra)) };
      }
    }
    return {};
  };

  Q.blankAnswer = function (q) {
    switch (q.type) {
      case 'multiple': return [];
      case 'cloze': case 'dropdown': return [];
      case 'match': return {};
      case 'calc': return [];
    }
    return null;
  };

  /* Correzione automatica: status = correct | wrong | blank | pending (aperte) */
  Q.evaluate = function (q, ans) {
    switch (q.type) {
      case 'multiple': {
        const sel = Array.isArray(ans) ? ans : [];
        if (!sel.length) return { status: 'blank', fraction: 0 };
        const corr = [];
        q.options.forEach((o, i) => { if (o.correct) corr.push(i); });
        const ok = sel.length === corr.length && corr.every((i) => sel.includes(i));
        if (ok) return { status: 'correct', fraction: 1 };
        const hits = sel.filter((i) => corr.includes(i)).length;
        const fraction = corr.length > 1 ? Math.max(0, (hits - (sel.length - hits)) / corr.length) : 0;
        return { status: 'wrong', fraction };
      }
      case 'tf':
        if (ans !== true && ans !== false) return { status: 'blank', fraction: 0 };
        return ans === !!q.answer ? { status: 'correct', fraction: 1 } : { status: 'wrong', fraction: 0 };
      case 'cloze':
      case 'dropdown': {
        const blanks = Q.blanksOf(q.text);
        const vals = Array.isArray(ans) ? ans : [];
        if (!blanks.length || !vals.some((v) => String(v || '').trim())) return { status: 'blank', fraction: 0, per: blanks.map(() => false) };
        const per = blanks.map((b, i) => {
          const v = Q.norm(vals[i]);
          if (!v) return false;
          return q.type === 'cloze' ? b.alts.some((a) => Q.norm(a) === v) : Q.norm(b.alts[0]) === v;
        });
        const n = per.filter(Boolean).length;
        return { status: n === blanks.length ? 'correct' : 'wrong', fraction: n / blanks.length, per };
      }
      case 'match': {
        const a = ans || {};
        const n = q.pairs.length;
        if (!Object.keys(a).length) return { status: 'blank', fraction: 0, per: q.pairs.map(() => false) };
        const per = q.pairs.map((_, i) => a[i] === i);
        const k = per.filter(Boolean).length;
        return { status: k === n ? 'correct' : 'wrong', fraction: n ? k / n : 0, per };
      }
    }
    if (q.type === 'calc') {
      return { status: 'pending', fraction: 0, per: (q.steps || []).map(() => false) };
    }
    return { status: 'pending', fraction: 0 };
  };

  /* ---------- Rendering ----------
     ctx = { key, answer, reveal, readOnly, onChange(answer, silent) }
     onChange con silent=true significa: non ridisegnare (es. digitazione in un campo) */
  Q.renderQuestion = function (root, q, view, ctx) {
    const uiKey = q.id + '|' + (ctx.key || '');
    if (!root._ui || root._ui.key !== uiKey) {
      if (root._ui && root._ui.ro) root._ui.ro.disconnect();
      root._ui = { key: uiKey };
    }
    const ui = root._ui;
    if (ui.ro) { ui.ro.disconnect(); ui.ro = null; }
    ui.collect = null;
    const c = Object.assign({}, ctx, { ui, rerender: () => Q.renderQuestion(root, q, view, ctx) });
    const locked = !!(ctx.reveal || ctx.readOnly || ctx.confirmed);

    Q.clear(root);
    if (root._baseClass == null) root._baseClass = root.className;
    root.className = root._baseClass + ' qw qw-' + q.type + (ctx.reveal ? ' revealed' : '') + (locked ? ' is-locked' : '');
    const inline = q.type === 'cloze' || q.type === 'dropdown';
    if (!inline) root.append(h('div', { class: 'qw-text rich', html: Q.richHtml(q.text) }));
    const body = h('div', { class: 'qw-body' });
    root.append(h('div', { class: 'qw-row' + (q.image ? ' has-img' : '') },
      q.image ? h('div', { class: 'qw-media' }, h('img', { src: q.image, alt: '' })) : null,
      body));
    const fn = RENDER[q.type];
    if (fn) fn(body, q, view || {}, c, locked);
    const needsButton = q.type === 'open' || q.type === 'calc' || (q.type === 'cloze' && !q.bank);
    if (ctx.onConfirm && !locked && needsButton) {
      root.append(h('div', { class: 'qw-confirm' }, h('button', {
        type: 'button', class: 'confirm-btn',
        onclick: () => ctx.onConfirm(ui.collect ? ui.collect() : undefined),
      }, q.type === 'open' || q.type === 'calc' ? '✔ Svolto' : '✔ Conferma')));
    }
    if (ctx.explain && Q.stripHtml(q.explanation).trim()) {
      root.append(h('div', { class: 'qw-expl' }, h('div', { class: 'qw-expl-label' }, '📖 Spiegazione'), h('div', { class: 'qw-expl-text rich', html: Q.richHtml(q.explanation) })));
    }
  };

  const RENDER = {
    /* Esercizio di calcolo: sulla LIM solo il testo (si svolge alla lavagna); la soluzione compare con la correzione */
    calc(body, q, view, c) {
      if (!c.reveal) return;
      const steps = q.steps || [];
      body.append(h('div', { class: 'calc-solution' }, h('div', { class: 'ma-label' }, 'Soluzione'),
        h('ol', null, steps.map((x, i) => {
          const mark = c.stepMarks ? c.stepMarks[i] : null;
          return h('li', { class: mark == null ? '' : mark ? 'ok' : 'ko' },
            h('span', { class: 'cs-label' }, x.label),
            x.value ? h('span', { class: 'cs-val' }, ' = ' + x.value + (x.unit ? ' ' + x.unit : '')) : null);
        }))));
    },

    multiple(body, q, view, c, locked) {
      const order = view.order || q.options.map((_, i) => i);
      const nCorrect = q.options.filter((o) => o.correct).length;
      const multi = nCorrect > 1;
      const sel = new Set(Array.isArray(c.answer) ? c.answer : []);
      const oneCol = q.options.some((o) => String(o.text).length > 55) || order.length === 3;
      const grid = h('div', { class: 'opts' + (oneCol ? ' one-col' : '') });
      order.forEach((oi, pos) => {
        const o = q.options[oi];
        if (!o) return;
        let cls = 'opt';
        if (sel.has(oi)) cls += ' sel';
        if (c.reveal) cls += o.correct ? ' ok' : sel.has(oi) ? ' ko' : ' dim';
        if (locked) cls += ' locked';
        grid.append(h('button', {
          type: 'button', class: cls,
          onclick: () => {
            if (locked) return;
            let next;
            if (multi) next = sel.has(oi) ? [...sel].filter((x) => x !== oi) : [...sel, oi];
            else next = sel.has(oi) ? [] : [oi];
            // la risposta si chiude da sola quando le scelte sono tante quante le risposte corrette
            if (c.onConfirm && next.length === nCorrect) c.onConfirm(next);
            else if (c.onChange) c.onChange(next);
          },
        }, h('span', { class: 'letter' }, LETTERS[pos]), h('span', { class: 'otext' }, o.text)));
      });
      body.append(grid);
      if (multi && !c.reveal) body.append(h('div', { class: 'qw-hint multi-hint' }, `Seleziona ${nCorrect} risposte`));
    },

    tf(body, q, view, c, locked) {
      const a = c.answer;
      const mk = (val, label) => {
        let cls = 'opt tfb';
        if (a === val) cls += ' sel';
        const isRight = !!q.answer === val;
        if (c.reveal) cls += isRight ? ' ok' : a === val ? ' ko' : ' dim';
        if (locked) cls += ' locked';
        let mark = null;
        if (c.reveal && isRight) mark = h('span', { class: 'tf-mark ok' }, '✔ corretta');
        else if (c.reveal && a === val) mark = h('span', { class: 'tf-mark ko' }, '✘ scelta');
        return h('button', { type: 'button', class: cls, onclick: () => {
          if (locked) return;
          if (c.onConfirm) c.onConfirm(val); // vero/falso: la scelta chiude subito la risposta
          else if (c.onChange) c.onChange(a === val ? null : val);
        } }, h('span', null, label), mark);
      };
      body.append(h('div', { class: 'tf' }, mk(true, 'VERO'), mk(false, 'FALSO')));
      if (c.reveal) {
        body.append(h('div', { class: 'tf-solution' }, 'Risposta corretta: ', h('strong', null, q.answer ? 'VERO' : 'FALSO')));
      }
    },

    open(body, q, view, c) {
      if (c.reveal && String(q.answer || '').trim()) {
        body.append(h('div', { class: 'model-answer' }, h('div', { class: 'ma-label' }, 'Risposta attesa'), h('div', { class: 'ma-text' }, q.answer)));
      } else if (!c.reveal) {
        body.append(h('div', { class: 'open-note' }, 'Rispondi a voce'));
      }
    },

    cloze(body, q, view, c, locked) {
      const blanks = Q.blanksOf(q.text);
      const src = Array.isArray(c.answer) ? c.answer : [];
      const vals = blanks.map((_, i) => src[i] || '');
      const ev = c.reveal ? Q.evaluate(q, vals) : null;
      const ui = c.ui;
      const useBank = !!(q.bank && view.bank);
      const para = h('div', { class: 'qw-text cloze-text rich' });
      Q.fillBlanks(para, q.text, (i, alts) => {
        const out = [];
        const s = { alts };
        const v = vals[i];
        const state = ev ? (ev.per[i] ? ' ok' : ' ko') : '';
        if (useBank) {
          out.push(h('button', {
            type: 'button',
            class: 'slot' + (v ? ' filled' : '') + (!locked && ui.active === i ? ' active' : '') + state + (locked ? ' locked' : ''),
            onclick: () => {
              if (locked) return;
              if (v) { vals[i] = ''; ui.active = i; c.onChange && c.onChange(vals.slice()); }
              else { ui.active = ui.active === i ? null : i; c.rerender(); }
            },
          }, v || ' '));
        } else {
          const longest = Math.max(...s.alts.map((a) => a.length), 3);
          out.push(h('input', {
            type: 'text', class: 'blank-in' + state, value: v,
            size: Q.clamp(longest + 2, 4, 30), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
            readonly: locked, 'data-blank': i, enterkeyhint: 'next',
            oninput: (e) => { vals[i] = e.target.value; c.onChange && c.onChange(vals.slice(), true); },
            onkeydown: (e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const all = [...para.querySelectorAll('input.blank-in')];
              const k = all.indexOf(e.target);
              if (k < all.length - 1) all[k + 1].focus();
              else { const btn = para.closest('.qw') && para.closest('.qw').querySelector('.confirm-btn'); if (btn) btn.click(); }
            },
          }));
        }
        if (ev && !ev.per[i]) out.push(h('span', { class: 'fix' }, s.alts.join(' / ')));
        return out;
      });
      body.append(para);
      if (!useBank) {
        ui.collect = () => {
          const out = vals.slice();
          para.querySelectorAll('input.blank-in').forEach((inp) => { out[+inp.dataset.blank] = inp.value; });
          return out;
        };
      }
      if (useBank && !c.reveal) {
        const used = {};
        vals.forEach((v) => { if (v) used[Q.norm(v)] = (used[Q.norm(v)] || 0) + 1; });
        const bank = h('div', { class: 'bank' });
        view.bank.forEach((w) => {
          const k = Q.norm(w);
          let isUsed = false;
          if (used[k] > 0) { used[k]--; isUsed = true; }
          bank.append(h('button', {
            type: 'button', class: 'chip' + (isUsed ? ' used' : '') + (locked ? ' locked' : ''), disabled: isUsed,
            onclick: () => {
              if (locked) return;
              let tgt = ui.active;
              if (tgt == null || vals[tgt]) tgt = vals.findIndex((x) => !x);
              if (tgt == null || tgt < 0) return;
              vals[tgt] = w;
              const nextEmpty = vals.findIndex((x) => !x);
              ui.active = nextEmpty >= 0 ? nextEmpty : null;
              if (nextEmpty < 0 && c.onConfirm) c.onConfirm(vals.slice()); // tutti gli spazi pieni: risposta chiusa
              else if (c.onChange) c.onChange(vals.slice());
            },
          }, w));
        });
        body.append(bank);
      }
    },

    dropdown(body, q, view, c, locked) {
      const blanks = Q.blanksOf(q.text);
      const src = Array.isArray(c.answer) ? c.answer : [];
      const vals = blanks.map((_, i) => src[i] || '');
      const ev = c.reveal ? Q.evaluate(q, vals) : null;
      const para = h('div', { class: 'qw-text cloze-text rich' });
      Q.fillBlanks(para, q.text, (i, alts) => {
        const s = { alts };
        if (ev) {
          const out = [h('span', { class: 'dd-show ' + (ev.per[i] ? 'ok' : 'ko') }, vals[i] || '—')];
          if (!ev.per[i]) out.push(h('span', { class: 'fix' }, s.alts[0]));
          return out;
        }
        const opts = (view.opts && view.opts[i]) || s.alts;
        const sel = h('select', {
          class: 'dd' + (vals[i] ? ' filled' : ''), disabled: locked,
          onchange: (e) => {
            vals[i] = e.target.value;
            if (c.onConfirm && vals.every((x) => x)) c.onConfirm(vals.slice()); // tutte scelte: risposta chiusa
            else if (c.onChange) c.onChange(vals.slice());
          },
        }, h('option', { value: '' }, '…scegli…'), opts.map((o) => h('option', { value: o }, o)));
        sel.value = vals[i];
        return [sel];
      });
      body.append(para);
    },

    match(body, q, view, c, locked) {
      const ans = Object.assign({}, c.answer || {});
      const ev = c.reveal ? Q.evaluate(q, ans) : null;
      const ui = c.ui;
      const leftOf = {};
      Object.entries(ans).forEach(([l, r]) => { leftOf[r] = +l; });
      const right = view.right || q.pairs.map((_, i) => i);
      const wrap = h('div', { class: 'match' });
      const L = h('div', { class: 'mcol left' });
      const R = h('div', { class: 'mcol right' });
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'mlines');
      const sel = ui.sel;

      function pick(side, i) {
        if (locked) return;
        if (sel && sel.side !== side) {
          const l = side === 'l' ? i : sel.i;
          const r = side === 'r' ? i : sel.i;
          for (const k of Object.keys(ans)) if (ans[k] === r) delete ans[k];
          ans[l] = r;
          ui.sel = null;
          if (c.onConfirm && Object.keys(ans).length === q.pairs.length) c.onConfirm(ans); // tutto collegato: risposta chiusa
          else if (c.onChange) c.onChange(ans);
          return;
        }
        if (sel && sel.side === side && sel.i === i) { ui.sel = null; c.rerender(); return; }
        if (side === 'l' && ans[i] != null) { delete ans[i]; ui.sel = { side, i }; c.onChange && c.onChange(ans); return; }
        if (side === 'r' && leftOf[i] != null) { delete ans[leftOf[i]]; ui.sel = { side, i }; c.onChange && c.onChange(ans); return; }
        ui.sel = { side, i };
        c.rerender();
      }

      q.pairs.forEach((p, i) => {
        const paired = ans[i] != null;
        let cls = 'mitem';
        if (sel && sel.side === 'l' && sel.i === i) cls += ' sel';
        if (paired && !ev) cls += ' paired';
        if (ev) cls += ev.per[i] ? ' ok' : ' ko';
        if (locked) cls += ' locked';
        L.append(h('button', { type: 'button', class: cls, 'data-l': i, style: paired ? { '--pc': COLORS[i % COLORS.length] } : null, onclick: () => pick('l', i) },
          h('span', { class: 'mlabel' }, String(i + 1)), h('span', { class: 'mtext' }, p.left)));
      });
      right.forEach((ri, pos) => {
        const l = leftOf[ri];
        const paired = l != null;
        let cls = 'mitem';
        if (sel && sel.side === 'r' && sel.i === ri) cls += ' sel';
        if (paired && !ev) cls += ' paired';
        if (ev && paired) cls += ev.per[l] ? ' ok' : ' ko';
        if (locked) cls += ' locked';
        R.append(h('button', { type: 'button', class: cls, 'data-r': ri, style: paired ? { '--pc': COLORS[l % COLORS.length] } : null, onclick: () => pick('r', ri) },
          h('span', { class: 'mlabel' }, LETTERS[pos]), h('span', { class: 'mtext' }, q.pairs[ri].right)));
      });
      wrap.append(L, svg, R);
      body.append(wrap);
      if (!c.reveal && !locked) body.append(h('div', { class: 'qw-hint' }, 'Tocca un elemento a sinistra e poi quello corrispondente a destra'));

      const drawLines = () => {
        if (!wrap.isConnected) return;
        const wr = wrap.getBoundingClientRect();
        if (!wr.width) return;
        svg.setAttribute('width', wr.width);
        svg.setAttribute('height', wr.height);
        svg.setAttribute('viewBox', `0 0 ${wr.width} ${wr.height}`);
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const sw = parseFloat(getComputedStyle(wrap).fontSize) * 0.16;
        const pt = (el, side) => {
          const r = el.getBoundingClientRect();
          return [(side === 'r' ? r.right : r.left) - wr.left, r.top + r.height / 2 - wr.top];
        };
        const line = (a, b, color, dashed) => {
          const ln = document.createElementNS(NS, 'line');
          ln.setAttribute('x1', a[0]); ln.setAttribute('y1', a[1]);
          ln.setAttribute('x2', b[0]); ln.setAttribute('y2', b[1]);
          ln.style.stroke = color;
          ln.style.strokeWidth = sw;
          ln.style.strokeLinecap = 'round';
          if (dashed) ln.style.strokeDasharray = `${sw * 2} ${sw * 2}`;
          svg.append(ln);
          for (const p of [a, b]) {
            const ci = document.createElementNS(NS, 'circle');
            ci.setAttribute('cx', p[0]); ci.setAttribute('cy', p[1]); ci.setAttribute('r', sw * 1.4);
            ci.style.fill = color;
            svg.append(ci);
          }
        };
        Object.entries(ans).forEach(([l, r]) => {
          const le = L.querySelector(`[data-l="${l}"]`), re = R.querySelector(`[data-r="${r}"]`);
          if (!le || !re) return;
          const color = ev ? (ev.per[l] ? 'var(--ok)' : 'var(--ko)') : COLORS[l % COLORS.length];
          line(pt(le, 'r'), pt(re, 'l'), color, false);
        });
        if (ev) q.pairs.forEach((_, i) => {
          if (ev.per[i]) return;
          const le = L.querySelector(`[data-l="${i}"]`), re = R.querySelector(`[data-r="${i}"]`);
          if (le && re) line(pt(le, 'r'), pt(re, 'l'), 'var(--ok)', true);
        });
      };
      requestAnimationFrame(drawLines);
      if (window.ResizeObserver) {
        ui.ro = new ResizeObserver(() => requestAnimationFrame(drawLines));
        ui.ro.observe(wrap);
      }
    },
  };
})(window.Q);
