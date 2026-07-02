# Dove posso parcheggiare a Firenze

App web statica (HTML/CSS/JS, nessun backend) che usa il dataset open data
**Pulizia Strade** del Comune di Firenze / Alia SpA per dirti se e quando una
via è soggetta a pulizia meccanizzata (quindi divieto di sosta).

## Come si usa

1. Avvia un server statico nella cartella (vedi sotto).
2. Apri `index.html` nel browser (o installala come app, vedi sotto).
3. Scrivi una domanda tipo *"posso parcheggiare in via Pisana adesso?"* o
   *"via dell'Agnolo domani mattina"*.
4. **📍 Consigliami dove parcheggiare** condivide la tua posizione e ti
   mostra le vie libere più vicine (sezione "Consigliati"), più altre vie
   della zona con il loro stato.
5. **🚗 Ho parcheggiato qui** salva la via/tratto più vicino alla tua
   posizione attuale (se ci sono più tratti vicini te lo chiede per
   conferma) nel pannello "La mia auto", con la prossima data di pulizia.
6. Puoi anche impostare manualmente data/ora con il campo "oppure scegli
   quando".

Il colore dei pallini/segmenti sulla mappa: 🟢 libero, 🟠 pulizia più tardi
oggi, 🔴 pulizia in corso ora.

## Sveglia "sposta l'auto"

Dal pannello **La mia auto** scegli quanto tempo prima vuoi essere avvisato:
preset rapidi (1h, 3h, 6h, 12h, 24h = "il giorno prima", 48h) oppure
**personalizza…** per impostare ore e minuti esatti (es. 2h 45min). Quando arriva il momento,
l'app suona un allarme (beep generato via Web Audio, non serve un file audio)
e mostra un avviso a schermo intero con tre scelte: **rimanda 30 minuti**,
**ho spostato l'auto** (cancella il promemoria), oppure **chiudi** (l'allarme
ricontrolla ogni 5 minuti e ricompare finché non lo gestisci, come una vera
sveglia). Il pulsante **🔔 Prova la sveglia** fa scattare subito un test per
verificare che audio e avviso funzionino.

Come bonus, se attivi anche il permesso "Notifiche browser", l'app manda
pure una notifica di sistema tramite il Service Worker — utile se hai la
scheda in un'altra finestra, ma non è necessaria: la sveglia interna
funziona comunque senza quel permesso.

⚠️ **Limite della sveglia interna**: suona solo mentre il browser (o l'app
installata) è aperto e in esecuzione, anche in background/minimizzato — non
se il telefono è spento o il browser completamente chiuso. Per quel caso
c'è il push reale, vedi sotto.

## Push reale (arriva anche ad app chiusa)

Nel pannello "La mia auto" c'è anche **🌍 Attiva push anche ad app chiusa**:
usa il protocollo standard Web Push, quindi il promemoria arriva come vera
notifica di sistema anche se il browser è completamente chiuso o il telefono
è spento e poi riacceso.

Architettura (tutta gratuita, nessun server sempre-acceso da mantenere):

- **Client** (`app.js`): quando attivi il push, il browser crea una
  `PushSubscription` (protetta dalle chiavi VAPID) e la invia a un
  **Cloudflare Worker** (`worker/`), insieme a via/tratto e ore di preavviso.
- **Cloudflare Worker + KV** (`worker/src/index.js`): un piccolo endpoint
  serverless gratuito che salva le iscrizioni push in un database key-value
  (Cloudflare KV). Non contiene la logica di quando avvisare: è solo lo
  "storage" condiviso tra il telefono e il processo che invia i push.
- **GitHub Actions** (`.github/workflows/send-reminders.yml`): uno scheduled
  workflow gratuito che gira ogni 15 minuti, legge le iscrizioni dal Worker,
  usa la stessa logica di calcolo di `app.js` (condivisa in `logic.js`) per
  capire a chi serve un avviso adesso, e invia il push tramite la libreria
  `web-push` con le chiavi VAPID (salvate come secret del repository, mai
  esposte pubblicamente — solo la chiave pubblica VAPID è nel client, quella
  privata resta solo nei secret di GitHub Actions).

Se disattivi il push, il record lato server viene cancellato ma la sveglia
interna dell'app continua a funzionare normalmente.

### Rigenerare/aggiornare l'infrastruttura push

