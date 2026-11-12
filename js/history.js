/* Storico delle sessioni */
Q.History = (function () {
  'use strict';
  const h = Q.h;

  function standingsTable(s) {
    const rows = Q.standings(s);
    const scoring = s.settings.scoring.enabled;
    return h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', null, '#'), h('th', null, s.mode === 'teams' ? 'Squadra' : 'Studente'),
        scoring ? h('th', { class: 'num' }, 'Punti') : null,
        h('th', { class: 'num' }, '✔ Corrette'), h('th', { class: 'num' }, '✘ Errate'), h('th', { class: 'num' }, '— Vuote'))),
      h('tbody', null, rows.map((e) => h('tr', null,
        h('td', null, e.rank),
        h('td', null, e.color ? h('i', { class: 'dot', style: { background: e.color } }) : null, e.name,
          s.mode === 'teams' ? h('div', { class: 'small muted' }, ((s.teams.find((t) => t.id === e.id) || {}).members || []).map((id) => (s.participants.find((p) => p.id === id) || {}).name).join(', ')) : null),
        scoring ? h('td', { class: 'num strong' }, Q.fmtNum(e.points)) : null,
        h('td', { class: 'num' }, e.correct), h('td', { class: 'num' }, e.wrong), h('td', { class: 'num' }, e.blank)))));
  }

  function whoText(s, r) {
    if (!r) return '';
    const p = (s.participants.find((x) => x.id === r.pid) || {}).name || '';
    if (s.mode === 'teams') { const t = s.teams.find((x) => x.id === r.tid); return (t ? t.name : '') + (p ? ' · ' + p : ''); }
    return p;
  }

  function detailRows(s) {
    return s.order.map((qi, pos) => {
      const q = s.quiz.questions[qi];
      const r = s.responses[pos];
      return { pos, q, r, who: whoText(s, r), answer: r ? Q.answerText(q, r.answer) : '', status: r && (r.revealed || r.confirmed) ? r.status : null, points: r && (r.revealed || r.confirmed) ? r.points : null };
    });
  }

  function exportCsv(s, kind) {
    const base = Q.slug(s.quizTitle) + '-' + new Date(s.createdAt).toISOString().slice(0, 10);
    if (kind === 'detail') {
      const rows = [['N.', 'Domanda', 'Tipo', 'Risponde', 'Risposta data', 'Esito', 'Punti']];
      detailRows(s).forEach((d) => rows.push([d.pos + 1, Q.plainText(d.q.text), Q.TYPES[d.q.type], d.who, d.answer, d.status ? Q.STATUS[d.status].label : '', d.points == null ? '' : Q.fmtNum(d.points)]));
      Q.download(base + '-dettaglio.csv', Q.csv(rows), 'text/csv');
    } else {
      const scoring = s.settings.scoring.enabled;
      const rows = [['Posizione', s.mode === 'teams' ? 'Squadra' : 'Studente'].concat(scoring ? ['Punti'] : [], ['Corrette', 'Errate', 'Vuote'])];
      Q.standings(s).forEach((e) => rows.push([e.rank, e.name].concat(scoring ? [Q.fmtNum(e.points)] : [], [e.correct, e.wrong, e.blank])));
      Q.download(base + '-classifica.csv', Q.csv(rows), 'text/csv');
    }
  }

  async function render(el, id) {
    const sessions = (await Q.store.all('sessions')).sort((a, b) => b.createdAt - a.createdAt);
    Q.clear(el);
    if (id) {
      const s = sessions.find((x) => x.id === id);
      if (!s) { location.hash = '#storico'; return; }
      return renderDetail(el, s);
    }
    el.append(h('div', { class: 'page-head' }, h('h1', null, 'Storico sessioni')));
    if (!sessions.length) {
      el.append(h('div', { class: 'empty card' }, h('p', { class: 'muted' }, 'Le sessioni svolte in classe compariranno qui, con risultati e classifiche esportabili.')));
      return;
    }
    el.append(h('div', { class: 'card' }, h('table', { class: 'table hover' },
      h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Quiz'), h('th', null, 'Modalità'), h('th', null, 'Classe'), h('th', { class: 'num' }, 'Domande'), h('th', null, 'Stato'))),
      h('tbody', null, sessions.map((s) => h('tr', { onclick: () => { location.hash = s.status === 'live' ? '#live/' + s.id : '#storico/' + s.id; } },
        h('td', null, Q.fmtDate(s.createdAt)),
        h('td', { class: 'strong' }, s.quizTitle),
        h('td', null, Q.MODES[s.mode]),
        h('td', null, s.className || '—'),
        h('td', { class: 'num' }, `${Object.values(s.responses).filter((r) => r.revealed || r.confirmed).length}/${s.order.length}`),
        h('td', null, s.status === 'live' ? h('span', { class: 'tag live' }, '● in corso') : h('span', { class: 'tag' }, 'conclusa'))))))));
  }

  function renderDetail(el, s) {
    el.append(h('div', { class: 'page-head' },
      h('a', { href: '#storico', class: 'btn ghost' }, '← Storico'),
      h('div', { class: 'actions' },
        s.mode !== 'guided' ? h('button', { class: 'btn', onclick: () => exportCsv(s, 'standings') }, '⬇ CSV classifica') : null,
        h('button', { class: 'btn', onclick: () => exportCsv(s, 'detail') }, '⬇ CSV dettaglio'),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!(await Q.confirm({ title: 'Eliminare questa sessione?', message: 'Verrà tolta dallo storico insieme ai risultati.', ok: 'Elimina', danger: true }))) return;
          await Q.store.del('sessions', s.id);
          location.hash = '#storico';
        } }, 'Elimina'))));
    el.append(h('div', { class: 'card' },
      h('div', { class: 'kicker' }, Q.MODES[s.mode] + (s.className ? ' · ' + s.className : '')),
      h('h2', null, s.quizTitle),
      h('div', { class: 'muted small' }, `Iniziata ${Q.fmtDate(s.createdAt)}` + (s.endedAt ? ` · conclusa ${Q.fmtDate(s.endedAt)}` : ''))));
    if (s.mode !== 'guided') el.append(h('div', { class: 'card' }, h('h3', null, 'Classifica'), standingsTable(s)));
    const scoring = s.mode !== 'guided' && s.settings.scoring.enabled;
    el.append(h('div', { class: 'card' }, h('h3', null, 'Domanda per domanda'), h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'N.'), h('th', null, 'Domanda'), s.participants.length ? h('th', null, 'Risponde') : null, h('th', null, 'Risposta data'), h('th', null, 'Esito'), scoring ? h('th', { class: 'num' }, 'Punti') : null)),
      h('tbody', null, detailRows(s).map((d) => h('tr', null,
        h('td', null, d.pos + 1),
        h('td', null, h('div', { class: 'small muted' }, Q.TYPE_ICONS[d.q.type] + ' ' + Q.TYPES[d.q.type]), Q.plainText(d.q.text)),
        s.participants.length ? h('td', null, d.who || '—') : null,
        h('td', null, d.answer || h('span', { class: 'muted' }, '—')),
        h('td', null, d.status ? h('span', { class: 'tag st-' + d.status }, Q.STATUS[d.status].icon + ' ' + Q.STATUS[d.status].label) : h('span', { class: 'muted' }, 'non corretta')),
        scoring ? h('td', { class: 'num' }, d.points == null ? '' : Q.fmtNum(d.points)) : null))))));
  }

  return { render, standingsTable, exportCsv };
})();
