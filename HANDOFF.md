# Recap progetto: Parcheggio Firenze (per nuova chat)

## Cos'è

App web (PWA) che usa il dataset open data "Pulizia Strade" del Comune di
Firenze/Alia SpA per dire all'utente se/quando una via è soggetta a
spazzamento (divieto di sosta), con funzione "ho parcheggiato qui" +
sveglia/notifica push per ricordare di spostare l'auto prima dello
spazzamento.

- **Repo GitHub (pubblico)**: https://github.com/pierogas/parcheggio-firenze
- **Sito live**: https://pierogas.github.io/parcheggio-firenze/
- **Account GitHub**: pierogas (email rumpietro@gmail.com)
- **Account Cloudflare**: rumpietro@gmail.com (Worker: `parcheggio-firenze-push`,
  URL `https://parcheggio-firenze-push.rumpietro.workers.dev`)
- Cartella locale progetto: `C:\Users\39340\ParcheggioFirenze`
- Dataset sorgente: `C:\Users\39340\Downloads\Pulizia_Strade (2)\...\pulizia_strade.kmz`

## Ambiente locale (Windows, inizialmente senza Python/Node)

Durante la sessione ho installato via `winget`:
- **Node.js LTS** (per script/worker/generazione icone)
- **GitHub CLI** (`gh`, autenticato come pierogas)
- Perl era già presente (Git Bash/MSYS) — usato per `convert_kml.pl`

Server locale: `serve.ps1` (PowerShell, static file server) — configurato in
`C:\Users\39340\.claude\launch.json` come "parcheggio-firenze" (porta 5501).
Da PowerShell, `npx` può richiedere `cmd` invece di PowerShell per problemi
di Execution Policy.

## Architettura

1. **Frontend statico** (`index.html`, `app.js`, `style.css`, `logic.js`,
   `data.js`, `manifest.json`, `sw.js`) pubblicato su **GitHub Pages**
   (branch main, root `/`).
2. **`logic.js`**: logica di calcolo pulizia/date condivisa tra browser
   (via `<script>`) e Node (via `require`, usata da `scripts/send-push.js`).
   Contiene `ruleMatchesDate`, `evaluateSegment`, `describeFrequency`, ecc.
3. **`data.js`**: dataset generato da `convert_kml.pl` (Perl) a partire dal
   KMZ di Comune Firenze. Da rigenerare se il dataset ufficiale si aggiorna:
   `perl convert_kml.pl "<path kml estratto>" data.js`
