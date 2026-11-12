/* Avvio della regia: navigazione tra le sezioni, finestra LIM, backup */
(function () {
  'use strict';
  const h = Q.h;
  const view = document.getElementById('view');
  let limWin = null;

  Q.sync = Q.Sync('regia', (m) => Q.Live.onMessage(m));

  async function route() {
    const [tab0, id] = location.hash.replace(/^#/, '').split('/');
    const tab = tab0 || (Q.Live.hasSession() ? 'live' : 'quiz');
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    Q.clear(view);
    document.body.classList.remove('fit-screen');
    view.className = 'view-' + tab;
    switch (tab) {
      case 'quiz': return id ? Q.Editor.renderEdit(view, id) : Q.Editor.renderList(view);
      case 'classi': return Q.Classes.render(view);
      case 'live': return Q.Live.render(view, id);
      case 'storico': return Q.History.render(view, id);
      case 'backup': return renderBackup(view);
      default: location.hash = '#quiz';
    }
  }

  /* ---------- Finestra LIM ---------- */
  /* Secondo schermo: true/false se il browser lo sa (Chrome/Edge), null se non lo sa */
  const hasSecondScreen = () => (typeof window.screen.isExtended === 'boolean' ? window.screen.isExtended : null);
  let screenDetails = null;
  async function loadScreenDetails(ask) {
    if (!('getScreenDetails' in window)) return null;
    try {
      if (!ask && navigator.permissions) {
        const p = await navigator.permissions.query({ name: 'window-management' });
        if (p.state !== 'granted') return null;
      }
      screenDetails = await window.getScreenDetails();
    } catch (e) { screenDetails = null; }
    return screenDetails;
  }
  loadScreenDetails(false); // se il permesso c'è già, prepara gli schermi senza chiedere nulla
  const otherScreen = (sd) => sd && (sd.screens.find((x) => x !== sd.currentScreen && !x.isPrimary) || sd.screens.find((x) => x !== sd.currentScreen));

  async function openLim() {
    const extended = hasSecondScreen();
    let sd = screenDetails;
    if (extended && !sd) sd = await loadScreenDetails(true); // la prima volta il browser chiede il permesso
    const other = extended ? otherScreen(sd) : null;
    let url = 'lim.html';
    let features = 'popup=yes,width=1280,height=800';
    if (other) {
      // «Proietta»: finestra a tutto schermo sullo schermo dove non c'è la regia
      url = 'lim.html?fs=1';
      features = `popup=yes,fullscreen=yes,left=${other.left},top=${other.top},width=${other.width},height=${other.height}`;
      if (limWin && !limWin.closed) limWin.close();
    }
    limWin = window.open(url, 'quizlim-schermo', features);
    if (!limWin) { Q.toast('Il browser ha bloccato la finestra: consenti i popup per questa pagina e premi di nuovo', 'error'); return; }
    Q.sync.setPeer(limWin);
    if (other) Q.toast('Proiezione sul secondo schermo avviata', 'ok');
    else if (extended && !other) Q.toast('Consenti al browser di gestire le finestre sugli schermi, poi premi di nuovo «Proietta»', 'info');
    else Q.toast('Schermo aperto in una finestra: collega la LIM per proiettarlo a schermo intero', 'info');
  }
  document.getElementById('btn-open-lim').addEventListener('click', openLim);

  function updateStatus() {
    const el = document.getElementById('lim-status');
    const btn = document.getElementById('btn-open-lim');
    const extended = hasSecondScreen();
    const windowOn = Q.Live.limConnected();
    const net = Q.Live.netInfo();
    // tre stati: non collegata / collegata al PC (secondo schermo) / remota (link con codice)
    const pc = extended === true || (extended === null && windowOn);
    const remote = net.live > 0;
    let label, kind;
    if (pc && remote) { kind = 'pc'; label = '● LIM collegata (PC) + remota (link)'; }
    else if (pc) { kind = 'pc'; label = '● LIM collegata (PC)'; }
    else if (remote) { kind = 'remote'; label = '● LIM remota (link)'; }
    else { kind = 'off'; label = 'LIM non collegata'; }
    el.textContent = label;
    el.className = 'lim-status ' + kind;

    btn.textContent = extended === true ? '📽 Proietta' : '🖥 Apri schermo';
    btn.title = extended === true ? 'Apre la LIM a schermo intero sul secondo schermo' : 'Apre lo schermo della LIM in una finestra';
    const live = document.querySelector('#tabs a[data-tab="live"]');
    live.classList.toggle('live-on', Q.Live.hasSession());
  }

  /* ---------- Backup ---------- */
  async function renderBackup(el) {
    const [qz, cl, se] = await Promise.all(['quizzes', 'classes', 'sessions'].map((s) => Q.store.all(s)));
    let usage = '', persisted = false;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        usage = (est.usage / 1048576).toFixed(1) + ' MB';
      }
      if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
    } catch (e) { /* non disponibile */ }
    let last = null;
    try { last = localStorage.getItem('quizlim.lastBackup'); } catch (e) { /* ignora */ }

    Q.clear(el);
    el.append(h('div', { class: 'page-head' }, h('h1', null, 'Backup e dati')));
    el.append(h('div', { class: 'card' },
      h('h3', null, 'Dove sono salvati i dati'),
      h('p', null, 'Quiz, classi e storico sono salvati nel database interno del browser (IndexedDB) su questo computer. Restano anche chiudendo il browser, ma non si spostano da soli su altri computer o browser: per farlo usa il backup.'),
      h('ul', { class: 'facts' },
        h('li', null, h('strong', null, qz.length), ' quiz · ', h('strong', null, cl.length), ' classi · ', h('strong', null, se.length), ' sessioni nello storico'),
        usage ? h('li', null, 'Spazio usato: ' + usage) : null,
        h('li', null, 'Protezione dalla pulizia automatica del browser: ', persisted ? h('strong', { class: 'ok' }, 'attiva ✓') : h('strong', { class: 'warn-text' }, 'non concessa — fai backup regolari')),
        h('li', null, 'Ultimo backup scaricato: ', last ? Q.fmtDate(+last) : h('strong', { class: 'warn-text' }, 'mai')))));
    el.append(h('div', { class: 'two-col even' },
      h('div', { class: 'card' },
        h('h3', null, '⬇ Esporta'),
        h('p', { class: 'muted' }, 'Scarica un unico file .json con tutti i quiz, le classi e lo storico.'),
        h('button', { class: 'btn primary', onclick: async () => {
          const data = await Q.store.exportAll();
          Q.download(`quiz-lim-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
          try { localStorage.setItem('quizlim.lastBackup', String(Date.now())); } catch (e) { /* ignora */ }
          renderBackup(el);
        } }, 'Scarica backup completo')),
      h('div', { class: 'card' },
        h('h3', null, '⬆ Importa'),
        h('p', { class: 'muted' }, '«Unisci» aggiunge e aggiorna i dati del file; «Sostituisci» cancella prima tutto.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => doImport(el, false) }, 'Unisci da file'),
          h('button', { class: 'btn danger', onclick: () => doImport(el, true) }, 'Sostituisci tutto')))));
  }

  async function doImport(el, replace) {
    const f = await Q.pickFile('.json,application/json');
    if (!f) return;
    try {
      const data = JSON.parse(await Q.readText(f));
      if (replace && !(await Q.confirm({ title: 'Sostituire tutti i dati?', message: 'Quiz, classi e storico attuali verranno cancellati e sostituiti con quelli del file.', ok: 'Sostituisci tutto', danger: true }))) return;
      await Q.store.importAll(data, replace);
      Q.toast('Backup importato', 'ok');
      renderBackup(el);
    } catch (e) {
      Q.toast('Importazione non riuscita: ' + e.message, 'error');
    }
  }

  /* ---------- Avvio ---------- */
  (async function boot() {
    Q.store.persist();
    try {
      await Q.Live.init(Q.sync);
    } catch (e) {
      view.append(h('div', { class: 'card warn' }, 'Impossibile aprire l’archivio del browser: ' + e.message));
      return;
    }
    // aperta da un link diretto /CODICE: va alla sessione di quel quiz
    const sp = new URLSearchParams(location.search).get('s');
    if (sp) {
      const code = Q.normCode(sp);
      history.replaceState(null, '', location.pathname + location.hash);
      const sid = Q.Live.sessionIdFor(code);
      if (sid) location.hash = '#live/' + sid;
      else Q.toast(`Nessuna sessione in corso con codice ${Q.fmtCode(code)} su questo computer`, 'error');
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', () => Q.Editor.flush());
    setInterval(updateStatus, 1000);
    updateStatus();
    route();
  })();
})();
