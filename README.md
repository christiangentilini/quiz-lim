# Quiz LIM

Quiz interattivi in classe: la **regia** sul computer del docente, lo **schermo** sulla LIM.
Nessuna installazione, nessun account, funziona anche senza internet.

**Online:** https://christiangentilini.github.io/quiz-lim/ (LIM: `/live`, telecomando: `/remote`)

## Avvio

Apri `index.html` in Chrome o Edge (doppio clic), oppure da terminale nella cartella:

```bash
python3 tools/dev-server.py
```

e vai su http://localhost:8765

1. **Quiz** → crea un quiz (o «Quiz di esempio»)
2. **Classi** → incolla i nomi degli studenti, uno per riga
3. **🖥 Apri schermo LIM** → trascina la finestra sulla LIM e premi «Schermo intero»
4. **Sessione** → scegli quiz, modalità e presenti → Avvia

## Modalità

| Modalità | Chi risponde | Punti / classifica |
|---|---|---|
| Lezione guidata | tutta la classe, o sorteggio facoltativo | no |
| Interrogazione a sorteggio | uno studente sorteggiato | sì |
| Sfida a squadre | squadre a turno (+ sorteggio membro) | sì, per squadra |

## Tipi di domanda

Scelta multipla (anche più risposte corrette) · Vero/falso · Aperta (valutazione manuale) ·
Completamento `Il [[gatto]] dorme sul [[divano|sofà]]` · Tendina `[[corretta|errata|errata]]` · Collegamento ·
**Esercizio di calcolo**: sulla LIM solo il testo, si svolge alla lavagna; alla correzione compare la soluzione passo passo e in regia segni i passaggi giusti (punti per passaggio).

## Scorciatoie in regia

`Invio` conferma risposta · `→` successiva · `←` precedente · `C` conferma e correggi · `S` sorteggio · `T` timer · `L` classifica sulla LIM

Flusso di ogni domanda:
- **✔ Conferma** (LIM o regia, oppure `Invio`) chiude la risposta, ferma il timer, mostra l'esito con un'animazione e subito la correzione. Vero/falso si chiude al tocco; le aperte hanno **✔ Risposto** e l'esito lo scegli tu.
- **Tempo scaduto**: la risposta vale «vuota» e compare la correzione. `+10 s` o `↺ Ricomincia` la riaprono.
- **Successiva →** è anche sulla LIM, dopo la correzione.
- La **spiegazione** (facoltativa, per ogni tipo di domanda) compare subito insieme all'esito e alla soluzione.
- Con **«Correzione obbligatoria»** attiva, «Successiva» su una domanda senza risposta prima mostra la soluzione.

## Proiezione e telecomando

Ogni **sessione** ha un **codice di 6 caratteri**, nuovo a ogni avvio, visibile nell'intestazione della sua regia e sotto il QR del telecomando. **Più sessioni possono essere attive insieme** (Sessione → ☰ Sessioni → + Nuova sessione): ognuna ha codice, LIM remota e telecomando propri; la LIM di questo computer mostra la sessione aperta in regia. Una sessione non chiusa si conclude da sola dopo 24 ore.

| | Link diretto | Ingresso con codice |
|---|---|---|
| Regia della sessione | `sito/CODICE` | — |
| LIM remota | `sito/CODICE/live` | `sito/live` |
| Telecomando | `sito/CODICE/remote` (QR in regia) | `sito/remote` |

Stato LIM in regia: **non collegata** · **collegata (PC)** (secondo schermo; 📽 Proietta la apre a schermo intero) · **remota (link)**.

I link diretti funzionano grazie a `404.html` (GitHub Pages la usa per gli indirizzi sconosciuti). In locale usa `python3 tools/dev-server.py`, che fa lo stesso.

Il collegamento è diretto tra i dispositivi (P2P, WebRTC con PeerJS): il server pubblico di PeerJS serve solo a farli trovare. Serve internet; da altri dispositivi funziona quando l'app è pubblicata online.

## Dati

Salvati nel database del browser (IndexedDB) di questo computer. Per spostarli o non perderli:
**Backup → Scarica backup completo**. Tutto l'accesso ai dati passa da `js/store.js`:
per pubblicare con un archivio online basta sostituire quel modulo.

## File

- `index.html` + `js/app.js` — regia
- `lim.html` + `js/lim.js` — schermo LIM
- `js/widgets.js` — disegno e correzione delle domande
- `js/live.js` — conduzione della sessione
- `js/editor.js`, `js/classes.js`, `js/history.js` — editor, classi, storico
- `js/store.js` — archivio dati · `js/sync.js` — collegamento regia ↔ LIM
