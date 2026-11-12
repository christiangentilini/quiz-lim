/* Telecomando (telefono o tablet): comanda la sessione in corso in regia */
(function () {
  'use strict';
  const h = Q.h;
  const app = document.getElementById('app');
  let sess = null, st = null, status = null;
  let showSolution = false;

  const sync = Q.Sync('remote', onMsg);
  const net = Q.NetJoin(sync, 'remote', (s) => { status = s; render(); });
  const params = new URLSearchParams(location.search);
  const c0 = Q.normCode(params.get('code'));
  if (c0.length === 6) net.connect(c0);

  function onMsg(m) {
    if (net.code && ['session', 'state', 'idle'].includes(m.t)) {
      const c = m.t === 'session' ? m.session.code : m.t === 'state' ? m.state.code : m.code;
      if (c !== net.code) return;
    }
    if (m.t === 'session') { sess = m.session; render(); }
    else if (m.t === 'state') {
      st = m.state;
      if (!sess || sess.id !== st.id) { sync.send('hello', { role: 'remote' }); return; }
      render();
    } else if (m.t === 'idle') { sess = null; st = null; render(); }
  }

  const cmd = (c, value) => {
    if (navigator.vibrate) navigator.vibrate(12);
    sync.send('cmd', { cmd: c, value, pos: st ? st.idx : null });
  };
  const nameOf = (id) => ((st.participants || []).find((p) => p.id === id) || {}).name || '';
  const teamOf = (id) => (st.teams || []).find((t) => t.id === id);
  const btn = (label, onclick, cls, attrs) => h('button', Object.assign({ type: 'button', class: 'rbtn ' + (cls || ''), onclick }, attrs || {}), label);

  /* ---------- Schermate ---------- */
  function render() {
    Q.clear(app);
    if (status !== 'connected') return renderJoin();
    if (!sess || !st) return renderWaiting('Collegato. In attesa che la regia avvii una sessione…');
    if (st.phase === 'lobby') return renderLobby();
    if (st.phase === 'end') return renderEnd();
    renderQuestion();
  }

  function header(extra) {
    return h('header', { class: 'rhead' },
      h('div', { class: 'rtitle' }, h('span', { class: 'dot on' }), sess ? sess.quiz.title : 'Quiz LIM'),
      extra || null);
  }

  function renderJoin() {
    const inp = h('input', { class: 'code-in', maxlength: '7', placeholder: 'ABC123', value: net.code || '', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', inputmode: 'text', 'aria-label': 'Codice della sessione' });
    const msgs = {
      connecting: 'Collegamento in corso…',
      notfound: 'Codice non trovato: controlla il codice e che la sessione sia avviata in regia.',
      offline: 'Nessuna connessione a internet.',
      lost: 'Collegamento perso, riprovo…',
    };
    app.append(h('div', { class: 'join' },
      h('div', { class: 'logo' }, 'Quiz', h('span', null, 'LIM')),
      h('div', { class: 'join-sub' }, '📱 Telecomando'),
      h('p', null, 'Inserisci il codice della sessione mostrato in regia'),
      h('form', {
        class: 'join-form',
        onsubmit: (e) => {
          e.preventDefault();
          const c = Q.normCode(inp.value);
          if (c.length !== 6) { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 500); return; }
          history.replaceState(null, '', location.pathname + '?code=' + c);
          net.connect(c);
        },
      }, inp, h('button', { type: 'submit', class: 'rbtn primary' }, 'Collega')),
      status && msgs[status] ? h('p', { class: 'join-msg ' + status }, msgs[status]) : null));
    if (!status || status === 'notfound') setTimeout(() => inp.focus(), 50);
  }

  function renderWaiting(text) {
    app.append(header(), h('div', { class: 'center' }, h('div', { class: 'spinner' }), h('p', null, text)));
  }

  function renderLobby() {
    app.append(header(),
      h('div', { class: 'center' },
        h('div', { class: 'kicker' }, Q.MODES[st.mode]),
        h('h1', null, sess.quiz.title),
        h('p', { class: 'muted' }, `${sess.order.length} domande`),
        btn('▶ Inizia il quiz', () => cmd('next'), 'primary big')));
  }

  function renderEnd() {
    app.append(header(), h('div', { class: 'center' }, h('div', { class: 'big-emoji' }, '🏁'), h('h1', null, 'Quiz concluso'), h('p', { class: 'muted' }, 'La classifica finale è sulla LIM.')));
    if (st.mode !== 'guided') {
      const rows = Q.standings(st);
      const scoring = st.settings.scoring.enabled;
      app.append(h('div', { class: 'card' }, h('div', { class: 'label' }, 'Classifica'),
        h('ol', { class: 'lb' }, rows.map((r) => h('li', null, h('span', null, r.name), h('strong', null, scoring ? Q.fmtNum(r.points) : r.correct + ' ✔'))))));
    }
  }

  function renderQuestion() {
    const pos = st.idx;
    const q = sess.quiz.questions[sess.order[pos]];
    const r = (st.responses && st.responses[pos]) || {};
    const n = sess.order.length;
    const hasDraw = (st.participants || []).length > 0;
    const isOpen = q.type === 'open';

    app.append(header(h('span', { class: 'pill' }, `${pos + 1} / ${n}`)));

    // Domanda
    app.append(h('div', { class: 'card qcard' },
      h('div', { class: 'label' }, Q.TYPE_ICONS[q.type] + ' ' + Q.TYPES[q.type]),
      h('div', { class: 'qtext' }, Q.plainText(q.text))));

    // Chi risponde
    if (hasDraw || st.mode === 'teams') {
      const t = teamOf(r.tid);
      app.append(h('div', { class: 'card row' },
        h('div', { class: 'who' },
          t ? h('span', { class: 'team', style: { background: t.color } }, t.name) : null,
          h('span', null, r.pid ? nameOf(r.pid) : (t ? 'tutta la squadra' : 'Nessuno sorteggiato'))),
        hasDraw ? btn(r.pid ? '🎲 Risorteggia' : '🎲 Sorteggia', () => cmd('draw'), 'secondary', { disabled: r.revealed || r.confirmed }) : null));
    }

    // Timer
    const t = st.timer || {};
    const timerEl = h('div', { class: 'timer-big', id: 'rtimer' }, fmt(remaining()));
    const tBtns = h('div', { class: 'tbtns' });
    if (t.duration > 0) {
      tBtns.append(btn(t.running ? '⏸' : '▶', () => cmd('timer', 'toggle'), 'icon', { title: t.running ? 'Pausa' : 'Avvia' }));
      tBtns.append(btn('+10', () => cmd('timer', 'add10'), 'icon', { title: '+10 secondi' }));
      tBtns.append(btn('↺', () => cmd('timer', 'restart'), 'icon', { title: 'Ricomincia' }));
      tBtns.append(btn('⏹', () => cmd('timer', 'stop'), 'icon danger', { title: 'Interrompi timer' }));
    } else {
      tBtns.append(btn('+10 s', () => cmd('timer', 'add10'), 'icon wide'));
    }
    app.append(h('div', { class: 'card row timer-card' + (t.expired ? ' expired' : '') }, timerEl, tBtns));

    // Esito
    const S = { correct: ['ok', '✔ Corretta'], wrong: ['ko', '✘ Errata'], blank: ['blank', r.timedOut ? '⏱ Tempo scaduto' : '— Vuota'], pending: ['pending', 'In valutazione'] };
    if (r.revealed || r.confirmed) {
      const card = h('div', { class: 'card' });
      if (r.status && S[r.status]) card.append(h('div', { class: 'verdict ' + S[r.status][0] }, S[r.status][1], st.mode !== 'guided' && st.settings.scoring.enabled && r.status !== 'pending' ? h('span', { class: 'pts' }, Q.fmtPts(r.points) + ' pt') : null));
      card.append(h('div', { class: 'label' }, isOpen && !r.revealed ? 'Scegli l’esito' : 'Cambia esito'));
      card.append(h('div', { class: 'seg' },
        btn('✔', () => cmd('status', 'correct'), 'ok' + (r.status === 'correct' ? ' active' : '')),
        btn('✘', () => cmd('status', 'wrong'), 'ko' + (r.status === 'wrong' ? ' active' : '')),
        btn('—', () => cmd('status', 'blank'), 'blank' + (r.status === 'blank' ? ' active' : ''))));
      card.append(btn('↺ Riapri risposta', () => cmd('reopen'), 'link'));
      app.append(card);
    } else {
      app.append(btn(isOpen ? '✔ Risposto' : '✔ Conferma e correggi', () => cmd('confirm'), 'success big'));
    }

    // Soluzione (solo sul telefono del docente)
    app.append(h('div', { class: 'card' },
      btn((showSolution ? '▾' : '▸') + ' 🔑 Soluzione', () => { showSolution = !showSolution; render(); }, 'link'),
      showSolution ? h('div', { class: 'solution' }, Q.solutionText(q)) : null));

    // Navigazione
    app.append(h('nav', { class: 'navbar' },
      btn('←', () => cmd('prev'), 'secondary nav-prev', { disabled: pos === 0, title: 'Precedente' }),
      st.mode !== 'guided' ? btn('🏆', () => cmd('lb'), 'secondary' + (st.overlay === 'leaderboard' ? ' active' : ''), { title: 'Classifica sulla LIM' }) : null,
      btn(st.nextLabel || 'Successiva →', () => cmd('next'), 'primary nav-next', { disabled: isOpen && r.confirmed && !r.revealed })));
  }

  /* ---------- Timer ---------- */
  function remaining() {
    const t = (st && st.timer) || {};
    return t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining || 0;
  }
  function fmt(ms) {
    if (!st || !st.timer || !(st.timer.duration > 0)) return '⏱ —';
    const sec = Math.ceil(ms / 1000);
    return '⏱ ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  setInterval(() => {
    const el = document.getElementById('rtimer');
    if (el && st) { el.textContent = fmt(remaining()); el.classList.toggle('low', st.timer && st.timer.duration > 0 && remaining() <= 5000); }
  }, 250);

  render();
})();
