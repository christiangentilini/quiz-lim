/* Editor dei quiz (regia) */
Q.Editor = (function () {
  'use strict';
  const h = Q.h;
  let quiz = null;
  let saveTimer = null;
  let statusEl = null;
  const openCards = new Set();
  const previews = {};
  const revealPrev = {};

  const PLACEHOLDERS = {
    multiple: 'Es. Qual è la capitale d’Italia?',
    tf: 'Es. Il Sole è una stella.',
    open: 'Es. Spiega con parole tue che cos’è la fotosintesi.',
    cloze: 'Es. Il [[gatto]] dorme sul [[divano|sofà]].',
    dropdown: 'Es. Roma è la capitale [[d’Italia|della Francia|della Spagna]].',
    match: 'Es. Collega ogni stato alla sua capitale.',
  };
  const TEXT_LABEL = {
    multiple: 'Domanda', tf: 'Affermazione', open: 'Domanda',
    cloze: 'Testo con spazi da completare', dropdown: 'Testo con tendine', match: 'Consegna',
  };

  const iconBtn = (icon, title, fn, disabled) => h('button', { type: 'button', class: 'icon-btn', title, disabled: !!disabled, onclick: (e) => { e.stopPropagation(); fn(); } }, icon);
  const txt = (value, placeholder, set, cls) => h('input', { type: 'text', class: cls || '', value: value || '', placeholder, oninput: (e) => set(e.target.value) });

  /* ---------- Elenco quiz ---------- */
  async function renderList(el) {
    const quizzes = (await Q.store.all('quizzes')).sort((a, b) => b.updatedAt - a.updatedAt);
    Q.clear(el);
    el.append(h('div', { class: 'page-head' },
      h('h1', null, 'I tuoi quiz'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => importQuiz(el) }, '⬆ Importa quiz'),
        h('button', { class: 'btn', onclick: () => createDemo() }, '✨ Quiz di esempio'),
        h('button', { class: 'btn primary', onclick: createQuiz }, '+ Nuovo quiz'))));
    if (!quizzes.length) {
      el.append(h('div', { class: 'empty card' },
        h('h2', null, 'Nessun quiz ancora'),
        h('p', { class: 'muted' }, 'Crea il tuo primo quiz oppure genera un quiz di esempio con un tipo di domanda per ogni formato.'),
        h('div', { class: 'actions center' },
          h('button', { class: 'btn', onclick: createDemo }, '✨ Crea quiz di esempio'),
          h('button', { class: 'btn primary', onclick: createQuiz }, '+ Nuovo quiz'))));
      return;
    }
    el.append(h('div', { class: 'cards' }, quizzes.map((qz) => h('div', { class: 'card quiz-card' },
      h('h3', null, h('a', { href: '#quiz/' + qz.id }, qz.title || '(senza titolo)')),
      qz.description ? h('div', { class: 'small muted' }, qz.description) : null,
      h('div', { class: 'small muted' }, `${qz.questions.length} domande · modificato ${Q.fmtDate(qz.updatedAt)}`),
      h('div', { class: 'type-tags' }, Object.keys(Q.TYPES).map((t) => {
        const n = qz.questions.filter((q) => q.type === t).length;
        return n ? h('span', { class: 'tag', title: Q.TYPES[t] }, Q.TYPE_ICONS[t] + ' ' + n) : null;
      })),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn small', href: '#quiz/' + qz.id }, 'Modifica'),
        h('button', { class: 'btn small primary', onclick: () => useQuiz(qz.id) }, '▶ Usa in classe'),
        h('button', { class: 'btn small ghost', onclick: () => duplicate(qz, el) }, 'Duplica'),
        h('button', { class: 'btn small ghost', onclick: () => exportQuiz(qz) }, 'Esporta'),
        h('button', { class: 'btn small ghost danger', onclick: () => del(qz, el) }, 'Elimina'))))));
  }

  function useQuiz(id) { Q.Live.preselect(id); location.hash = '#live/new'; }

  async function createQuiz() {
    const qz = Q.newQuiz();
    await Q.store.put('quizzes', qz);
    location.hash = '#quiz/' + qz.id;
  }
  async function duplicate(qz, el) {
    const c = Q.clone(qz);
    c.id = Q.uid();
    c.title = qz.title + ' (copia)';
    c.questions.forEach((q) => { q.id = Q.uid(); });
    c.createdAt = Date.now();
    await Q.store.put('quizzes', c);
    renderList(el);
  }
  async function del(qz, el) {
    if (!(await Q.confirm({ title: `Eliminare il quiz «${qz.title}»?`, message: 'L’operazione non si può annullare.', ok: 'Elimina', danger: true }))) return;
    await Q.store.del('quizzes', qz.id);
    renderList(el);
  }
  function exportQuiz(qz) {
    Q.download(Q.slug(qz.title) + '.quiz.json', JSON.stringify({ app: 'quiz-lim', kind: 'quiz', version: 1, quiz: qz }, null, 1));
  }
  async function importQuiz(el) {
    const f = await Q.pickFile('.json,application/json');
    if (!f) return;
    try {
      const data = JSON.parse(await Q.readText(f));
      let list = [];
      if (data.kind === 'quiz' && data.quiz) list = [data.quiz];
      else if (data.kind === 'backup' && Array.isArray(data.quizzes)) list = data.quizzes;
      else if (Array.isArray(data.questions)) list = [data];
      if (!list.length) throw new Error('Nessun quiz nel file');
      for (const qz0 of list) {
        const qz = Object.assign(Q.newQuiz(), qz0, { id: Q.uid() });
        qz.questions = (qz.questions || []).map((q) => Object.assign({}, q, { id: Q.uid() }));
        await Q.store.put('quizzes', qz);
      }
      Q.toast(`Importati ${list.length} quiz`, 'ok');
      renderList(el);
    } catch (e) {
      Q.toast('Importazione non riuscita: ' + e.message, 'error');
    }
  }

  async function createDemo() {
    const qz = Q.newQuiz();
    qz.title = 'Quiz di esempio';
    qz.description = 'Un esempio per ogni tipo di domanda';
    qz.settings.timer = 30;
    const mk = (type, props) => Object.assign(Q.newQuestion(type), props);
    qz.questions = [
      mk('multiple', { text: 'Qual è il pianeta più grande del Sistema Solare?', options: [
        { text: 'Giove', correct: true }, { text: 'Saturno', correct: false }, { text: 'Terra', correct: false }, { text: 'Marte', correct: false }] }),
      mk('tf', { text: 'L’acqua bolle a 100 °C a livello del mare.', answer: true }),
      mk('cloze', { text: 'La [[fotosintesi]] avviene nelle [[foglie]] grazie alla [[clorofilla]].', bank: true, distractors: 'radici, ossigeno' }),
      mk('dropdown', { text: 'Dante Alighieri è nato a [[Firenze|Roma|Ravenna]] e ha scritto la [[Divina Commedia|Gerusalemme liberata|Eneide]].' }),
      mk('match', { text: 'Collega ogni stato alla sua capitale.', pairs: [
        { left: 'Francia', right: 'Parigi' }, { left: 'Spagna', right: 'Madrid' }, { left: 'Germania', right: 'Berlino' }, { left: 'Portogallo', right: 'Lisbona' }] }),
      mk('open', { text: 'Perché le foglie in autunno cambiano colore?', answer: 'Diminuisce la clorofilla e diventano visibili altri pigmenti (carotenoidi, antociani).' }),
      mk('multiple', { text: 'Quali di questi sono numeri primi?', options: [
        { text: '2', correct: true }, { text: '9', correct: false }, { text: '11', correct: true }, { text: '15', correct: false }] }),
    ];
    await Q.store.put('quizzes', qz);
    location.hash = '#quiz/' + qz.id;
  }

  /* ---------- Modifica quiz ---------- */
  async function renderEdit(el, id) {
    await flush();
    dirty = false;
    quiz = await Q.store.get('quizzes', id);
    if (!quiz) { location.hash = '#quiz'; return; }
    Q.clear(el);
    statusEl = h('span', { class: 'save-status' }, 'Salvato ✓');
    el.append(h('div', { class: 'page-head' },
      h('a', { href: '#quiz', class: 'btn ghost' }, '← Tutti i quiz'),
      statusEl,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => exportQuiz(quiz) }, 'Esporta'),
        h('button', { class: 'btn primary', onclick: () => { flush(); useQuiz(quiz.id); } }, '▶ Usa in classe'))));
    el.append(settingsCard());
    el.append(h('div', { class: 'qlist', id: 'qlist' }));
    el.append(addBar());
    drawList();
  }

  let dirty = false;
  function save() {
    dirty = true;
    if (statusEl) statusEl.textContent = 'Salvataggio…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  /* Salva solo se ci sono modifiche in sospeso (evita di sovrascrivere dati più recenti) */
  function flush() {
    clearTimeout(saveTimer);
    if (!quiz || !dirty) return Promise.resolve();
    dirty = false;
    const ref = quiz;
    return Q.store.put('quizzes', ref).then(() => { if (statusEl) statusEl.textContent = 'Salvato ✓'; });
  }

  function settingsCard() {
    const st = quiz.settings;
    const sc = st.scoring;
    const num = (label, val, set, step) => h('label', { class: 'pts-field' }, h('span', null, label),
      h('input', { type: 'number', step: step || 1, value: val, oninput: (e) => { const v = parseFloat(e.target.value); set(isNaN(v) ? 0 : v); save(); } }));
    const chk = (label, val, set) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!val, onchange: (e) => { set(e.target.checked); save(); } }), label);
    const pointsBox = h('div', { class: 'pts-box' + (sc.enabled ? '' : ' hidden') },
      h('div', { class: 'pts-grid' },
        num('✔ Corretta', sc.correct, (v) => { sc.correct = v; }, 0.25),
        num('✘ Errata', sc.wrong, (v) => { sc.wrong = v; }, 0.25),
        num('— Non risposta', sc.blank, (v) => { sc.blank = v; }, 0.25)),
      chk('Punteggio parziale (es. 3 spazi corretti su 4 = 75% dei punti)', sc.partial, (v) => { sc.partial = v; }));
    return h('div', { class: 'card' },
      h('input', { class: 'title-input', value: quiz.title, placeholder: 'Titolo del quiz', oninput: (e) => { quiz.title = e.target.value; save(); } }),
      h('input', { class: 'desc-input', value: quiz.description || '', placeholder: 'Descrizione (facoltativa: argomento, classe…)', oninput: (e) => { quiz.description = e.target.value; save(); } }),
      h('details', { class: 'settings' },
        h('summary', null, 'Impostazioni predefinite (modificabili all’avvio della sessione)'),
        h('div', { class: 'settings-cols' },
          h('div', { class: 'settings-col' },
            h('div', { class: 'flabel' }, 'Tempo e ordine'),
            h('label', { class: 'inline' }, '⏱ Timer per domanda ',
              h('input', { type: 'number', class: 'w-num', min: 0, step: 5, value: st.timer, oninput: (e) => { st.timer = Math.max(0, parseInt(e.target.value, 10) || 0); save(); } }),
              ' secondi (0 = nessuno)'),
            chk('Domande in ordine casuale', st.shuffleQuestions, (v) => { st.shuffleQuestions = v; }),
            chk('Risposte in ordine casuale', st.shuffleAnswers, (v) => { st.shuffleAnswers = v; }),
            h('div', { class: 'flabel', style: { marginTop: '10px' } }, 'Correzione'),
            chk('Correzione obbligatoria: «Successiva» su una domanda senza risposta prima mostra la soluzione', st.correctionStep, (v) => { st.correctionStep = v; })),
          h('div', { class: 'settings-col' },
            h('div', { class: 'flabel' }, 'Punteggio'),
            chk('Assegna punti', sc.enabled, (v) => { sc.enabled = v; pointsBox.classList.toggle('hidden', !v); }),
            pointsBox))));
  }

  function addBar() {
    return h('div', { class: 'add-bar' },
      h('span', { class: 'flabel' }, 'Aggiungi domanda'),
      Object.keys(Q.TYPES).map((t) => h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const q = Q.newQuestion(t);
          quiz.questions.push(q);
          openCards.add(q.id);
          save();
          drawList();
          setTimeout(() => {
            const c = document.querySelector(`[data-id="${q.id}"]`);
            if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const ta = c.querySelector('.rte-area'); if (ta) ta.focus(); }
          }, 50);
        },
      }, Q.TYPE_ICONS[t] + ' ' + Q.TYPES[t])));
  }

  function drawList() {
    const list = document.getElementById('qlist');
    if (!list) return;
    Q.clear(list);
    if (!quiz.questions.length) list.append(h('div', { class: 'empty small muted' }, 'Nessuna domanda. Aggiungine una con i pulsanti qui sotto.'));
    quiz.questions.forEach((q, i) => list.append(questionCard(q, i)));
  }

  function questionCard(q, i) {
    const isOpen = openCards.has(q.id);
    const card = h('div', { class: 'card qcard' + (isOpen ? ' open' : ''), 'data-id': q.id });
    const head = h('div', { class: 'qcard-head', onclick: () => { if (openCards.has(q.id)) openCards.delete(q.id); else openCards.add(q.id); rerenderCard(card, q); } },
      h('span', { class: 'qnum' }, i + 1),
      h('span', { class: 'qtype' }, Q.TYPE_ICONS[q.type] + ' ' + Q.TYPES[q.type]),
      h('span', { class: 'qprev' }),
      h('span', { class: 'qwarn' }),
      h('span', { class: 'qbtns' },
        iconBtn('↑', 'Sposta su', () => move(i, -1), i === 0),
        iconBtn('↓', 'Sposta giù', () => move(i, 1), i === quiz.questions.length - 1),
        iconBtn('⧉', 'Duplica', () => dup(i)),
        iconBtn('🗑', 'Elimina', () => remove(i)),
        h('span', { class: 'chev' }, isOpen ? '▴' : '▾')));
    card.append(head);
    updateHead(card, q);
    if (isOpen) {
      card.append(questionBody(q, card));
      refreshPreview(card, q);
    }
    return card;
  }

  function updateHead(card, q) {
    const p = card.querySelector('.qprev');
    const t = Q.plainText(q.text);
    p.textContent = t || '(senza testo)';
    p.classList.toggle('muted', !t);
    const w = Q.validate(q);
    const we = card.querySelector('.qwarn');
    we.textContent = w.length ? '⚠ ' + w.length : '';
    we.title = w.join('\n');
  }

  function rerenderCard(card, q) {
    const i = quiz.questions.indexOf(q);
    if (i < 0) return;
    card.replaceWith(questionCard(q, i));
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= quiz.questions.length) return;
    const a = quiz.questions;
    [a[i], a[j]] = [a[j], a[i]];
    save();
    drawList();
  }
  function dup(i) {
    const c = Q.clone(quiz.questions[i]);
    c.id = Q.uid();
    quiz.questions.splice(i + 1, 0, c);
    openCards.add(c.id);
    save();
    drawList();
  }
  async function remove(i) {
    const q = quiz.questions[i];
    if (Q.stripHtml(q.text).trim() && !(await Q.confirm({ title: 'Eliminare questa domanda?', message: Q.plainText(q.text).slice(0, 120), ok: 'Elimina', danger: true }))) return;
    quiz.questions.splice(i, 1);
    save();
    drawList();
  }

  function questionBody(q, card) {
    const changed = (structural) => {
      save();
      updateHead(card, q);
      if (structural) rerenderCard(card, q);
      else refreshPreview(card, q);
    };
    const fields = h('div', { class: 'qfields' });
    const textEd = Q.RichEditor({ value: q.text, rows: q.type === 'cloze' || q.type === 'dropdown' ? 3 : 2, placeholder: PLACEHOLDERS[q.type], onChange: (v) => { q.text = v; changed(); } });
    fields.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, TEXT_LABEL[q.type]), textEd));
    FORMS[q.type](fields, q, changed);
    const expl = Q.RichEditor({ value: q.explanation, rows: 2, placeholder: 'Facoltativa: compare sulla LIM insieme all’esito e alla soluzione', onChange: (v) => { q.explanation = v; changed(); } });
    fields.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, '📖 Spiegazione della correzione'), expl));
    fields.append(h('div', { class: 'qextra' },
      imageCtl(q, changed),
      h('label', { class: 'inline small' }, '⏱ Tempo per questa domanda ',
        h('input', { type: 'number', min: 0, step: 5, class: 'w-num', placeholder: 'pred.', value: q.time == null ? '' : q.time,
          oninput: (e) => { q.time = e.target.value === '' ? null : Math.max(0, +e.target.value || 0); save(); } }),
        ' s')));
    const preview = h('div', { class: 'qpreview' },
      h('div', { class: 'preview-head' },
        h('span', { class: 'flabel' }, 'Anteprima (come sulla LIM)'),
        h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: !!revealPrev[q.id], onchange: (e) => { revealPrev[q.id] = e.target.checked; refreshPreview(card, q); } }), 'Mostra correzione')),
      h('div', { class: 'qroot' }));
    return h('div', { class: 'qcard-body' }, fields, preview);
  }

  function refreshPreview(card, q) {
    const root = card.querySelector('.qpreview .qroot');
    if (!root) return;
    const sq = Q.sanitizeQuestion(q);
    const key = JSON.stringify(Object.assign({}, sq, { image: !!sq.image }));
    let pv = previews[q.id];
    if (!pv || pv.key !== key) pv = previews[q.id] = { key, view: Q.prepareView(sq, false), answer: Q.blankAnswer(sq) };
    Q.renderQuestion(root, sq, pv.view, {
      key: 'editor',
      answer: pv.answer,
      reveal: !!revealPrev[q.id],
      explain: !!revealPrev[q.id],
      onChange: (a, silent) => { pv.answer = a; if (!silent) refreshPreview(card, q); },
    });
  }

  function imageCtl(q, changed) {
    if (q.image) {
      return h('div', { class: 'img-ctl' },
        h('img', { src: q.image, alt: '' }),
        h('button', { type: 'button', class: 'btn small ghost danger', onclick: () => { q.image = null; changed(true); } }, 'Rimuovi immagine'));
    }
    return h('button', {
      type: 'button', class: 'btn small ghost',
      onclick: async () => {
        const f = await Q.pickFile('image/*');
        if (!f) return;
        try { q.image = await Q.resizeImage(f); changed(true); } catch (e) { Q.toast(e.message, 'error'); }
      },
    }, '🖼 Aggiungi immagine');
  }

  const help = (...kids) => h('div', { class: 'help' }, ...kids);

  const FORMS = {
    multiple(f, q, changed) {
      const box = h('div', { class: 'opt-edit' });
      const draw = () => {
        Q.clear(box);
        q.options.forEach((o, i) => {
          box.append(h('div', { class: 'opt-row' },
            h('label', { class: 'correct-toggle' + (o.correct ? ' on' : ''), title: 'Segna come corretta' },
              h('input', { type: 'checkbox', checked: !!o.correct, onchange: (e) => { o.correct = e.target.checked; draw(); changed(); } }),
              o.correct ? '✔ corretta' : 'errata'),
            h('span', { class: 'letter' }, 'ABCDEFGH'[i]),
            txt(o.text, 'Opzione ' + (i + 1), (v) => { o.text = v; changed(); }, 'grow'),
            q.options.length > 2 ? iconBtn('✕', 'Rimuovi opzione', () => { q.options.splice(i, 1); draw(); changed(); }) : null));
        });
        if (q.options.length < 8) box.append(h('button', { class: 'btn small ghost', type: 'button', onclick: () => { q.options.push({ text: '', correct: false }); draw(); changed(); const ins = box.querySelectorAll('input[type=text]'); ins[ins.length - 1].focus(); } }, '+ Opzione'));
      };
      draw();
      f.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Opzioni — spunta quelle corrette (anche più di una)'), box));
    },

    tf(f, q, changed) {
      const r = (val, label) => h('label', { class: 'radio-pill' + (!!q.answer === val ? ' on' : '') },
        h('input', { type: 'radio', name: 'tf-' + q.id, checked: !!q.answer === val, onchange: () => { q.answer = val; changed(true); } }), label);
      f.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Risposta corretta'), h('div', { class: 'row' }, r(true, 'Vero'), r(false, 'Falso'))));
    },

    open(f, q, changed) {
      const ta = h('textarea', { rows: 2, placeholder: 'Facoltativa: comparirà sulla LIM quando mostri la correzione', oninput: (e) => { q.answer = e.target.value; changed(); } });
      ta.value = q.answer || '';
      f.append(h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Risposta attesa / traccia di correzione'), ta));
      f.append(help('Le domande aperte si valutano a mano: dopo la risposta scegli tu Corretta, Errata o Vuota (e puoi assegnare punti personalizzati).'));
    },

    cloze(f, q, changed) {
      const n = Q.blanksOf(q.text).length;
      f.append(help('Racchiudi le parole da completare tra doppie quadre: ', h('code', null, 'Il [[gatto]] dorme'), '. Più risposte accettate: ', h('code', null, '[[divano|sofà]]'), '. Maiuscole e spazi non contano; non formattare il testo dentro le quadre.',
        h('span', { class: 'count' }, ` Spazi trovati: ${n}`)));
      f.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!q.bank, onchange: (e) => { q.bank = e.target.checked; changed(true); } }), 'Mostra la banca di parole (si toccano le parole invece di scriverle: consigliato alla LIM)'));
      if (q.bank) f.append(h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Parole distrattori (separate da virgola)'), txt(q.distractors, 'Es. cane, tavolo', (v) => { q.distractors = v; changed(); })));
    },

    dropdown(f, q) {
      const n = Q.blanksOf(q.text).length;
      f.append(help('Scrivi le opzioni tra doppie quadre separate da |, ', h('b', null, 'la prima è quella corretta'), ' (sulla LIM verranno mescolate): ', h('code', null, '[[corretta|sbagliata|sbagliata]]'),
        h('span', { class: 'count' }, ` Tendine trovate: ${n}`)));
    },

    match(f, q, changed) {
      const box = h('div', { class: 'pair-edit' });
      const draw = () => {
        Q.clear(box);
        q.pairs.forEach((p, i) => {
          box.append(h('div', { class: 'pair-row' },
            h('span', { class: 'letter' }, i + 1),
            txt(p.left, 'Elemento ' + (i + 1), (v) => { p.left = v; changed(); }, 'grow'),
            h('span', { class: 'arrow' }, '↔'),
            txt(p.right, 'Corrispondente', (v) => { p.right = v; changed(); }, 'grow'),
            q.pairs.length > 2 ? iconBtn('✕', 'Rimuovi coppia', () => { q.pairs.splice(i, 1); draw(); changed(); }) : null));
        });
        if (q.pairs.length < 10) box.append(h('button', { class: 'btn small ghost', type: 'button', onclick: () => { q.pairs.push({ left: '', right: '' }); draw(); changed(); } }, '+ Coppia'));
      };
      draw();
      f.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Coppie corrette (sulla LIM la colonna di destra viene mescolata)'), box));
    },
  };

  return { renderList, renderEdit, flush };
})();