4. **Push reale** (arriva anche ad app/browser chiuso):
   - Client (`app.js`) crea una `PushSubscription` (VAPID) e la invia a...
   - **Cloudflare Worker** (`worker/src/index.js`) + **KV** (`PARKED_CARS`,
     namespace id `049ca41e555142508f9c51070b695d71`): salva le iscrizioni
     (via/tratto/leadHours/lastNotifiedStart per deviceId). Endpoint:
     `POST /subscribe`, `POST /unsubscribe`, `GET /list` (auth), 
     `POST /mark-notified` (auth), `GET /status?deviceId=` (pubblico, usato
     dal client per sapere se il server ha già notificato),
     `POST /test-push` (pubblico: segna testRequestedAt, il tick successivo
     invia una notifica di prova — pulsante "📬 Prova notifica" nell'app),
     `POST /clear-test` (auth).
   - **Cloudflare Cron Trigger** (`worker/wrangler.toml`, **`*/5 * * * *`,
     NON CAMBIARE a meno di 5 minuti — vedi limiti sotto): il worker si
     "sveglia" e chiama l'API GitHub (`workflow_dispatch`) per far partire...
   - **GitHub Actions** (`.github/workflows/send-reminders.yml`) esegue
     `scripts/send-push.js` (Node): legge le iscrizioni dal Worker, calcola
     chi è "dovuto" con `logic.js`, invia il push vero con la libreria
     `web-push` (VAPID), con `{ urgency: 'high', TTL: 21600 }`.

## Segreti configurati (non ri-creare, sono già a posto)

- **GitHub Actions secrets** (repo pierogas/parcheggio-firenze):
  `WORKER_URL`, `WORKER_SHARED_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- **Cloudflare Worker secrets**: `WORKER_SHARED_SECRET` (stesso valore di
  sopra), `GITHUB_TOKEN` (fine-grained PAT creato dall'utente, scope SOLO
  sul repo parcheggio-firenze, permesso "Actions: Read and write" — usato
  dal Worker per il `workflow_dispatch`)
- Chiave pubblica VAPID è anche hardcoded in `app.js` (è pubblica per design)

⚠️ Se serve rigenerare/toccare secret: **non mettere mai il valore reale in
un comando bash/tool call** — un classificatore di sicurezza blocca
l'esposizione di credenziali nei log. Per operazioni che richiedono
incollare un secret vero (es. `wrangler secret put`), far eseguire il
comando **all'utente nel suo terminale**, non tramite tool call.

## Limiti/vincoli importanti scoperti durante lo sviluppo

1. **GitHub Actions `schedule:` è inaffidabile sui piani gratuiti**: veniva
   ritardato anche di ore invece di girare ogni 15 min. Risolto delegando il
   "tick" al Cron Trigger di Cloudflare (affidabile), che poi chiama
   `workflow_dispatch` su GitHub (dispatch on-demand è molto più puntuale
   dello `schedule` nativo).
2. **Cloudflare KV free tier ha una quota di 1.000 operazioni "list" al
   giorno**, separata (e molto più bassa) di quella lettura/scrittura
   (100k/giorno). Il Worker fa una `list()` per ogni tick del Cron Trigger:
   a 1/minuto si superano le 1.000/giorno (arrivati al 50% in poche ore,
   avviso di Cloudflare). **Il Cron è fissato a `*/5 * * * *` apposta — non
   scendere sotto i 5 minuti.**
3. **Fuso orario nel workflow GitHub Actions**: il runner gira in UTC, non
   Europe/Rome. Senza `TZ: Europe/Rome` nell'env dello step, i calcoli di
   data/ora (basati su `Date` locale in `logic.js`) sfasavano di 1-2 ore.
   Già impostato nel workflow YAML — non rimuovere.
4. **Interpretazione dei flag `pari`/`dispari` del dataset**: NON è la
   settimana ISO dell'anno (mia ipotesi iniziale sbagliata), ma la **parità
   del numero di calendario del giorno del mese** (1-31), confermato via
   ricerca web su fonti ufficiali Alia/Comune Firenze. Vedi `ruleMatchesDate`
   in `logic.js` per l'implementazione corretta.
5. **Cache HTTP di GitHub Pages** (`Cache-Control: max-age=600`, 10 minuti):
   il Service Worker deve usare `fetch(req, {cache:'no-store'})` per non
   rischiare di servire contenuto stantio nella finestra dei 10 minuti dopo
   un deploy. Già corretto in `sw.js`.
6. **Priorità push Android**: `web-push` di default invia con urgenza
   "normal", che Android può ritardare/accantonare in modalità Doze/risparmio
   energetico se il telefono è inattivo. Impostato `urgency:'high'` in
   `scripts/send-push.js` — **da verificare con l'utente se questo ha
   davvero risolto i mancati recapiti "spesso" segnalati** (fix applicato
   ma non ancora confermato su più giorni di uso reale).
7. **Badge notifiche Android**: deve essere un'icona monocroma (solo alpha,
   Android applica il tint). Il logo originale ha lettere/dettagli con
   INTERNO TRASPARENTE (non riempito), quindi l'estrazione naive "pixel
   bianchi" falliva — soluzione: flood-fill delle aree trasparenti chiuse
   dal bordo del logo intero per ottenere una sagoma piena (vedi commit
   storico per lo script, non salvato permanentemente nel repo).
8. **Screenshot tool della preview**: in questa sessione ha avuto timeout
   intermittenti; quando succede, usare `preview_inspect`/`preview_snapshot`/
   `preview_eval` invece di insistere con gli screenshot.
9. **GitHub Pages build a volte lento/bloccato** (osservato fino a 10+ min,
   a volte stato "errored" temporaneo che si risolve da solo): se stuck oltre
   ~10 min, fare un commit vuoto (`git commit --allow-empty`) per ritriggerare.

## Stato UI attuale (dopo restyling)

- Tema colore viola (`--accent: #752786`, `--accent-dark: #45174f`),
  estratto dal logo fornito dall'utente. Sfondo con radial-gradient soft.
- Logo: fleur-de-lis/gallo fiorentino con "P", fornito dall'utente
  (`Downloads/Logo app.png`, `Downloads/Badge.png` — non nel repo, solo gli
  export generati: `icon-192.png`, `icon-512.png`, `icon-maskable-*.png`,
  `apple-touch-icon.png`, `badge-96.png`).
- Home page: card "Verifica" (ricerca via, placeholder "Inserisci la via
  dove vuoi parcheggiare") SEPARATA dalla card "🚗 Parcheggio" con 3 azioni
  gerarchiche: **Ho parcheggiato qui** (primaria, gradiente), **Consigliami
  dove parcheggiare** (secondaria, tinta viola), **Verifica orari
  spazzamento di una via** (terziaria/ghost, ex "Scegli via a mano").
- Niente più pulsante "Adesso" o selettore data/ora manuale: la query usa
  sempre l'istante corrente (a meno di frasi come "domani" nel testo,
  gestite da `parseWhenFromText`).
- Pannello "La mia auto": sveglia con 3 riquadri swipe **giorni (0-7, step
  1) / ore (0-24, step 1) / minuti (0-59, step 5)**, stile "a rotella" (
  valore corrente in grassetto, adiacenti sfumati). Swipe su = aumenta,
  giù = diminuisce. Se il tempo scelto è già scaduto rispetto a ora, mostra
  un avviso rosso testuale (NO suono/overlay) — vedi `updateAlarmValidity`.
- Notifiche: sveglia interna (suono Web Audio generato al volo + overlay
  fullscreen) SEMPRE funzionante se l'app resta aperta; push reale via
  Worker per quando è chiusa. Il client sincronizza con `/status` prima di
  suonare la sveglia interna, per non duplicare l'avviso se il push reale
  è già arrivato (vedi `checkCarReminder`, ora `async`).

## Cose da tenere d'occhio / possibili prossimi passi

- **Verificare nei prossimi giorni** se il fix `urgency:'high'` ha
  davvero migliorato l'affidabilità del push ad app chiusa (l'utente
  segnalava "spesso non arrivano" prima di questo fix, applicato ma non
  ancora testato a lungo termine). Nota (3/7): i mancati recapiti visti
  finora sono spiegabili col cron a 1/min corretto solo stamattina — la
  pipeline è sana da allora. Aggiunto pulsante "📬 Prova notifica" per
  testare la consegna end-to-end ad app chiusa (arriva entro 5 min).
