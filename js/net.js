/* Rete: collegamento diretto (P2P, WebRTC tramite PeerJS) tra la regia e i dispositivi
   che entrano con il codice della sessione: /live (proiezione) e /remote (telecomando).
   Il server PeerJS serve solo a far trovare i dispositivi; i dati vanno da dispositivo a dispositivo. */
(function (Q) {
  'use strict';
  const PREFIX = 'quizlim-v1-';
  const available = () => typeof window.Peer === 'function';

  /* ---------- Regia: accetta i collegamenti (uno per sessione) ---------- */
  Q.NetHost = function (onMessage, onChange) {
    let peer = null, code = null, retryT = null, stopped = false;
    const conns = new Set();

    const counts = () => {
      let live = 0, remote = 0;
      for (const c of conns) if (c.open) { if (c.metadata && c.metadata.role === 'remote') remote++; else live++; }
      return { live, remote };
    };
    const notify = (status) => onChange && onChange(Object.assign({ code, status }, counts()));

    function start(newCode) {
      if (!available()) { notify('offline'); return; }
      if (code === newCode && peer && !peer.destroyed) return;
      stop(true);
      stopped = false;
      code = newCode;
      open();
    }
    function open(attempt = 0) {
      clearTimeout(retryT);
      peer = new window.Peer(PREFIX + code, { debug: 0 });
      notify('connecting');
      peer.on('open', () => notify('online'));
      peer.on('connection', (c) => {
        c.on('open', () => { conns.add(c); notify('online'); });
        c.on('data', (m) => onMessage(m));
        c.on('close', () => { conns.delete(c); notify('online'); });
        c.on('error', () => { conns.delete(c); notify('online'); });
      });
      peer.on('disconnected', () => { if (!stopped && peer && !peer.destroyed) { notify('connecting'); try { peer.reconnect(); } catch (e) { /* ignora */ } } });
      peer.on('error', (err) => {
        if (stopped) return;
        if (err.type === 'unavailable-id' && attempt < 10) {
          // il codice è ancora registrato da una pagina appena ricaricata: riprova tra poco
          try { peer.destroy(); } catch (e) { /* ignora */ }
          retryT = setTimeout(() => open(attempt + 1), 3000);
          notify('connecting');
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          notify('offline');
          try { peer.destroy(); } catch (e) { /* ignora */ }
          retryT = setTimeout(() => open(attempt + 1), 5000);
        }
      });
    }
    function stop(silent) {
      stopped = true;
      clearTimeout(retryT);
      for (const c of conns) { try { c.close(); } catch (e) { /* ignora */ } }
      conns.clear();
      if (peer) { try { peer.destroy(); } catch (e) { /* ignora */ } }
      peer = null;
      code = null;
      if (!silent) notify('stopped');
    }
    const send = (m) => { for (const c of conns) if (c.open) { try { c.send(m); } catch (e) { /* ignora */ } } };
    return { start, stop, send, counts, get code() { return code; } };
  };

  /* ---------- Dispositivo: si collega alla regia con il codice ---------- */
  Q.NetJoin = function (sync, role, onStatus) {
    let peer = null, conn = null, code = null, retryT = null, wanted = false;
    const transport = { send(m) { if (conn && conn.open) conn.send(m); } };
    sync.addTransport(transport);

    function connect(c) {
      code = c;
      wanted = true;
      if (!available()) { onStatus('offline'); return; }
      onStatus('connecting');
      const go = () => {
        conn = peer.connect(PREFIX + code, { reliable: true, metadata: { role } });
        let opened = false;
        conn.on('open', () => { opened = true; onStatus('connected'); sync.send('hello', { role }); });
        conn.on('data', (m) => sync.receive(m));
        conn.on('close', () => { if (wanted) { onStatus('lost'); retry(); } });
        conn.on('error', () => { if (wanted && !opened) { onStatus('lost'); retry(); } });
      };
      if (peer && peer.open) go();
      else {
        if (peer) { try { peer.destroy(); } catch (e) { /* ignora */ } }
        peer = new window.Peer({ debug: 0 });
        peer.on('open', go);
        peer.on('error', (err) => {
          if (err.type === 'peer-unavailable') { onStatus('notfound'); retry(5000); }
          else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) { onStatus('offline'); retry(5000); }
        });
        peer.on('disconnected', () => { if (wanted && peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignora */ } } });
      }
    }
    function retry(ms = 3000) {
      clearTimeout(retryT);
      retryT = setTimeout(() => { if (wanted) connect(code); }, ms);
    }
    function leave() {
      wanted = false;
      clearTimeout(retryT);
      try { if (conn) conn.close(); } catch (e) { /* ignora */ }
      try { if (peer) peer.destroy(); } catch (e) { /* ignora */ }
      conn = null; peer = null;
    }
    return { connect, leave, get code() { return code; } };
  };

})(window.Q);
