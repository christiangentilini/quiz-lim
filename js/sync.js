/* Comunicazione tra finestra regia e finestra LIM.
   Usa BroadcastChannel e, in aggiunta, postMessage diretto tra le finestre
   (così funziona anche aprendo i file con doppio clic, senza server). */
(function (Q) {
  'use strict';
  Q.Sync = function (role, onMessage) {
    const id = role + '-' + Q.uid();
    const seen = new Set();
    let peer = null;
    const transports = []; // trasporti aggiuntivi (rete P2P)
    let bc = null;
    try { bc = new BroadcastChannel('quiz-lim'); } catch (e) { bc = null; }

    function handle(m) {
      if (!m || m.__qlim !== 1 || m.from === id || seen.has(m.mid)) return;
      seen.add(m.mid);
      if (seen.size > 2000) seen.clear();
      onMessage(m);
    }
    if (bc) bc.onmessage = (e) => handle(e.data);
    window.addEventListener('message', (e) => handle(e.data));

    return {
      id,
      setPeer(w) { peer = w; },
      addTransport(t) { transports.push(t); },
      removeTransport(t) { const i = transports.indexOf(t); if (i >= 0) transports.splice(i, 1); },
      receive(m) { handle(m); },
      send(t, data) {
        const m = Object.assign({ __qlim: 1, t, mid: Q.uid(), from: id }, data || {});
        try { if (bc) bc.postMessage(m); } catch (e) { console.warn(e); }
        try {
          const p = peer && !peer.closed ? peer : window.opener;
          if (p && !p.closed) p.postMessage(m, '*');
        } catch (e) { /* finestra chiusa */ }
        for (const t of transports) { try { t.send(m); } catch (e) { console.warn(e); } }
      },
    };
  };
})(window.Q);