- Monitorare uso quota Cloudflare KV (dashboard Cloudflare → Workers &
  Pages → Analytics) ogni tanto, specialmente le operazioni "list".
- L'utente ha altri 2 progetti Cloudflare Pages sullo stesso account
  (`orari-michelangelo`, `software-preventivi`) — **non toccarli mai**,
  sono completamente separati da questo progetto (verificato più volte).
- Nessun test automatico: tutta la verifica finora è stata manuale (tool
  di preview + invii push forzati via `curl`/`gh workflow run` + controllo
  log). Se si aggiungono feature, continuare con questo approccio o
  proporre test automatici se il progetto cresce.
- File icona sorgente (`Downloads/Logo app.png`, `Badge.png`, immagine
  ChatGPT 1024x1024) non sono nel repo — se serve rigenerare le icone,
  richiederle di nuovo all'utente o cercarle in `Downloads/` (nomi
  contengono "Logo app", "Badge", o "ChatGPT Image").

## Preferenze utente osservate

- Vuole verifica concreta (curl/comandi reali), non solo affermazioni —
  controllare sempre lo stato effettivo prima di dire "fatto".
- Non tecnico ma capisce bene le spiegazioni se dirette; fa domande
  puntuali su cosa fa un pulsante/perché qualcosa non torna.
- Molto attento ai dettagli grafici/UX (ha chiesto più iterazioni su
  icone, colori, gerarchia dei pulsanti, comportamento esatto delle
  animazioni swipe).
- Preferisce che le operazioni rischiose (secret, credenziali) passino dal
  suo terminale, non dai comandi dell'assistente.
- Testa le notifiche push sul proprio telefono Android reale e riporta
  feedback puntuale; a volte serve fare invii forzati (manipolando
  `leadHours`/`lastNotifiedStart` via chiamate dirette al Worker) per
  isolare se un problema è di calcolo/timing o di consegna.