- **Chiavi VAPID**: generate una tantum con `npx web-push generate-vapid-keys`.
- **Worker**: da `worker/`, `npm install` poi `npx wrangler deploy` (richiede
  login con `npx wrangler login`).
- **Secret del Worker**: `npx wrangler secret put WORKER_SHARED_SECRET`
  (deve combaciare con il secret `WORKER_SHARED_SECRET` su GitHub Actions).
- **Secret di GitHub Actions**: `gh secret set NOME --body "valore"` per
  `WORKER_URL`, `WORKER_SHARED_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- Il workflow si può anche lanciare a mano da GitHub → Actions → "Invia
  promemoria push spazzamento" → "Run workflow", utile per testare.

## Installarla come app (PWA)

L'app include un `manifest.json` e un Service Worker (`sw.js`), quindi da
Chrome/Edge desktop o Android puoi usare "Installa app" / "Aggiungi a
schermata Home" nel menu del browser per aprirla come un'app a sé stante,
con funzionamento offline per la parte già visitata (i dati sono comunque
tutti incorporati in `data.js`, quindi funziona offline fin da subito).

L'icona (app, favicon, notifiche) parte dal logo in `Downloads/Logo app.png`
e `Downloads/Badge.png`: `icon-192.png`/`icon-512.png` sono il logo così
com'è, le versioni `icon-maskable-*.png` hanno un padding di sicurezza extra
su sfondo viola pieno (necessario perché Android ritaglia le icone in
cerchio/squircle), `apple-touch-icon.png` è la versione 180×180 a sfondo
pieno per iOS, e `badge-96.png` è una sagoma monocroma (ricavata riempiendo
le zone interne chiuse del logo) usata per il badge delle notifiche Android,
che per specifica di sistema deve essere a un solo colore. Per rigenerarle
dopo aver cambiato il logo, serve Node.js + il pacchetto `sharp` (script
usato una tantum, non incluso nel repo).

### Avviare un server locale

Sul PC non erano disponibili Python/Node, quindi è incluso `serve.ps1`, un
piccolo server statico in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 5501
```

poi apri http://localhost:5501/. In alternativa va benissimo qualunque altro
server statico (es. estensione "Live Server" di VS Code, `npx serve`, ecc.),
oppure aprire `index.html` direttamente col browser (funziona anche in
`file://`, dato che i dati sono incorporati in `data.js`).

## Dati e aggiornamento

I dati vengono dalla cartella `pulizia stradale 2`
(`Downloads/Pulizia_Strade (2)/Pulizia_Strade/KML/pulizia_strade.kmz`),
convertiti in `data.js` con `convert_kml.pl` (richiede Perl, già presente su
Git Bash/MSYS):

```bash
perl convert_kml.pl "/percorso/pulizia_strade.kml" data.js
```

Rigeneralo quando scarichi una versione più recente del dataset dal portale
open data del Comune di Firenze.

## Come viene calcolato lo stato di una via

Ogni regola del dataset ha: giorno della settimana, orario, e 5 flag
(`prima_settimana` … `quinta_settimana`) che indicano su quali occorrenze del
mese si applica (es. solo il 1° e 3° martedì), più due flag `pari`/`dispari`
che restringono ulteriormente ai **giorni pari o dispari del mese** (numero
di calendario 1-31 di quel giorno, non la settimana) — confermato da fonti
ufficiali Alia/Comune di Firenze: è lo schema tipico "un martedì sì, uno no"
usato per lo spazzamento notturno a Firenze. L'app applica entrambi i filtri
direttamente: se tutti e 5 i flag settimana-del-mese sono a 1 e non c'è
restrizione pari/dispari, la pulizia è settimanale; se c'è pari/dispari, si
applica solo quando quel giorno del mese ha la parità richiesta; altrimenti
si applica solo nelle occorrenze del mese indicate dai flag 1°-5°.

Il campo `settimanale` del dataset originale non viene usato nel calcolo
(sembra ridondante rispetto ai flag sopra): è comunque conservato nei dati
grezzi per chi volesse verificare l'ipotesi.

⚠️ **Solo a scopo informativo.** Verifica sempre la segnaletica stradale reale:
il dataset è "as-needed" e potrebbe non riflettere modifiche recenti o
eccezioni (ordinanze, cantieri, eventi).
