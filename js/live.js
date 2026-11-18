/* Sessione in classe: configurazione, conduzione e invio dello stato alla LIM */
Q.Live = (function () {
  'use strict';
  const h = Q.h;
  const DRAW_MS = 3900; // durata animazione sorteggio sulla LIM
  const MAX_AGE = 24 * 3600 * 1000; // una sessione non conclusa si chiude da sola dopo 24 ore

  /* Più sessioni possono essere attive insieme (ognuna con il suo codice).
     `s` è la sessione su cui si sta lavorando: di norma quella mostrata in regia (shownId);
     i messaggi dei dispositivi collegati a un'altra sessione la usano temporaneamente (withS). */
  const ctxs = new Map(); // id → { s, host, netInfo, saveT, drawStartT }
  let s = null;
  let shownId = null;
  let showSetup = false;
  let sync = null;
  let root = null;
  let limSeen = 0;
  let previewRoot = null;
  let quizzes = [], classes = [];
  let pendingQuiz = null;
  const NO_NET = { status: 'stopped', live: 0, remote: 0 };
  const ctx = () => (s ? ctxs.get(s.id) : null);
  const netInfoOf = () => (ctx() ? ctx().netInfo : NO_NET);
  function withS(sess, fn) { const prev = s; s = sess; try { return fn(); } finally { s = prev; } }
  function setShown(id) {
    const c = id ? ctxs.get(id) : null;
    shownId = c ? id : null;
    s = c ? c.s : null;
    if (s) broadcastLocal(); else sync.send('idle');
  }
  function activeList() { return [...ctxs.values()].map((c) => c.s).sort((a, b) => b.createdAt - a.createdAt); }
  const cfg = {
    quizId: null, mode: 'students', classId: null, present: [],
    eliminate: true, autoDraw: true, teamCount: 2, drawMember: true, guidedDraw: false,
    scoring: { enabled: true, correct: 1, wrong: 0, blank: 0, partial: false },
    timer: 0, shuffleQuestions: false, shuffleAnswers: true,
    correctionStep: false,
  };

  const cur = () => s.responses[s.idx];
  const curQ = () => s.quiz.questions[s.order[s.idx]];
  const nameOf = (id) => (s.participants.find((p) => p.id === id) || {}).name || '?';
  const teamOf = (id) => s.teams.find((t) => t.id === id);

  /* ---------- Avvio e messaggi ---------- */
  async function init(sy) {
    sync = sy;
    const all = await Q.store.all('sessions');
    // sessioni rimaste aperte da più di 24 ore: concluse automaticamente
    for (const x of all) {
      if (x.status === 'live' && Date.now() - x.createdAt > MAX_AGE) {
        Object.assign(x, { status: 'done', phase: 'end', endedAt: x.createdAt + MAX_AGE, autoEnded: true });
        await Q.store.put('sessions', x);
      }
    }
    const live = all.filter((x) => x.status === 'live').sort((a, b) => b.updatedAt - a.updatedAt);
    for (const x of live) { x.draw = null; if (!x.code) x.code = Q.newCode(); addCtx(x); }
    setShown(live[0] ? live[0].id : null);
    setInterval(tick, 250);
    document.addEventListener('keydown', onKey);
  }

  function addCtx(sess) {
    const c = { s: sess, host: null, netInfo: Object.assign({}, NO_NET), saveT: null, drawStartT: null };
    ctxs.set(sess.id, c);
    c.host = Q.NetHost(
      (m) => { if (ctxs.has(sess.id)) withS(sess, () => handle(m, true)); },
      (info) => { c.netInfo = info; if (sess.id === shownId && s && (s.phase === 'question' || s.phase === 'lobby')) draw(); else refreshListSoon(); });
    c.host.start(sess.code);
    return c;
  }
  /* Messaggi dalla LIM su questo computer (finestra o secondo schermo): riguardano la sessione mostrata */
  function onMessage(m) {
    if (!s) { if (m.t === 'hello') sync.send('idle'); else if (m.t === 'ping') limSeen = Date.now(); return; }
    handle(m, false);
  }
  function handle(m, fromNet) {
    if (m.t === 'hello') {
      if (m.role !== 'remote' && !fromNet) limSeen = Date.now();
      if (fromNet) broadcastNet(); else broadcastLocal();
    } else if (m.t === 'cmd') {
      onRemoteCmd(m);
    } else if (m.t === 'ping') {
      if (!fromNet) limSeen = Date.now();
    } else if (m.t === 'answer' && s && s.phase === 'question' && m.pos === s.idx) {
      if (!cur().revealed) setAnswer(m.answer, m.from, false);
    } else if (m.t === 'next' && s) {
      if (s.phase === 'lobby') enterQuestion(0);
      else if (s.phase === 'question' && m.pos === s.idx) nextFromLim();
    } else if (m.t === 'confirm' && s && s.phase === 'question' && m.pos === s.idx) {
      confirmAnswer(m.answer, m.from);
    }
  }

  function publicState() {
    const out = {};
    for (const k in s) if (k !== 'quiz' && k !== 'views') out[k] = s[k];
    out.nextLabel = nextLabel();
    return out;
  }
  function nextLabel() {
    if (s.phase === 'lobby') return 'Inizia ▶';
    if (s.phase !== 'question') return null;
    const step = stepPending();
    if (step === 'reveal') return 'Correggi →';
    return s.idx < s.order.length - 1 ? 'Successiva →' : 'Fine 🏁';
  }
  const msg = (t, data) => Object.assign({ __qlim: 1, t, mid: Q.uid(), from: sync.id }, data || {});
  const sessionMsg = () => ({ session: { id: s.id, code: s.code, quiz: s.quiz, order: s.order, views: s.views } });
  /* alla rete: solo i dispositivi entrati con il codice di questa sessione */
  function netSend(t, data) { const c = ctx(); if (c && c.host) c.host.send(msg(t, data)); }
  /* a questo computer: solo se è la sessione mostrata in regia */
  function localSend(t, data) { if (s && s.id === shownId) sync.send(t, data); }
  function broadcastNet() { netSend('session', sessionMsg()); netSend('state', { state: publicState() }); }
  function broadcastLocal() { localSend('session', sessionMsg()); localSend('state', { state: publicState() }); }
  function broadcastAll() { broadcastNet(); broadcastLocal(); }
  function save() {
    const c = ctx();
    if (!c) return;
    clearTimeout(c.saveT);
    const ref = s;
    c.saveT = setTimeout(() => Q.store.put('sessions', ref), 300);
  }
  function commit(render = true) {
    if (!s) return;
    const st = { state: publicState() };
    netSend('state', st);
    localSend('state', st);
    save();
    if (render && s.id === shownId) draw();
    else refreshListSoon();
  }
  /* l'elenco delle sessioni si aggiorna quando cambia qualcosa in una sessione non aperta */
  const refreshListSoon = Q.debounce(() => { if (!shownId && !showSetup && ctxs.size && root && root.isConnected) withS(null, draw); }, 300);

  /* ---------- Configurazione ---------- */
  function selectQuiz(id) {
    const qz = quizzes.find((q) => q.id === id);
    if (!qz) return;
    cfg.quizId = id;
    cfg.timer = qz.settings.timer || 0;
    cfg.shuffleQuestions = !!qz.settings.shuffleQuestions;
    cfg.shuffleAnswers = qz.settings.shuffleAnswers !== false;
    cfg.scoring = Q.clone(qz.settings.scoring);
    cfg.correctionStep = !!qz.settings.correctionStep;
  }
  function selectClass(id) {
    const c = classes.find((x) => x.id === id);
    if (!c) return;
    cfg.classId = id;
    cfg.present = c.students.map((st) => st.id);
  }

  function makeTeams(participants, n) {
    const sh = Q.shuffle(participants);
    const teams = Array.from({ length: n }, (_, i) => ({ id: Q.uid(), name: Q.TEAM_PRESETS[i % 8].name, color: Q.TEAM_PRESETS[i % 8].color, members: [] }));
    sh.forEach((p, i) => teams[i % n].members.push(p.id));
    return teams;
  }

  async function start() {
    const quiz = quizzes.find((q) => q.id === cfg.quizId);
    const cls = classes.find((c) => c.id === cfg.classId);
    if (!quiz) return;
    const usesClass = cfg.mode !== 'guided' || cfg.guidedDraw;
    if (usesClass) {
      if (!cls) return Q.toast('Seleziona una classe', 'error');
      if (!cfg.present.length) return Q.toast('Nessuno studente presente', 'error');
      if (cfg.mode === 'teams' && cfg.present.length < cfg.teamCount) return Q.toast('Ci sono più squadre che studenti presenti', 'error');
    }
    const questions = quiz.questions.map(Q.sanitizeQuestion);
    const snapshot = Object.assign(Q.clone(quiz), { questions });
    let order = questions.map((_, i) => i);
    if (cfg.shuffleQuestions) order = Q.shuffle(order);
    const views = order.map((i) => Q.prepareView(questions[i], cfg.shuffleAnswers));
    const participants = !usesClass ? [] : cls.students.filter((st) => cfg.present.includes(st.id)).map((st) => ({ id: st.id, name: st.name }));
    const scoring = Q.clone(cfg.scoring);
    if (cfg.mode === 'guided') scoring.enabled = false;
    const sess = {
      id: Q.uid(), code: Q.newCode(), status: 'live', createdAt: Date.now(), endedAt: null,
      quiz: snapshot, quizId: quiz.id, quizTitle: quiz.title,
      classId: usesClass ? cls.id : null, className: usesClass ? cls.name : null,
      mode: cfg.mode, participants,
      teams: cfg.mode === 'teams' ? makeTeams(participants, cfg.teamCount) : [],
      settings: { scoring, eliminate: cfg.eliminate, autoDraw: cfg.autoDraw, drawMember: cfg.drawMember, timer: cfg.timer, sound: true, correctionStep: cfg.correctionStep },
      order, views, drawn: [], idx: 0, phase: 'lobby', overlay: null, responses: {},
      timer: { duration: 0, running: false, endsAt: 0, remaining: 0, expired: false },
      draw: null,
    };
    await Q.store.put('sessions', sess);
    addCtx(sess);
    showSetup = false;
    setShown(sess.id);
    if (location.hash !== '#live/' + sess.id) history.replaceState(null, '', '#live/' + sess.id);
    draw();
    if (Date.now() - limSeen > 5000) Q.toast('Apri lo schermo LIM con il pulsante in alto a destra', 'info');
  }

  /* ---------- Azioni durante il quiz ---------- */
  function enterQuestion(pos) {
    if (pos < 0 || pos >= s.order.length) return;
    clearTimeout(ctx().drawStartT);
    // tornando su una domanda (avanti o indietro) la risposta si azzera: nuovo tentativo
    const stay = s.phase === 'question' && s.idx === pos && s.responses[pos];
    s.idx = pos;
    s.phase = 'question';
    s.overlay = null;
    s.draw = null;
    const q = curQ();
    let r = stay ? s.responses[pos] : null;
    if (!r) {
      r = s.responses[pos] = { answer: Q.blankAnswer(q), rev: 0, from: null, revealed: false, status: null, fraction: 0, points: 0, pid: null, tid: null, override: false };
      if (s.mode === 'teams' && s.teams.length) r.tid = s.teams[pos % s.teams.length].id;
    }
    const dur = q.time != null ? q.time : s.settings.timer || 0;
    s.timer = { base: dur, duration: dur, running: false, endsAt: 0, remaining: dur * 1000, expired: false };
    if (!r.revealed && !r.confirmed) {
      const wantsDraw = s.settings.autoDraw && !r.pid && s.participants.length > 0 && (s.mode !== 'teams' || s.settings.drawMember);
      if (wantsDraw) { doDraw(); return; }
      if (dur > 0) { startTimer(); return; }
    }
    commit();
  }

  function doDraw() {
    const r = cur();
    if (r.revealed || r.confirmed) return;
    let pool;
    if (s.mode === 'teams') {
      const team = teamOf(r.tid);
      pool = team ? s.participants.filter((p) => team.members.includes(p.id)) : [];
    } else pool = s.participants.slice();
    if (!pool.length) { Q.toast('Nessuno da sorteggiare', 'error'); return; }
    const prev = r.pid;
    if (prev) s.drawn = s.drawn.filter((id) => id !== prev);
    let cand = pool.filter((p) => p.id !== prev);
    if (s.settings.eliminate) {
      cand = cand.filter((p) => !s.drawn.includes(p.id));
      if (!cand.length) {
        s.drawn = s.drawn.filter((id) => !pool.some((p) => p.id === id));
        cand = pool.filter((p) => p.id !== prev);
        Q.toast('Sono già stati sorteggiati tutti: si ricomincia il giro', 'info');
      }
    }
    if (!cand.length) cand = pool;
    const win = cand[Math.floor(Math.random() * cand.length)];
    r.pid = win.id;
    if (!s.drawn.includes(win.id)) s.drawn.push(win.id);
    const team = s.mode === 'teams' ? teamOf(r.tid) : null;
    const nonce = Q.uid();
    s.draw = { nonce, at: Date.now(), names: pool.map((p) => p.name), winner: win.name, team: team ? team.name : null, teamColor: team ? team.color : null };
    Object.assign(s.timer, { running: false, remaining: s.timer.duration * 1000, expired: false });
    const c = ctx(), sess = s;
    clearTimeout(c.drawStartT);
    c.drawStartT = setTimeout(() => withS(sess, () => {
      if (!ctxs.has(sess.id) || s.phase !== 'question' || !s.draw || s.draw.nonce !== nonce) return;
      if (cur().revealed || cur().confirmed || s.timer.running || !(s.timer.duration > 0)) return;
      startTimer();
    }), DRAW_MS);
    commit();
  }

  function assign(pid) {
    const r = cur();
    if (r.pid && r.pid !== pid) s.drawn = s.drawn.filter((id) => id !== r.pid);
    r.pid = pid;
    if (pid && !s.drawn.includes(pid)) s.drawn.push(pid);
    s.draw = null;
    commit();
  }

  function setAnswer(answer, from, local) {
    const r = cur();
    if (r.revealed || r.confirmed) return;
    r.answer = answer;
    r.rev = (r.rev || 0) + 1;
    r.from = from;
    commit(!local);
  }

  /* Conferma: blocca la risposta, ferma il timer e dà subito l'esito (senza mostrare la soluzione) */
  function confirmAnswer(answer, from) {
    const r = cur();
    if (r.revealed || r.confirmed) return;
    if (answer !== undefined && answer !== null && curQ().type !== 'open') {
      r.answer = answer;
      r.rev = (r.rev || 0) + 1;
      r.from = from || sync.id;
    }
    if (curQ().type === 'open' || (curQ().type === 'calc' && curQ().board)) {
      // aperta (o calcolo alla lavagna): «Risposto» ferma il timer; la risposta attesa compare solo dopo l'esito del docente
      Object.assign(r, { confirmed: true, status: 'pending', fraction: 0, points: 0 });
      stopTimer();
      commit();
      return;
    }
    reveal();
  }
  function resetResponse(r) {
    Object.assign(r, { confirmed: false, revealed: false, explained: false, override: false, timedOut: false, status: null, fraction: 0, points: 0, steps: null, stepsSet: false });
  }
  function reopenAnswer() {
    resetResponse(cur());
    const t = s.timer;
    const base = t.base > 0 ? t.base : t.duration;
    if (base > 0) Object.assign(t, { base, duration: base, remaining: base * 1000, running: true, expired: false, endsAt: Date.now() + base * 1000 });
    commit();
  }
  function reveal() {
    const r = cur();
    const q = curQ();
    const ev = Q.evaluate(q, r.answer);
    r.revealed = true;
    r.confirmed = true;
    if (q.type === 'calc') {
      if (!r.stepsSet) r.steps = (ev.per || []).slice();
      applySteps(r, q, ev.status);
    } else {
      if (!r.override) { r.status = ev.status; r.fraction = ev.fraction || 0; }
      r.points = Q.pointsFor(r.status, r.fraction, s.settings.scoring);
    }
    stopTimer();
    commit();
  }
  /* Esercizio di calcolo: esito e punti dai passaggi corretti (punti per passaggio) */
  function applySteps(r, q, autoStatus) {
    const steps = q.steps || [];
    const marks = (r.steps || []).slice(0, steps.length);
    const n = marks.filter(Boolean).length;
    if (n === steps.length && steps.length) r.status = 'correct';
    else if (n > 0) r.status = 'wrong';
    else if (q.board) r.status = r.stepsSet ? 'wrong' : 'pending';
    else r.status = autoStatus === 'blank' ? 'blank' : 'wrong';
    r.fraction = steps.length ? n / steps.length : 0;
    const sc = s.settings.scoring;
    r.points = !sc || !sc.enabled || r.status === 'pending' ? 0 : r.status === 'blank' ? (Number(sc.blank) || 0) : Q.round2(n * (q.stepPoints ?? 1));
  }
  function toggleStep(i) {
    const r = cur(), q = curQ();
    const steps = q.steps || [];
    if (!r.steps) r.steps = steps.map(() => false);
    r.steps[i] = !r.steps[i];
    r.stepsSet = true;
    r.override = true;
    applySteps(r, q);
    commit();
  }

  /* La spiegazione (se presente) compare sempre insieme all'esito e alla soluzione */
  const hasExpl = (q) => !!Q.stripHtml(q.explanation).trim();
  // con «correzione obbligatoria» attiva, «Successiva» su una domanda non ancora corretta prima la corregge
  const stepPending = () => {
    if (!s.settings.correctionStep) return null;
    return cur().revealed ? null : 'reveal';
  };
  /* dalla LIM niente finestre di conferma: alla fine si conclude direttamente */
  function nextFromLim() {
    if (curQ().type === 'calc' && cur().confirmed && !cur().revealed) return reveal();
    if (curQ().type === 'open' && cur().confirmed && !cur().revealed) return;
    const step = stepPending();
    if (step === 'reveal') return confirmAnswer();
    if (s.idx < s.order.length - 1) enterQuestion(s.idx + 1);
    else finishQuiz();
  }
  function next() {
    const r = cur();
    if (curQ().type === 'calc' && r.confirmed && !r.revealed) { reveal(); return; }
    if (curQ().type === 'open' && r.confirmed && !r.revealed) { Q.toast('Scegli prima l’esito: Corretta, Errata o Vuota', 'info'); return; }
    const step = stepPending();
    if (step === 'reveal') { confirmAnswer(); return; }
    if (s.idx < s.order.length - 1) enterQuestion(s.idx + 1);
    else endQuiz();
  }
  function setStatus(status) {
    const r = cur();
    if (curQ().type === 'calc') {
      const q = curQ();
      r.steps = (q.steps || []).map(() => status === 'correct');
      r.stepsSet = true;
      r.override = true;
      r.confirmed = true;
      r.revealed = true;
      applySteps(r, q, status);
      if (status === 'blank') { r.status = 'blank'; r.points = s.settings.scoring.enabled ? (Number(s.settings.scoring.blank) || 0) : 0; }
      stopTimer();
      commit();
      return;
    }
    r.status = status;
    r.override = true;
    r.fraction = status === 'correct' ? 1 : 0;
    r.points = Q.pointsFor(status, r.fraction, s.settings.scoring);
    r.confirmed = true;
    r.revealed = true;
    stopTimer();
    commit();
  }

  /* Timer */
  const remaining = () => (s.timer.running ? Math.max(0, s.timer.endsAt - Date.now()) : s.timer.remaining);
  function startTimer() {
    const t = s.timer;
    if (!(t.duration > 0)) return;
    if (t.remaining <= 0) t.remaining = t.duration * 1000;
    t.running = true;
    t.expired = false;
    t.endsAt = Date.now() + t.remaining;
    commit();
  }
  function pauseTimer() {
    const t = s.timer;
    t.remaining = remaining();
    t.running = false;
    commit();
  }
  function stopTimer() {
    const t = s.timer;
    if (t.running) { t.remaining = remaining(); t.running = false; }
  }
  /* Azzera: torna al tempo standard della domanda (senza i secondi aggiunti) e riparte subito */
  function reopenIfTimedOut() {
    const r = cur();
    if (r.timedOut) resetResponse(r);
  }
  function resetTimer() {
    reopenIfTimedOut();
    const t = s.timer;
    const base = t.base > 0 ? t.base : t.duration;
    if (!(base > 0)) return;
    Object.assign(t, { base, duration: base, remaining: base * 1000, running: true, expired: false, endsAt: Date.now() + base * 1000 });
    commit();
  }
  /* Aggiungi tempo: se il tempo era scaduto il timer riparte con i secondi aggiunti */
  function addTime(sec) {
    const t = s.timer;
    if (t.expired) reopenIfTimedOut();
    if (!(t.base > 0)) t.base = sec;
    if (t.expired || !(t.duration > 0)) {
      Object.assign(t, { duration: sec, remaining: sec * 1000, running: true, expired: false, endsAt: Date.now() + sec * 1000 });
    } else if (t.running) {
      t.duration += sec;
      t.endsAt += sec * 1000;
    } else {
      t.duration += sec;
      t.remaining += sec * 1000;
    }
    commit();
  }
  function removeTimer() {
    Object.assign(s.timer, { base: 0, duration: 0, running: false, remaining: 0, expired: false });
    commit();
  }
  function tick() {
    for (const c of ctxs.values()) withS(c.s, tickOne);
    if (s && s.phase === 'question') {
      const d = document.getElementById('tdisp');
      if (d) {
        d.textContent = fmtTime(remaining());
        d.classList.toggle('low', s.timer.duration > 0 && remaining() <= 5000);
      }
    }
  }
  function tickOne() {
    if (s.status === 'live' && Date.now() - s.createdAt > MAX_AGE) {
      s.autoEnded = true;
      finishQuiz();
      Q.toast(`Sessione ${Q.fmtCode(s.code)} conclusa automaticamente dopo 24 ore`, 'info');
      return;
    }
    if (s.phase !== 'question') return;
    const t = s.timer;
    if (t.running && Date.now() >= t.endsAt) {
      Object.assign(t, { running: false, remaining: 0, expired: true });
      const r = cur();
      if (!r.revealed) {
        // tempo scaduto: la risposta vale «vuota» e la correzione appare subito
        Object.assign(r, { status: 'blank', fraction: 0, override: true, timedOut: true, revealed: true, confirmed: true });
        r.points = Q.pointsFor('blank', 0, s.settings.scoring);
      }
      commit();
      if (s.id === shownId) Q.toast('⏱ Tempo scaduto', 'info');
    }
  }
  function fmtTime(ms) {
    if (!(s.timer.duration > 0)) return '—';
    const sec = Math.ceil(ms / 1000);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function toggleLb() {
    s.overlay = s.overlay === 'leaderboard' ? null : 'leaderboard';
    commit();
  }

  async function endQuiz() {
    const missing = s.order.filter((_, i) => !(s.responses[i] && (s.responses[i].revealed || s.responses[i].confirmed))).length;
    const ok = await Q.confirm({
      title: 'Concludere il quiz?',
      message: missing ? `Ci sono ${missing} domande senza correzione.` : 'Sulla LIM comparirà la schermata finale.',
      ok: 'Concludi quiz', icon: '🏁',
    });
    if (ok) finishQuiz();
  }
  function finishQuiz() {
    stopTimer();
    s.phase = 'end';
    s.status = 'done';
    s.endedAt = Date.now();
    s.overlay = null;
    s.draw = null;
    commit();
  }
  function reopen() {
    s.status = 'live';
    s.phase = 'question';
    s.endedAt = null;
    commit();
  }
  function dropSession(sess) {
    const c = ctxs.get(sess.id);
    if (!c) return;
    clearTimeout(c.saveT);
    clearTimeout(c.drawStartT);
    withS(sess, () => netSend('idle', { code: sess.code }));
    setTimeout(() => c.host.stop(), 500);
    ctxs.delete(sess.id);
    if (shownId === sess.id) setShown(null);
    location.hash = '#live';
    draw();
  }
  async function closeSession() {
    await Q.store.put('sessions', s);
    dropSession(s);
  }
  async function cancel() {
    if (!(await Q.confirm({ title: 'Annullare la sessione?', message: 'Non verrà salvata nello storico.', ok: 'Annulla sessione', cancel: 'Indietro', danger: true }))) return;
    const sess = s;
    await Q.store.del('sessions', sess.id);
    dropSession(sess);
  }

  /* ---------- Telecomando ---------- */
  function onRemoteCmd(m) {
    if (!s) return;
    const c = m.cmd;
    if (s.phase === 'lobby') { if (c === 'next') enterQuestion(0); return; }
    if (s.phase !== 'question') return;
    const samePos = m.pos === s.idx; // evita doppi comandi arrivati in ritardo
    switch (c) {
      case 'next': if (samePos) nextFromLim(); break;
      case 'prev': if (samePos) enterQuestion(s.idx - 1); break;
      case 'draw': if (s.participants.length) doDraw(); break;
      case 'confirm': if (samePos) confirmAnswer(); break;
      case 'status': if (samePos && ['correct', 'wrong', 'blank'].includes(m.value)) setStatus(m.value); break;
      case 'reopen': if (samePos) reopenAnswer(); break;
      case 'lb': if (s.mode !== 'guided') toggleLb(); break;
      case 'timer':
        if (m.value === 'toggle' && s.timer.duration > 0) { if (s.timer.running) pauseTimer(); else startTimer(); }
        else if (m.value === 'add10') addTime(10);
        else if (m.value === 'restart') resetTimer();
        else if (m.value === 'stop') removeTimer();
        break;
    }
  }

  /* ---------- Collega dispositivi: codice, QR, link ---------- */
  const qrSvg = (text, cls) => {
    if (typeof window.qrcode !== 'function') return h('div', { class: 'muted small' }, 'QR non disponibile (serve internet)');
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return h('div', { class: 'qr ' + (cls || ''), html: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) });
  };
  const copyBtn = (text, label) => h('button', { class: 'btn small ghost', title: 'Copia', onclick: () => navigator.clipboard.writeText(text).then(() => Q.toast('Copiato', 'ok')) }, label || '⧉');
  const netLabel = (info) => ({ online: '● In linea', connecting: '◌ Collegamento…', offline: '✕ Nessuna connessione a internet', stopped: '—' }[info.status] || info.status);

  /* Telecomando: QR sempre visibile nella colonna della regia */
  function remoteCard() {
    const Lk = Q.links(s.code);
    const netInfo = netInfoOf();
    return h('div', { class: 'card soft remote-card' },
      h('div', { class: 'flabel' }, '📱 Telecomando'),
      qrSvg(Lk.remote, 'small'),
      h('div', { class: 'small muted' }, 'oppure ', h('code', null, Lk.remoteEntry.replace(/^https?:\/\//, '')), ' + codice ', h('strong', { class: 'mono' }, Q.fmtCode(s.code))),
      h('div', { class: 'net-line small ' + netInfo.status }, netLabel(netInfo), netInfo.remote ? ` · 📱 ${netInfo.remote} collegati` : ''),
      Q.isLocalHost() ? h('div', { class: 'small warn-text' }, 'In locale: dal telefono funzionerà con l’app pubblicata online.') : null);
  }

  function shortcutsCard(hasDraw, withPeople) {
    const rows = [
      [['→'], 'Successiva'],
      [['←'], 'Precedente'],
      [['Invio', 'C'], 'Conferma e correggi'],
      hasDraw ? [['S'], 'Sorteggia'] : null,
      withPeople ? [['L'], 'Classifica sulla LIM'] : null,
      [['T'], 'Avvia / pausa timer'],
      [['X'], 'Interrompi timer'],
    ].filter(Boolean);
    return h('div', { class: 'card soft keys' },
      h('div', { class: 'flabel' }, '⌨ Scorciatoie'),
      h('div', { class: 'keys-grid' }, rows.map(([keys, label]) => [
        h('span', { class: 'keys-k' }, keys.map((k, i) => [i ? h('span', { class: 'muted' }, '/') : null, h('kbd', null, k)])),
        h('span', null, label),
      ])));
  }

  /* Tutti i link del quiz */
  function linksDialog() {
    if (!s) return;
    const Lk = Q.links(s.code);
    const netInfo = netInfoOf();
    const row = (icon, label, url, hint) => h('div', { class: 'link-item' },
      h('div', null, h('strong', null, icon + ' ' + label), hint ? h('div', { class: 'small muted' }, hint) : null),
      h('div', { class: 'link-row' }, h('code', null, url), copyBtn(url, '⧉ Copia')));
    const content = h('div', { class: 'devices' },
      h('div', { class: 'code-big' }, h('span', { class: 'flabel' }, 'Codice sessione'), h('div', { class: 'code' }, Q.fmtCode(s.code)), copyBtn(s.code, '⧉ Copia')),
      h('div', { class: 'net-status ' + netInfo.status }, `${netLabel(netInfo)} · 🖥 ${netInfo.live} LIM remote · 📱 ${netInfo.remote} telecomandi`),
      h('div', { class: 'small muted' }, `Il codice vale per questa sessione: si conclude da sola il ${Q.fmtDate(s.createdAt + MAX_AGE)} se non la concludi prima.`),
      Q.isLocalHost() ? h('div', { class: 'warn small' }, 'Stai usando l’app in locale: telefono e altri computer potranno collegarsi quando l’app sarà pubblicata online. Su questo computer i link funzionano già.') : null,
      row('📽', 'LIM remota', Lk.live, 'Sul computer collegato alla LIM. Senza codice: ' + Lk.liveEntry),
      row('📱', 'Telecomando', Lk.remote, 'Telefono o tablet (c’è anche il QR in regia). Senza codice: ' + Lk.remoteEntry),
      row('🎛', 'Regia della sessione', Lk.quiz, 'Riapre questa regia sulla sessione in corso'));
    Q.modal({ title: 'Link della sessione', content });
  }
  /* ---------- Tastiera ---------- */
  function onKey(e) {
    if (!s || !root || !root.isConnected) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (s.phase === 'lobby') {
      if (k === 'enter' || k === 'arrowright') { e.preventDefault(); enterQuestion(0); }
      return;
    }
    if (s.phase !== 'question') return;
    if (k === 'arrowright') next();
    else if (k === 'arrowleft') enterQuestion(s.idx - 1);
    else if (k === 'enter') { if (cur().revealed) next(); else if (cur().confirmed && curQ().type === 'calc') reveal(); else confirmAnswer(); }
    else if (k === 'c') { if (!cur().revealed) confirmAnswer(); }
    else if (k === 's' && s.participants.length) doDraw();
    else if (k === 't') { if (s.timer.duration > 0) { if (s.timer.running) pauseTimer(); else startTimer(); } }
    else if (k === 'l' && s.mode !== 'guided') toggleLb();
    else if (k === 'x' && s.timer.duration > 0) removeTimer();
    else return;
    e.preventDefault();
  }

  /* ---------- Interfaccia ---------- */
  async function render(el, sub) {
    root = el;
    if (sub === 'new') { showSetup = true; if (shownId) setShown(null); }
    else if (sub && ctxs.has(sub)) { showSetup = false; if (shownId !== sub) setShown(sub); }
    else if (!sub) { showSetup = false; if (shownId) setShown(null); }
    quizzes = (await Q.store.all('quizzes')).sort((a, b) => b.updatedAt - a.updatedAt);
    classes = (await Q.store.all('classes')).sort((a, b) => a.name.localeCompare(b.name));
    if (pendingQuiz) { selectQuiz(pendingQuiz); pendingQuiz = null; }
    else if (cfg.quizId) selectQuiz(cfg.quizId);
    if (!cfg.quizId || !quizzes.find((q) => q.id === cfg.quizId)) { if (quizzes[0]) selectQuiz(quizzes[0].id); }
    const cls = classes.find((c) => c.id === cfg.classId);
    if (!cls) { if (classes[0]) selectClass(classes[0].id); }
    else cfg.present = cfg.present.filter((id) => cls.students.some((st) => st.id === id));
    draw();
  }

  function draw() {
    if (!root || !root.isConnected) return;
    const y = window.scrollY;
    if (!s) { if (showSetup || !ctxs.size) drawSetup(); else drawList(); }
    else if (s.phase === 'lobby') drawLobby();
    else if (s.phase === 'end') drawEnd();
    else drawLive();
    document.body.classList.toggle('fit-screen', !!s && (s.phase === 'question' || s.phase === 'lobby'));
    window.scrollTo(0, y);
  }

  /* Elenco delle sessioni attive */
  function drawList() {
    Q.clear(root);
    root.append(h('div', { class: 'page-head' },
      h('h1', null, 'Sessioni attive'),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#live/new' }, '+ Nuova sessione'))));
    root.append(h('p', { class: 'muted small' }, 'Ogni sessione ha il suo codice e resta attiva finché non la chiudi, al massimo 24 ore. La LIM di questo computer mostra la sessione che apri.'));
    root.append(h('div', { class: 'cards' }, activeList().map((x) => {
      const c = ctxs.get(x.id);
      const phase = x.phase === 'lobby' ? 'In attesa di partire' : x.phase === 'end' ? 'Quiz concluso' : `Domanda ${x.idx + 1} di ${x.order.length}`;
      return h('div', { class: 'card quiz-card session-card' },
        h('div', { class: 'row between' }, h('span', { class: 'live-mode' }, Q.MODES[x.mode]), h('span', { class: 'code-chip mono' }, Q.fmtCode(x.code))),
        h('h3', null, h('a', { href: '#live/' + x.id }, x.quizTitle)),
        h('div', { class: 'small muted' }, (x.className ? x.className + ' · ' : '') + phase),
        h('div', { class: 'small muted' }, `Avviata ${Q.fmtDate(x.createdAt)} · scade ${Q.fmtDate(x.createdAt + MAX_AGE)}`),
        h('div', { class: 'small' }, `🖥 ${c.netInfo.live} LIM remote · 📱 ${c.netInfo.remote} telecomandi`),
        h('div', { class: 'card-actions' }, h('a', { class: 'btn small primary', href: '#live/' + x.id }, 'Apri regia')));
    })));
  }
  const sessionsBtn = () => h('a', { class: 'btn ghost', href: '#live', title: 'Tutte le sessioni attive' }, `☰ Sessioni (${ctxs.size})`);
  /* Codice della sessione nell'intestazione: clic per i link */
  const codeChip = () => h('button', { class: 'code-pill', title: 'Link della sessione', onclick: linksDialog },
    h('span', { class: 'muted' }, 'Codice'), h('strong', null, Q.fmtCode(s.code)), h('span', null, '🔗'));

  const chk = (label, key, onchange) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!cfg[key], onchange: (e) => { cfg[key] = e.target.checked; if (onchange) onchange(); } }), label);
  const field = (label, ...ctl) => h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), ...ctl);

  function drawSetup() {
    Q.clear(root);
    root.append(h('div', { class: 'page-head' }, h('h1', null, 'Nuova sessione in classe')));
    if (!quizzes.length) {
      root.append(h('div', { class: 'empty card' }, h('h2', null, 'Nessun quiz'), h('p', { class: 'muted' }, 'Crea prima un quiz nella sezione Quiz.'), h('a', { class: 'btn primary', href: '#quiz' }, 'Vai ai quiz')));
      return;
    }
    const quiz = quizzes.find((q) => q.id === cfg.quizId);
    const cls = classes.find((c) => c.id === cfg.classId);
    const card = h('div', { class: 'card setup' });

    card.append(field('Quiz', Q.setVal(h('select', { onchange: (e) => { selectQuiz(e.target.value); draw(); } },
      quizzes.map((qz) => h('option', { value: qz.id }, `${qz.title} (${qz.questions.length} domande)`))), cfg.quizId)));

    const modes = [
      ['guided', '📖 ' + Q.MODES.guided, 'Correzione a ogni domanda, nessun punteggio né classifica. Sorteggio facoltativo di chi risponde.'],
      ['students', '🎲 ' + Q.MODES.students, 'A ogni domanda viene sorteggiato uno studente. Punti e classifica.'],
      ['teams', '🏁 ' + Q.MODES.teams, 'Squadre a turno, con sorteggio di chi risponde. Punti e classifica di squadra.'],
    ];
    card.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Modalità'),
      h('div', { class: 'mode-cards' }, modes.map(([v, t, d]) => h('button', { type: 'button', class: 'mode-card' + (cfg.mode === v ? ' active' : ''), onclick: () => { cfg.mode = v; draw(); } },
        h('strong', null, t), h('span', null, d))))));

    const usesClass = cfg.mode !== 'guided' || cfg.guidedDraw;
    if (cfg.mode === 'guided') {
      card.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Sorteggio'),
        chk('Sorteggia chi risponde a ogni domanda (senza punti né classifica)', 'guidedDraw', draw)));
    }
    if (usesClass) {
      if (!classes.length) {
        card.append(h('div', { class: 'warn' }, 'Nessuna classe salvata. ', h('a', { href: '#classi' }, 'Crea una classe'), ' per usare sorteggio e classifica.'));
      } else {
        card.append(field('Classe', Q.setVal(h('select', { onchange: (e) => { selectClass(e.target.value); draw(); } },
          classes.map((c) => h('option', { value: c.id }, `${c.name} (${c.students.length} studenti)`))), cfg.classId)));
        if (cls) {
          const cnt = h('span', { class: 'muted small' });
          const updCnt = () => { cnt.textContent = `${cfg.present.length} presenti su ${cls.students.length}`; };
          updCnt();
          card.append(h('div', { class: 'field' },
            h('div', { class: 'row between' }, h('span', { class: 'flabel' }, 'Presenti (togli la spunta agli assenti)'),
              h('span', null, cnt, ' ',
                h('button', { type: 'button', class: 'link', onclick: () => { cfg.present = cls.students.map((x) => x.id); draw(); } }, 'tutti'), ' · ',
                h('button', { type: 'button', class: 'link', onclick: () => { cfg.present = []; draw(); } }, 'nessuno'))),
            cls.students.length
              ? h('div', { class: 'present-grid' }, cls.students.map((st) => h('label', { class: 'chk' },
                h('input', { type: 'checkbox', checked: cfg.present.includes(st.id), onchange: (e) => {
                  if (e.target.checked) { if (!cfg.present.includes(st.id)) cfg.present.push(st.id); } else cfg.present = cfg.present.filter((x) => x !== st.id);
                  updCnt();
                } }), st.name)))
              : h('div', { class: 'warn' }, 'La classe non ha studenti. ', h('a', { href: '#classi' }, 'Aggiungili'), '.')));
        }
        const drawBox = h('div', { class: 'field' }, cfg.mode === 'guided' ? h('span', { class: 'flabel' }, 'Opzioni sorteggio') : h('span', { class: 'flabel' }, 'Sorteggio'),
          chk('Sorteggio automatico a ogni domanda', 'autoDraw'),
          chk('Escludi chi è già stato sorteggiato (finché non escono tutti)', 'eliminate'));
        if (cfg.mode === 'teams') {
          drawBox.append(chk('Sorteggia anche chi risponde all’interno della squadra', 'drawMember'));
          drawBox.append(h('label', { class: 'inline' }, 'Numero di squadre ',
            h('input', { type: 'number', class: 'w-num', min: 2, max: 8, value: cfg.teamCount, oninput: (e) => { cfg.teamCount = Q.clamp(parseInt(e.target.value, 10) || 2, 2, 8); } })));
        }
        card.append(drawBox);
      }
    }
    if (cfg.mode !== 'guided' && classes.length) {
      const sc = cfg.scoring;
      const num = (label, key) => h('label', { class: 'pts-field' }, h('span', null, label),
        h('input', { type: 'number', step: 0.25, value: sc[key], oninput: (e) => { const v = parseFloat(e.target.value); sc[key] = isNaN(v) ? 0 : v; } }));
      card.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Punteggio'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!sc.enabled, onchange: (e) => { sc.enabled = e.target.checked; draw(); } }), 'Assegna punti'),
        sc.enabled
          ? h('div', { class: 'pts-box' },
            h('div', { class: 'pts-grid' }, num('✔ Corretta', 'correct'), num('✘ Errata', 'wrong'), num('— Non risposta', 'blank')),
            h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!sc.partial, onchange: (e) => { sc.partial = e.target.checked; } }), 'Punteggio parziale (es. 3 spazi corretti su 4 = 75% dei punti)'))
          : h('div', { class: 'muted small' }, 'Senza punti la classifica conta le risposte corrette.')));
    }

    card.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Tempo e ordine'),
      h('label', { class: 'inline' }, '⏱ Timer per domanda ',
        h('input', { type: 'number', class: 'w-num', min: 0, step: 5, value: cfg.timer, oninput: (e) => { cfg.timer = Math.max(0, parseInt(e.target.value, 10) || 0); } }),
        ' secondi (0 = nessun timer)'),
      chk('Domande in ordine casuale', 'shuffleQuestions'),
      chk('Risposte in ordine casuale', 'shuffleAnswers')));
    card.append(h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Correzione'),
      chk('Correzione obbligatoria: «Successiva» su una domanda senza risposta prima mostra la soluzione', 'correctionStep')));

    if (quiz) {
      const warns = quiz.questions.map((q, i) => [i, Q.validate(q)]).filter((x) => x[1].length);
      if (!quiz.questions.length) card.append(h('div', { class: 'warn' }, 'Il quiz non contiene domande.'));
      else if (warns.length) card.append(h('div', { class: 'warn' }, `Attenzione: ${warns.length === 1 ? 'la domanda' : 'le domande'} ${warns.map((w) => w[0] + 1).join(', ')} ${warns.length === 1 ? 'è incompleta' : 'sono incomplete'}. `, h('a', { href: '#quiz/' + quiz.id }, 'Correggi')));
    }
    const disabled = !quiz || !quiz.questions.length || (usesClass && !cls);
    card.append(h('div', { class: 'actions' }, h('button', { class: 'btn primary big', disabled, onclick: start }, '▶ Avvia sessione')));
    root.append(card);
  }

  /* Sessione avviata ma quiz non ancora partito: regia completa, LIM sulla presentazione, nessun timer */
  function drawLobby() {
    Q.clear(root);
    const withPeople = s.mode !== 'guided';
    const hasDraw = s.participants.length > 0;
    const top = h('div', { class: 'live-top' },
      h('div', { class: 'live-title' },
        h('h2', null, s.quizTitle),
        h('span', { class: 'live-mode' }, Q.MODES[s.mode] + (s.className ? ' · ' + s.className : '')),
        codeChip()),
      h('div', { class: 'actions' },
        sessionsBtn(),
        h('button', { class: 'btn ghost', title: 'Suoni sulla LIM', onclick: () => { s.settings.sound = !s.settings.sound; commit(); } }, s.settings.sound ? '🔊 Suoni attivi' : '🔇 Suoni spenti'),
        h('button', { class: 'btn ghost danger', onclick: cancel }, 'Annulla sessione')));

    const nav = h('aside', { class: 'qnav' }, h('div', { class: 'flabel' }, 'Domande'), s.order.map((qi, i) => {
      const qq = s.quiz.questions[qi];
      return h('button', { class: 'qnav-item', title: 'Parti da questa domanda', onclick: () => enterQuestion(i) },
        h('span', { class: 'qn' }, i + 1), h('span', { class: 'qt' }, Q.TYPE_ICONS[qq.type] + ' ' + Q.plainText(qq.text)));
    }));

    const ready = h('div', { class: 'card ready-card' },
      h('div', { class: 'ready-icon' }, '⏸'),
      h('h2', null, 'Quiz pronto, in attesa'),
      h('p', { class: 'muted' }, `${s.order.length} domande` + (s.className ? ` · ${s.className} · ${s.participants.length} presenti` : '') + '. Sulla LIM c’è la presentazione; nessun timer è partito.'));
    if (s.mode === 'teams') {
      ready.append(h('div', { class: 'teams' }, s.teams.map((t) => h('div', { class: 'team-card', style: { '--tc': t.color } },
        h('strong', null, t.name), h('div', { class: 'small' }, t.members.map(nameOf).join(', '))))));
      ready.append(h('button', { class: 'btn', onclick: () => { s.teams = makeTeams(s.participants, s.teams.length); commit(); } }, '🔀 Rimescola squadre'));
    }
    ready.append(h('button', { class: 'btn primary big start-btn', onclick: () => enterQuestion(0) }, '▶ Avvia il quiz (Invio)'));
    const center = h('section', { class: 'live-center' }, ready);

    const side = h('aside', { class: 'live-side' });
    const rc = remoteCard(), sc = shortcutsCard(hasDraw, withPeople);
    side.append(rc, sc);
    root.append(top, h('div', { class: 'live-grid' }, nav, center, side));
    // il riquadro «in attesa» è alto esattamente quanto telecomando + scorciatoie
    const fit = () => {
      if (!ready.isConnected) return;
      const hgt = sc.getBoundingClientRect().bottom - rc.getBoundingClientRect().top;
      ready.style.height = hgt > 0 ? hgt + 'px' : '';
    };
    requestAnimationFrame(fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(side);
  }

  function drawLive() {
    Q.clear(root);
    const q = curQ(), r = cur(), n = s.order.length, pos = s.idx;
    const withPeople = s.mode !== 'guided';   // punti e classifica
    const hasDraw = s.participants.length > 0; // sorteggio

    const top = h('div', { class: 'live-top' },
      h('div', { class: 'live-title' },
        h('h2', null, s.quizTitle),
        h('span', { class: 'live-mode' }, Q.MODES[s.mode] + (s.className ? ' · ' + s.className : '')),
        codeChip()),
      h('div', { class: 'actions' },
        sessionsBtn(),
        h('button', { class: 'btn ghost', title: 'Suoni sulla LIM', onclick: () => { s.settings.sound = !s.settings.sound; commit(); } }, s.settings.sound ? '🔊 Suoni attivi' : '🔇 Suoni spenti'),
        withPeople ? h('button', { class: 'btn' + (s.overlay === 'leaderboard' ? ' active' : ''), onclick: toggleLb }, s.overlay === 'leaderboard' ? '🏆 Nascondi classifica (L)' : '🏆 Classifica sulla LIM (L)') : null,
        h('button', { class: 'btn danger', onclick: endQuiz }, 'Concludi quiz')));

    const nav = h('aside', { class: 'qnav' }, h('div', { class: 'flabel' }, 'Domande'), s.order.map((qi, i) => {
      const qq = s.quiz.questions[qi];
      const rr = s.responses[i];
      let st = '';
      if (rr && (rr.revealed || rr.confirmed) && rr.status) st = ' st-' + rr.status;
      else if (rr) st = ' st-seen';
      return h('button', { class: 'qnav-item' + (i === pos ? ' current' : '') + st, title: Q.plainText(qq.text), onclick: () => enterQuestion(i) },
        h('span', { class: 'qn' }, i + 1), h('span', { class: 'qt' }, Q.TYPE_ICONS[qq.type] + ' ' + Q.plainText(qq.text)));
    }));

    const center = h('section', { class: 'live-center' });
    center.append(h('div', { class: 'qhead' },
      h('span', { class: 'pill' }, `Domanda ${pos + 1} di ${n}`),
      h('span', { class: 'pill ghost' }, Q.TYPE_ICONS[q.type] + ' ' + Q.TYPES[q.type])));
    center.append(h('div', { class: 'control-row' + (hasDraw ? '' : ' single') }, hasDraw ? whoBar(r) : null, timerBar(r)));
    previewRoot = h('div', { class: 'qroot' });
    center.append(h('div', { class: 'card preview' },
      h('div', { class: 'preview-label' }, 'Come sulla LIM — puoi inserire la risposta anche da qui'),
      previewRoot));
    drawPreview();
    center.append(revealBar(r));

    const side = h('aside', { class: 'live-side' });
    // prima gli elementi a dimensione fissa (telecomando, scorciatoie), poi quelli variabili
    side.append(remoteCard());
    side.append(shortcutsCard(hasDraw, withPeople));
    side.append(h('div', { class: 'card soft' }, h('div', { class: 'flabel' }, '🔑 Soluzione (solo per te)'), h('div', { class: 'solution' }, Q.solutionText(q)),
      hasExpl(q) ? h('div', { class: 'expl-note' }, h('div', { class: 'flabel' }, '📖 Spiegazione'), h('div', { class: 'rich', html: Q.richHtml(q.explanation) })) : null));
    if (withPeople) side.append(standingsCard(r));

    root.append(top, h('div', { class: 'live-grid' }, nav, center, side));
  }

  function drawPreview() {
    if (!previewRoot || !s) return;
    const r = cur();
    Q.renderQuestion(previewRoot, curQ(), s.views[s.idx], {
      key: s.id + ':' + s.idx,
      answer: r.answer,
      reveal: !!r.revealed,
      explain: !!r.revealed,
      stepMarks: r.revealed && r.steps ? r.steps : null,
      confirmed: !!r.confirmed,
      onConfirm: (a) => confirmAnswer(a, sync.id),
      onChange: (a, silent) => { setAnswer(a, sync.id, true); if (!silent) drawPreview(); },
    });
  }

  /* Chi risponde: tutto su una riga */
  function whoBar(r) {
    const locked = r.revealed || r.confirmed;
    let pool = s.participants;
    const t = s.mode === 'teams' ? teamOf(r.tid) : null;
    if (s.mode === 'teams') pool = t ? s.participants.filter((p) => t.members.includes(p.id)) : [];
    const left = s.settings.eliminate ? pool.filter((p) => !s.drawn.includes(p.id)).length : null;
    return h('div', { class: 'who-bar' },
      s.mode === 'teams'
        ? Q.setVal(h('select', { class: 'team-select', style: { '--tc': t ? t.color : null }, title: 'Squadra di turno', disabled: locked, onchange: (e) => { r.tid = e.target.value; if (r.pid) s.drawn = s.drawn.filter((id) => id !== r.pid); r.pid = null; s.draw = null; commit(); } },
          s.teams.map((x) => h('option', { value: x.id }, x.name))), r.tid)
        : null,
      h('div', { class: 'who-main' },
        h('span', { class: 'bar-label' }, 'Risponde' + (left != null ? ` · ${left} da sorteggiare` : '')),
        h('strong', { class: 'who-name', title: r.pid ? nameOf(r.pid) : '' }, r.pid ? nameOf(r.pid) : s.mode === 'teams' ? 'tutta la squadra' : '—')),
      Q.setVal(h('select', { class: 'who-pick', title: 'Scegli a mano', disabled: locked, onchange: (e) => assign(e.target.value || null) },
        h('option', { value: '' }, 'Scegli…'),
        pool.map((p) => h('option', { value: p.id }, p.name + (s.drawn.includes(p.id) && p.id !== r.pid ? ' ✓' : '')))), r.pid || ''),
      h('button', { class: 'btn primary', disabled: locked, onclick: doDraw, title: r.pid ? 'Risorteggia (S)' : 'Sorteggia (S)' }, '🎲 ' + (r.pid ? 'Ancora' : 'Sorteggia')));
  }

  /* Timer: tutto su una riga, pulsanti compatti */
  function timerBar(r) {
    const t = s.timer;
    const ib = (label, title, onclick, cls, disabled) => h('button', { class: 'btn icon ' + (cls || ''), title, onclick, disabled: !!disabled }, label);
    const bar = h('div', { class: 'timer-bar' + (t.expired ? ' expired' : '') },
      h('span', { class: 'bar-label' }, 'Timer'),
      h('span', { class: 'tdisp', id: 'tdisp' }, fmtTime(remaining())));
    const btns = h('div', { class: 'tbtns' });
    if (t.duration > 0) {
      btns.append(t.running
        ? ib('⏸', 'Pausa (T)', pauseTimer)
        : ib('▶', 'Avvia (T)', startTimer, '', r.revealed || r.confirmed));
      btns.append(ib('↺', 'Ricomincia dal tempo della domanda', resetTimer));
      btns.append(ib('+10', 'Aggiungi 10 secondi', () => addTime(10)));
      btns.append(ib('⏹', 'Interrompi timer (X)', removeTimer, 'danger'));
    } else {
      btns.append(ib('+30 s', 'Aggiungi un timer di 30 secondi', () => addTime(30), 'wide'));
      btns.append(ib('+1 min', 'Aggiungi un timer di 1 minuto', () => addTime(60), 'wide'));
    }
    bar.append(btns);
    return bar;
  }

  /* Barra in basso: a sinistra l'esito, a destra Precedente + pulsante principale (Conferma e correggi → Successiva) */
  function revealBar(r) {
    const pos = s.idx, n = s.order.length;
    const isOpen = curQ().type === 'open';
    const left = h('div', { class: 'rb-left' });
    const right = h('div', { class: 'rb-right' });
    const prevBtn = h('button', { class: 'btn big-ish', disabled: pos === 0, title: 'Domanda precedente (←)', onclick: () => enterQuestion(pos - 1) }, '← Precedente');

    const q = curQ();
    const scoring = s.mode !== 'guided' && s.settings.scoring.enabled;
    if (q.type === 'calc') {
      const marks = r.steps || [];
      left.append(h('span', { class: 'bar-label' }, 'Passaggi'), ...(q.steps || []).map((x, i) => h('button', {
        class: 'btn seg step-toggle ' + (marks[i] ? 'st-correct active' : r.stepsSet || r.revealed ? 'st-wrong' : ''),
        title: x.label + ' = ' + x.value + (x.unit ? ' ' + x.unit : ''), onclick: () => toggleStep(i),
      }, (i + 1) + ' ' + (marks[i] ? '✔' : '✘'))));
      if (scoring) left.append(h('span', { class: 'chip' }, `${Q.fmtNum(r.points || 0)} pt`));
      left.append(h('button', { class: 'btn ghost', title: 'Sblocca la risposta, annulla l’esito e fa ripartire il timer', onclick: reopenAnswer }, '↺ Riapri'));
      if (!r.revealed) {
        right.append(prevBtn, q.board || r.confirmed
          ? h('button', { class: 'btn success big main-action', onclick: reveal }, '✔ Mostra correzione (Invio)')
          : h('button', { class: 'btn success big main-action', onclick: () => confirmAnswer() }, '✔ Conferma e correggi (Invio)'));
      } else {
        right.append(prevBtn, h('button', { class: 'btn primary big main-action', onclick: next }, s.idx >= s.order.length - 1 ? 'Concludi quiz 🏁 (Invio)' : 'Successiva → (Invio)'));
      }
      return h('div', { class: 'reveal-bar' }, left, right);
    }
    if (!r.revealed && !r.confirmed) {
      left.append(h('span', { class: 'bar-label' }, 'Esito diretto'),
        ...[['correct', '✔ Corretta'], ['wrong', '✘ Errata'], ['blank', '— Vuota']].map(([k, l]) => h('button', { class: 'btn seg st-' + k, title: Q.STATUS[k].label, onclick: () => setStatus(k) }, l)));
      if (isOpen) left.append(h('span', { class: 'muted small' }, '«Risposto» ferma il timer; la risposta attesa compare quando scegli l’esito.'));
      right.append(prevBtn);
      if (!stepPending()) right.append(h('button', { class: 'btn ghost', title: 'Passa oltre senza correggere (→)', onclick: next }, pos < n - 1 ? 'Salta' : 'Concludi'));
      right.append(h('button', { class: 'btn success big main-action', onclick: () => confirmAnswer() }, isOpen ? '✔ Risposto (Invio)' : '✔ Conferma e correggi (Invio)'));
      return h('div', { class: 'reveal-bar' }, left, right);
    }

    const waitingGrade = isOpen && !r.revealed;
    left.append(h('span', { class: 'bar-label' }, 'Esito'),
      ...[['correct', '✔ Corretta'], ['wrong', '✘ Errata'], ['blank', '— Vuota']].map(([k, l]) => h('button', { class: 'btn seg st-' + k + (r.status === k ? ' active' : ''), onclick: () => setStatus(k) }, l)));
    if (r.status === 'pending') left.append(h('span', { class: 'tag st-pending' }, 'Scegli l’esito'));
    if (scoring && r.status !== 'pending') {
      left.append(h('label', { class: 'inline' }, 'Punti ',
        h('input', { type: 'number', class: 'w-num', step: 0.25, value: r.points, onchange: (e) => { r.points = parseFloat(e.target.value) || 0; commit(); } })));
    }
    if (r.timedOut) left.append(h('span', { class: 'tag st-blank' }, '⏱ Tempo scaduto'));
    left.append(h('button', { class: 'btn ghost', title: 'Sblocca la risposta, annulla l’esito e fa ripartire il timer', onclick: reopenAnswer }, '↺ Riapri'));
    right.append(prevBtn,
      h('button', { class: 'btn primary big main-action', disabled: waitingGrade, title: waitingGrade ? 'Scegli prima l’esito' : '', onclick: next },
        pos >= n - 1 ? 'Concludi quiz 🏁 (Invio)' : 'Successiva → (Invio)'));
    return h('div', { class: 'reveal-bar' }, left, right);
  }

  function standingsCard(r) {
    const rows = Q.standings(s);
    const scoring = s.settings.scoring.enabled;
    const curId = s.mode === 'teams' ? r.tid : r.pid;
    return h('div', { class: 'card soft' },
      h('div', { class: 'flabel' }, s.mode === 'teams' ? 'Classifica squadre' : 'Classifica'),
      h('table', { class: 'mini' }, h('tbody', null, rows.map((e) => h('tr', { class: e.id === curId ? 'hl' : '' },
        h('td', { class: 'rk' }, e.rank),
        h('td', null, e.color ? h('i', { class: 'dot', style: { background: e.color } }) : null, e.name,
          s.mode === 'students' && s.drawn.includes(e.id) ? h('span', { class: 'drawn', title: 'Già sorteggiato' }, ' ✓') : null),
        h('td', { class: 'num strong' }, scoring ? Q.fmtNum(e.points) : e.correct),
        h('td', { class: 'num muted small' }, `${e.correct}/${e.answered}`))))));
  }

  function drawEnd() {
    Q.clear(root);
    root.append(h('div', { class: 'live-top' },
      h('div', { class: 'live-title' }, h('h2', null, s.quizTitle), h('span', { class: 'live-mode' }, 'Quiz concluso · ' + Q.MODES[s.mode]), codeChip()),
      h('div', { class: 'actions' }, sessionsBtn())));
    const card = h('div', { class: 'card' },
      h('p', { class: 'muted small' }, 'Sulla LIM è visibile la schermata finale. La sessione è già salvata nello storico.'));
    if (s.mode !== 'guided') card.append(Q.History.standingsTable(s));
    else {
      const rs = Object.values(s.responses).filter((x) => x.revealed || x.confirmed);
      card.append(h('p', null, `Domande corrette insieme: ${rs.filter((x) => x.status === 'correct').length} su ${s.order.length}`));
    }
    card.append(h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: reopen }, '← Torna alle domande'),
      s.mode !== 'guided' ? h('button', { class: 'btn', onclick: () => Q.History.exportCsv(s, 'standings') }, '⬇ CSV classifica') : null,
      h('button', { class: 'btn', onclick: () => Q.History.exportCsv(s, 'detail') }, '⬇ CSV dettaglio'),
      h('button', { class: 'btn primary', onclick: closeSession }, 'Chiudi sessione')));
    root.append(card);
  }

  return {
    init, onMessage, render,
    preselect(id) { pendingQuiz = id; },
    sessionIdFor: (code) => { const x = activeList().find((y) => y.code === code); return x ? x.id : null; },
    limConnected: () => Date.now() - limSeen < 5000,
    hasSession: () => activeList().some((x) => x.status === 'live'),
    netInfo: () => netInfoOf(),
  };
})();
