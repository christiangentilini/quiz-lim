/* Schermo LIM: mostra lo stato inviato dalla regia e rimanda le risposte toccate sulla lavagna */
(function () {
  'use strict';
  const h = Q.h;
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), hdr = $('#hdr'), overlay = $('#overlay'), result = $('#result');

  let sess = null;       // { id, quiz, order, views }
  let st = null;         // stato pubblico della sessione
  let screen = null;     // wait | lobby | q | end
  let qroot = null, qKey = null, qRev = -1, localAnswer = null;
  let lastDraw = null, drawTimer = null, drawing = false;
  let lastResult = null, lastExpired = null, overlayKey = null;
  let ready = false; // niente animazioni per gli stati già presenti all'apertura
  setTimeout(() => { ready = true; }, 1500);
  const nextBtn = $('#next');
  nextBtn.addEventListener('click', () => { if (st) sync.send('next', { pos: st.idx }); });

  const sync = Q.Sync('lim', onMsg);
  sync.send('hello');
  setInterval(() => sync.send('ping'), 2000);

  /* Proiezione da link (/live): si entra con il codice della sessione */
  const params = new URLSearchParams(location.search);
  const joinMode = params.get('join') === '1' || !!params.get('code');
  let net = null, netStatus = null;
  if (joinMode) {
    net = Q.NetJoin(sync, 'live', (status) => { netStatus = status; if (!sess || !st) render(); });
    const c0 = Q.normCode(params.get('code'));
    if (c0.length === 6) net.connect(c0);
  }

  function onMsg(m) {
    // entrata con codice: ascolta solo la sessione di quel codice
    if (joinMode && net && net.code && ['session', 'state', 'idle'].includes(m.t)) {
      const c = m.t === 'session' ? m.session.code : m.t === 'state' ? m.state.code : m.code;
      if (c !== net.code) return;
    }
    if (m.t === 'session') { sess = m.session; qKey = null; if (st && st.id === sess.id) render(); }
    else if (m.t === 'state') {
      st = m.state;
      if (!sess || sess.id !== st.id) { sync.send('hello'); return; }
      render();
    } else if (m.t === 'idle') { sess = null; st = null; render(); }
  }

  const nameOf = (id) => ((st.participants || []).find((p) => p.id === id) || {}).name || '';
  const teamOf = (id) => (st.teams || []).find((t) => t.id === id);

  function render() {
    if (!sess || !st) { showWait(); renderNext(); return; }
    Q.muted = st.settings && st.settings.sound === false;
    handleDraw();
    if (st.phase === 'lobby') showLobby();
    else if (st.phase === 'end') showEnd();
    else showQuestion();
    renderOverlay();
    renderNext();
  }

  function renderNext() {
    let show = false;
    if (sess && st && st.nextLabel) {
      if (st.phase === 'lobby') show = true;
      else if (st.phase === 'question') {
        const r = (st.responses && st.responses[st.idx]) || {};
        show = !!r.revealed && !drawing && st.overlay !== 'leaderboard';
      }
    }
    nextBtn.classList.toggle('hidden', !show);
    if (show) nextBtn.textContent = st.nextLabel;
  }

  function setScreen(name) {
    if (screen === name) return;
    screen = name;
    Q.clear(stage);
    stage.className = 'stage s-' + name;
    stage._key = null;
    qroot = null; qKey = null;
    result.className = 'result hidden';
    lastResult = null;
  }

  /* ---------- Attesa ---------- */
  function showWait() {
    setScreen('wait');
    hdr.classList.add('hidden');
    hideOverlay();
    if (joinMode && netStatus !== 'connected') return showJoin();
    if (stage._key === 'wait') return;
    stage._key = 'wait';
    Q.clear(stage);
    stage.append(h('div', { class: 'center-box' },
      h('div', { class: 'logo' }, 'Quiz', h('span', null, 'LIM')),
      h('p', { class: 'muted' }, 'In attesa della regia…'),
      h('p', { class: 'small muted' }, 'Avvia una sessione dal computer del docente.')));
  }

  function showJoin() {
    const key = 'join:' + netStatus;
    if (stage._key === key) return;
    stage._key = key;
    Q.clear(stage);
    const inp = h('input', { class: 'code-in', maxlength: '7', placeholder: 'ABC123', value: (net && net.code) || '', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Codice della sessione' });
    const msgs = {
      connecting: 'Collegamento in corso…',
      notfound: 'Codice non trovato: controlla il codice e che la sessione sia avviata in regia.',
      offline: 'Nessuna connessione a internet.',
      lost: 'Collegamento perso, riprovo…',
    };
    const form = h('form', {
      class: 'join-form',
      onsubmit: (e) => {
        e.preventDefault();
        const c = Q.normCode(inp.value);
        if (c.length !== 6) { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 500); return; }
        history.replaceState(null, '', location.pathname + '?join=1&code=' + c);
        Q.unlockAudio();
        net.connect(c);
      },
    }, inp, h('button', { class: 'join-btn', type: 'submit' }, 'Collega'));
    stage.append(h('div', { class: 'center-box' },
      h('div', { class: 'logo' }, 'Quiz', h('span', null, 'LIM')),
      h('p', null, 'Inserisci il codice della sessione mostrato in regia'),
      form,
      netStatus && msgs[netStatus] ? h('p', { class: 'join-msg ' + netStatus }, msgs[netStatus]) : null));
    setTimeout(() => inp.focus(), 50);
  }

  /* ---------- Presentazione ---------- */
  function showLobby() {
    setScreen('lobby');
    hdr.classList.add('hidden');
    const key = 'lobby' + JSON.stringify(st.teams) + (st.participants || []).length;
    if (stage._key === key) return;
    stage._key = key;
    Q.clear(stage);
    const box = h('div', { class: 'center-box lobby' },
      h('div', { class: 'kicker' }, Q.MODES[st.mode]),
      h('h1', null, sess.quiz.title),
      sess.quiz.description ? h('p', { class: 'muted' }, sess.quiz.description) : null,
      h('div', { class: 'lobby-meta' }, `${sess.order.length} domande`,
        st.mode === 'students' ? ` · ${st.participants.length} studenti` : '',
        st.mode === 'teams' ? ` · ${st.teams.length} squadre` : ''));
    if (st.mode === 'teams') {
      box.append(h('div', { class: 'teams' }, st.teams.map((t) => h('div', { class: 'team-card', style: { '--tc': t.color } },
        h('div', { class: 'tname' }, t.name),
        h('div', { class: 'tmembers' }, t.members.map(nameOf).join(', '))))));
    }
    box.append(h('p', { class: 'ready' }, 'Pronti? Si comincia!'));
    stage.append(box);
  }

  /* ---------- Domanda ---------- */
  function showQuestion() {
    setScreen('q');
    hdr.classList.remove('hidden');
    const pos = st.idx;
    const q = sess.quiz.questions[sess.order[pos]];
    const view = sess.views[pos];
    const r = (st.responses && st.responses[pos]) || {};
    $('#h-title').textContent = sess.quiz.title;
    $('#h-count').textContent = `Domanda ${pos + 1} di ${sess.order.length}`;
    renderWho(r);
    if (!qroot) { qroot = h('div', { class: 'qroot' }); stage.append(qroot); }
    const key = pos + '|' + (r.revealed ? 1 : 0) + '|' + (r.status || '') + '|' + (r.explained ? 1 : 0) + '|' + (r.confirmed ? 1 : 0);
    if (key !== qKey || (r.rev !== qRev && r.from !== sync.id)) {
      if (r.revealed && key !== qKey) localAnswer = r.answer;
      qKey = key;
      localAnswer = r.answer;
      drawQ(q, view, r, pos);
      stage.scrollTop = 0;
    }
    qRev = r.rev;
    renderResult(r, pos);
  }

  function drawQ(q, view, r, pos) {
    Q.renderQuestion(qroot, q, view, {
      key: sess.id + ':' + pos,
      answer: localAnswer,
      reveal: !!r.revealed,
      explain: !!r.revealed,
      confirmed: !!r.confirmed,
      onConfirm: (a) => {
        if (a !== undefined) localAnswer = a;
        sync.send('confirm', { pos, answer: localAnswer });
        if (q.type !== 'open') drawQ(q, view, Object.assign({}, r, { revealed: false }), pos);
      },
      onChange: (a, silent) => {
        localAnswer = a;
        sync.send('answer', { pos, answer: a });
        if (!silent) drawQ(q, view, r, pos);
      },
    });
  }

  function renderWho(r) {
    const el = $('#h-who');
    let txt = '', color = null;
    if (st.mode === 'guided' && !st.participants.length) txt = 'Tutta la classe';
    else if (st.mode === 'teams') {
      const t = teamOf(r.tid);
      color = t && t.color;
      txt = t ? t.name + (r.pid && !drawing ? ' · ' + nameOf(r.pid) : '') : '';
    } else txt = drawing ? 'Sorteggio…' : r.pid ? nameOf(r.pid) : 'In attesa del sorteggio';
    el.textContent = txt;
    el.style.setProperty('--tc', color || 'var(--accent)');
    el.classList.toggle('empty', st.mode !== 'teams' && st.participants.length > 0 && (!r.pid || drawing));
  }

  function renderResult(r, pos) {
    if (!(r.revealed || r.confirmed) || !r.status) { result.className = 'result hidden'; lastResult = null; return; }
    const S = {
      correct: ['ok', '✔ Corretto!'],
      wrong: ['ko', '✘ Sbagliato'],
      blank: ['blank', r.timedOut ? '⏱ Tempo scaduto' : '— Nessuna risposta'],
      pending: ['pending', 'In valutazione…'],
    }[r.status];
    const scoring = st.mode !== 'guided' && st.settings.scoring.enabled;
    const pts = scoring && r.status !== 'pending' && r.points ? Q.fmtPts(r.points) + ' pt' : '';
    Q.clear(result).append(h('span', null, S[1]));
    if (pts) result.append(h('span', { class: 'pts' }, pts));
    const key = pos + ':' + r.status + ':' + r.points;
    result.className = 'result ' + S[0];
    if (key !== lastResult) {
      const prevPos = lastResult && lastResult.split(':')[0];
      const fresh = ready && (prevPos !== String(pos) || lastResult.split(':')[1] !== r.status);
      lastResult = key;
      if (r.status === 'correct') Q.sound('correct');
      else if (r.status === 'wrong' || (r.status === 'blank' && r.timedOut)) Q.sound(r.timedOut ? 'timeout' : 'wrong');
      const big = fresh && ['correct', 'wrong', 'blank'].includes(r.status);
      if (big) splash(r.status, r.timedOut);
      result.style.animationDelay = big ? '.75s' : '0s';
      void result.offsetWidth;
      result.classList.add('pop');
    } else result.classList.add('shown');
  }

  /* Animazione d'esito: riempimento di colore a tutto schermo che poi svanisce */
  function splash(status, timedOut) {
    const conf = {
      correct: ['ok', '✔', 'Corretto!'],
      wrong: ['ko', '✘', 'Sbagliato'],
      blank: ['blank', timedOut ? '⏱' : '—', timedOut ? 'Tempo scaduto' : 'Nessuna risposta'],
    }[status];
    document.querySelectorAll('.splash').forEach((x) => x.remove());
    const el = h('div', { class: 'splash ' + conf[0] },
      h('div', { class: 'splash-fill' }),
      h('div', { class: 'splash-content' }, h('div', { class: 'splash-icon' }, conf[1]), h('div', { class: 'splash-text' }, conf[2])));
    document.body.append(el);
    if (status === 'correct') confetti(document.body);
    setTimeout(() => el.remove(), 1500);
  }

  /* ---------- Timer ---------- */
  function updateTimer() {
    const el = $('#h-timer');
    const rr = st && st.responses && st.responses[st.idx];
    if (!st || screen !== 'q' || !st.timer || !(st.timer.duration > 0) || (rr && (rr.revealed || rr.confirmed) && !st.timer.expired)) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const t = st.timer;
    const rem = t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining;
    const sec = Math.ceil(rem / 1000);
    el.querySelector('span').textContent = sec;
    const frac = Q.clamp(rem / (t.duration * 1000), 0, 1);
    el.querySelector('.tfg').style.strokeDashoffset = String(276.46 * (1 - frac));
    el.classList.toggle('low', sec <= 5 && (t.running || t.expired));
    el.classList.toggle('paused', !t.running && !t.expired && rem > 0 && rem < t.duration * 1000);
    if (t.expired) {
      const k = st.idx + ':' + t.endsAt;
      if (lastExpired !== k) { lastExpired = k; Q.sound('timeout'); }
    }
  }
  setInterval(updateTimer, 200);

  /* ---------- Sorteggio animato ---------- */
  function handleDraw() {
    const d = st && st.draw;
    if (!d || d.nonce === lastDraw) return;
    lastDraw = d.nonce;
    if (Date.now() - d.at > 5000) return;
    runDraw(d);
  }

  function runDraw(d) {
    drawing = true;
    clearTimeout(drawTimer);
    const nameEl = h('div', { class: 'draw-name' }, '…');
    const box = h('div', { class: 'draw-box', style: { '--tc': d.teamColor || 'var(--accent)' } },
      h('div', { class: 'draw-label' }, d.team ? `Squadra ${d.team}: chi risponde?` : 'Chi risponde?'),
      nameEl);
    showOverlay('draw', box);
    const names = d.names && d.names.length ? d.names : [d.winner];
    const total = 2200;
    const start = performance.now();
    let last = null;
    const step = () => {
      const el = performance.now() - start;
      if (el >= total) {
        nameEl.textContent = d.winner;
        box.classList.add('win');
        Q.sound('draw');
        confetti(overlay);
        drawTimer = setTimeout(() => { drawing = false; overlayKey = null; hideOverlay(); render(); }, 1600);
        return;
      }
      let n;
      do { n = names[Math.floor(Math.random() * names.length)]; } while (names.length > 1 && n === last);
      last = n;
      nameEl.textContent = n;
      Q.sound('tick');
      const p = el / total;
      drawTimer = setTimeout(step, 45 + 320 * p * p);
    };
    step();
    renderWho((st.responses && st.responses[st.idx]) || {});
  }

  /* ---------- Overlay (sorteggio / classifica) ---------- */
  function showOverlay(kind, content) {
    overlayKey = kind;
    Q.clear(overlay).append(content);
    overlay.className = 'overlay show ov-' + kind;
  }
  function hideOverlay() {
    overlay.className = 'overlay hidden';
    Q.clear(overlay);
  }
  function renderOverlay() {
    if (drawing) return;
    if (st.overlay === 'leaderboard' && st.phase === 'question') {
      const key = 'lb' + JSON.stringify(Q.standings(st));
      if (overlayKey === key) return;
      showOverlay('lb', leaderboard('Classifica'));
      overlayKey = key;
    } else if (overlayKey) { overlayKey = null; hideOverlay(); }
  }

  function leaderboard(title, rowsIn) {
    const rows = rowsIn || Q.standings(st);
    const scoring = st.settings.scoring.enabled;
    const val = (r) => (scoring ? r.points : r.correct);
    const max = Math.max(1, ...rows.map(val));
    return h('div', { class: 'lb' },
      h('h2', null, title),
      h('div', { class: 'lb-rows' + (rows.length > 12 ? ' many' : '') }, rows.map((r) => h('div', { class: 'lb-row' },
        h('span', { class: 'lb-rank' }, r.rank),
        h('span', { class: 'lb-name' }, r.color ? h('i', { class: 'dot', style: { background: r.color } }) : null, r.name),
        h('span', { class: 'lb-bar' }, h('i', { style: { width: (Math.max(0, val(r)) / max) * 100 + '%', background: r.color || null } })),
        h('span', { class: 'lb-pts' }, scoring ? Q.fmtNum(r.points) : r.correct + ' ✔')))));
  }

  /* ---------- Fine ---------- */
  function showEnd() {
    setScreen('end');
    hdr.classList.add('hidden');
    const key = 'end' + JSON.stringify(Q.standings(st));
    if (stage._key === key) return;
    stage._key = key;
    Q.clear(stage);
    if (st.mode === 'guided') {
      stage.append(h('div', { class: 'center-box' },
        h('div', { class: 'big-emoji' }, '🎉'),
        h('h1', null, 'Quiz completato!'),
        h('p', { class: 'muted' }, `${sess.quiz.title} · ${sess.order.length} domande`)));
    } else {
      const rows = Q.standings(st);
      const scoring = st.settings.scoring.enabled;
      const top = rows.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      const podium = h('div', { class: 'podium' }, order.map((r, i) => r ? h('div', { class: 'pod p' + [2, 1, 3][i] },
        h('div', { class: 'pod-name' }, r.name),
        h('div', { class: 'pod-pts' }, scoring ? Q.fmtNum(r.points) + ' pt' : r.correct + ' corrette'),
        h('div', { class: 'pod-block', style: { background: r.color || null } }, r.rank)) : h('div', { class: 'pod empty' })));
      stage.append(h('div', { class: 'end-box' },
        h('h1', null, '🏆 Classifica finale'),
        podium,
        rows.length > 3 ? leaderboard('', rows.slice(3)) : null));
    }
    confetti(document.body);
  }

  /* ---------- Coriandoli ---------- */
  function confetti(host) {
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
    const box = h('div', { class: 'confetti' });
    for (let i = 0; i < 70; i++) {
      box.append(h('i', { style: {
        left: Math.random() * 100 + '%',
        background: colors[i % colors.length],
        animationDelay: Math.random() * 0.5 + 's',
        animationDuration: 1.6 + Math.random() * 1.4 + 's',
        transform: `rotate(${Math.random() * 360}deg)`,
      } }));
    }
    host.append(box);
    setTimeout(() => box.remove(), 3600);
  }

  /* ---------- Schermo intero ---------- */
  const fs = $('#fs');
  let fsTimer = null;
  fs.addEventListener('click', () => {
    Q.unlockAudio();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  const showFs = () => {
    fs.classList.add('show');
    clearTimeout(fsTimer);
    fsTimer = setTimeout(() => fs.classList.remove('show'), 3000);
  };
  document.addEventListener('mousemove', showFs);
  document.addEventListener('fullscreenchange', () => {
    fs.textContent = document.fullscreenElement ? '✕ Esci da schermo intero' : '⛶ Schermo intero';
  });
  document.addEventListener('pointerdown', Q.unlockAudio);
  showFs();

  /* Aperta con «Proietta»: se il browser non l'ha già messa a schermo intero, basta un tocco */
  if (new URLSearchParams(location.search).get('fs') === '1') {
    setTimeout(() => {
      const isFull = document.fullscreenElement || (window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2);
      if (isFull) return;
      const tap = h('div', { class: 'tap-fs' }, h('div', null, h('div', { class: 'tap-icon' }, '⛶'), h('div', null, 'Tocca lo schermo per la proiezione a schermo intero')));
      tap.addEventListener('pointerdown', () => {
        document.documentElement.requestFullscreen().catch(() => {});
        Q.unlockAudio();
        tap.remove();
      });
      document.body.append(tap);
    }, 400);
  }
  render();
})();
