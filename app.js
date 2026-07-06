/* Dove posso parcheggiare a Firenze — logica app
   Dati: SWEEPING_RECORDS / STREET_NAMES da data.js (generato da convert_kml.pl)
   Calcolo pulizia/date: logic.js (condiviso con lo script push di GitHub Actions)
*/

const CAR_STORAGE_KEY = 'parcheggioFirenze.parkedCar';
const DEVICE_ID_KEY = 'parcheggioFirenze.deviceId';
const PUSH_WORKER_URL = 'https://parcheggio-firenze-push.rumpietro.workers.dev';
const VAPID_PUBLIC_KEY = 'BNYrsw95XgfZPyEe2nqn8nNCFHjWMr3xFIIdn-0QvIGBy7bJPowLno1_cgycsvGCZgL9aaOPwuIjy1MWDq_v0tY';

// ---------- Normalizzazione testo (accenti, maiuscole, punteggiatura) ----------
function normalize(str) {
  return (str || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // rimuove accenti
    .toUpperCase()
    .replace(/['`´]/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'POSSO','PARCHEGGIARE','PARCHEGGIO','DOVE','IN','A','AL','ALLA','ADESSO','ORA','ORE',
  'OGGI','DOMANI','DOPODOMANI','MATTINA','POMERIGGIO','SERA','STASERA','NOTTE','STANOTTE',
  'ALLE','PER','DI','LA','IL','LO','UN','UNA','CE','C','E','PULIZIA','STRADE','STRADA',
  'SOSTA','DIVIETO','SI','PUO','QUANDO','CHE','GIORNO','ORARIO','VICINO','ME','MI',
  'LUNEDI','MARTEDI','MERCOLEDI','GIOVEDI','VENERDI','SABATO','DOMENICA','PROSSIMO','PROSSIMA'
]);

const NORM_STREETS = STREET_NAMES.map(s => ({ orig: s, norm: normalize(s) }));

function findStreetMatches(inputText) {
  const normInput = normalize(inputText);
  const words = normInput.split(' ').filter(w => w.length >= 2 && !STOPWORDS.has(w));
  const core = words.join(' ');
  if (!core) return [];

  // Passata 1: il nome via completo e' contenuto nel testo (o viceversa)
  let matches = NORM_STREETS.filter(s => s.norm.length >= 3 && normInput.includes(s.norm));
  if (matches.length === 0 && core.length >= 3) {
    matches = NORM_STREETS.filter(s => s.norm.includes(core));
  }
  if (matches.length === 0) {
    // Passata 2: punteggio per parole in comune
    let scored = NORM_STREETS.map(s => {
      const streetWords = s.norm.split(' ');
      const common = streetWords.filter(w => words.includes(w) && w.length >= 4);
      return { s, score: common.length };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score || a.s.norm.length - b.s.norm.length);
    matches = scored.slice(0, 5).map(x => x.s);
  }
  // ordina i risultati "contains" preferendo corrispondenze piu' corte/specifiche
  matches.sort((a, b) => a.norm.length - b.norm.length);
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    if (!seen.has(m.orig)) { seen.add(m.orig); out.push(m.orig); }
  }
  return out.slice(0, 6);
}

// ---------- Interpretazione data/ora dal testo libero ----------
function parseWhenFromText(text, base) {
  const d = new Date(base.getTime());
  const norm = normalize(text);

  if (/\bDOMANI\b/.test(norm) && !/\bDOPODOMANI\b/.test(norm)) d.setDate(d.getDate() + 1);
  if (/\bDOPODOMANI\b/.test(norm)) d.setDate(d.getDate() + 2);

  const weekdayWords = { LUNEDI: 1, MARTEDI: 2, MERCOLEDI: 3, GIOVEDI: 4, VENERDI: 5, SABATO: 6, DOMENICA: 0 };
  for (const [word, jsDay] of Object.entries(weekdayWords)) {
    if (new RegExp('\\b' + word + '\\b').test(norm)) {
      const cur = d.getDay();
      let diff = (jsDay - cur + 7) % 7;
      if (diff === 0) diff = 0; // se e' oggi stesso giorno della settimana, resta oggi
      d.setDate(d.getDate() + diff);
      break;
    }
  }

  let hourSet = false;
  const alleMatch = norm.match(/\bALLE\s+(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (alleMatch) {
    d.setHours(parseInt(alleMatch[1], 10), alleMatch[2] ? parseInt(alleMatch[2], 10) : 0, 0, 0);
    hourSet = true;
  }
  if (!hourSet) {
    if (/\b(STANOTTE|NOTTE)\b/.test(norm)) { d.setHours(2, 0, 0, 0); hourSet = true; }
    else if (/\bMATTINA\b/.test(norm)) { d.setHours(8, 0, 0, 0); hourSet = true; }
    else if (/\bPOMERIGGIO\b/.test(norm)) { d.setHours(15, 0, 0, 0); hourSet = true; }
    else if (/\b(STASERA|SERA)\b/.test(norm)) { d.setHours(20, 0, 0, 0); hourSet = true; }
  }
  return d;
}

function formatDistance(meters) {
  if (meters < 1000) return Math.round(meters / 10) * 10 + ' m';
  return (meters / 1000).toFixed(1).replace('.0', '') + ' km';
}

// ---------- Raggruppamento record per segmento ----------
// ruleMatchesDate, findNextOccurrence, getRuleInfo, describeFrequency,
// fmtDateTime, fmtTime, groupSegments, evaluateSegment: vedi logic.js
function recordsForStreet(via) {
  return SWEEPING_RECORDS.filter(r => r.via === via);
}

function statusText(seg) {
  if (seg.status === 'busy') return 'Pulizia in corso, termina alle ' + fmtTime(seg.nextInfo && seg.nextInfo.end);
  if (seg.status === 'soon') return 'Pulizia oggi alle ' + fmtTime(seg.nextInfo && seg.nextInfo.start);
  return seg.nextInfo && seg.nextInfo.start ? 'Libero ora — prossima pulizia: ' + fmtDateTime(seg.nextInfo.start) : 'Libero ora';
}

// ---------- Mappa ----------
let map, layerGroup, lastBounds = null;
function initMap() {
  map = L.map('map').setView([43.7696, 11.2558], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
}

function statusColor(status) {
  if (status === 'busy') return '#d33';
  if (status === 'soon') return '#b3720a';
  return '#1e8e3e';
}

function drawSegments(evaluatedSegments) {
  layerGroup.clearLayers();
  const bounds = [];
  for (const seg of evaluatedSegments) {
    const color = statusColor(seg.status);
    const records = seg.rules;
    for (const r of records) {
      if (r.ln && r.ln.length) {
        for (const line of r.ln) {
          const latlngs = line.map(([lon, lat]) => [lat, lon]);
          L.polyline(latlngs, { color, weight: 5, opacity: 0.85 })
            .bindPopup(segmentPopupHtml(seg))
            .addTo(layerGroup);
          latlngs.forEach(p => bounds.push(p));
        }
      } else if (r.pt) {
        const [lon, lat] = r.pt;
        L.circleMarker([lat, lon], { color, radius: 8, fillColor: color, fillOpacity: 0.9 })
          .bindPopup(segmentPopupHtml(seg))
          .addTo(layerGroup);
        bounds.push([lat, lon]);
      }
    }
  }
  return bounds;
}

function drawSegmentsAndFit(evaluatedSegments) {
  const bounds = drawSegments(evaluatedSegments);
  lastBounds = bounds.length ? bounds : null;
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
}

function segmentPopupHtml(seg) {
  const title = seg.via + (seg.tr ? ' — ' + titleCase(seg.tr) : '');
  const lines = seg.rules.map(r => describeFrequency(r)).join('<br>');
  return '<strong>' + escapeHtml(title) + '</strong><br>' + lines;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Rendering risposta ----------
const answerEl = document.getElementById('answer');

function segmentCardHtml(seg, opts) {
  opts = opts || {};
  const cls = seg.status;
  const title = (opts.showVia ? titleCase(seg.via) + (seg.tr ? ' — ' : '') : '') + (seg.tr ? titleCase(seg.tr) : (opts.showVia ? '' : 'intera via'));
  const detail = seg.rules.map(r => describeFrequency(r)).join(' • ');
  const dist = opts.distance != null ? '<span class="distance">📍 ' + formatDistance(opts.distance) + '</span>' : '';
  return '<div class="segment-card ' + cls + (opts.recommended ? ' recommended' : '') + '" data-key="' + escapeHtml(seg.via + '||' + seg.tr) + '">' +
    '<div class="status-dot ' + cls + '"></div>' +
    '<div class="segment-info">' +
    '<div class="title-row"><div class="title">' + escapeHtml(title || 'intera via') + '</div>' + dist + '</div>' +
    '<div class="detail">' + escapeHtml(detail) + '</div>' +
    '<div class="status-text ' + cls + '">' + escapeHtml(statusText(seg)) + '</div>' +
    '</div></div>';
}

function renderNoStreetFound(text) {
  answerEl.hidden = false;
  answerEl.innerHTML = '<p class="no-result">Non ho trovato una via che corrisponda a "' + escapeHtml(text) +
    '". Prova a scrivere il nome della via come su Google Maps (es. "via dell\'Agnolo", "piazza Santo Spirito").</p>';
  layerGroup && layerGroup.clearLayers();
}

function renderAnswer(streetName, refDate, alternatives) {
  const records = recordsForStreet(streetName);
  const segments = groupSegments(records).map(seg => Object.assign(seg, evaluateSegment(seg, refDate)));
  segments.sort((a, b) => (a.tr || '').localeCompare(b.tr || ''));

  const worst = segments.some(s => s.status === 'busy') ? 'busy'
    : segments.some(s => s.status === 'soon') ? 'soon' : 'free';

  let lead;
  if (segments.length === 0) {
    lead = 'Non ho trovato regole di pulizia strade per <strong>' + escapeHtml(titleCase(streetName)) + '</strong>: probabilmente non è soggetta a pulizia meccanizzata programmata (o non è nel dataset).';
  } else if (worst === 'busy') {
    lead = '🚫 Attenzione: in <strong>' + escapeHtml(titleCase(streetName)) + '</strong> almeno un tratto ha la pulizia strade <strong>in corso</strong> a ' + fmtDateTime(refDate) + '. Divieto di sosta.';
  } else if (worst === 'soon') {
    lead = '⚠️ In <strong>' + escapeHtml(titleCase(streetName)) + '</strong> la pulizia strade è prevista più tardi nella giornata scelta, su almeno un tratto.';
  } else {
    lead = '✅ In <strong>' + escapeHtml(titleCase(streetName)) + '</strong> nessun tratto risulta in pulizia a ' + fmtDateTime(refDate) + '.';
  }

  let html = '<h2>Risultato per: ' + escapeHtml(titleCase(streetName)) + '</h2>';
  html += '<p class="answer-lead">' + lead + '</p>';

  if (alternatives && alternatives.length > 1) {
    html += '<p class="detail">Altre vie simili: ' + alternatives.slice(1, 6).map(a =>
      '<a href="#" class="alt-street" data-street="' + escapeHtml(a) + '">' + escapeHtml(titleCase(a)) + '</a>').join(', ') + '</p>';
  }

  if (segments.length) {
    html += '<div class="segment-list">';
    for (const seg of segments) html += segmentCardHtml(seg);
    html += '</div>';
    html += '<button type="button" class="btn btn-secondary btn-block" id="btn-show-map" style="margin-top:14px">🗺️ Mostra sulla mappa</button>';
  }

  answerEl.hidden = false;
  answerEl.innerHTML = html;

  answerEl.querySelectorAll('.alt-street').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const street = a.getAttribute('data-street');
      runQuery(street, refDate);
    });
  });

  const showMapBtn = document.getElementById('btn-show-map');
  if (showMapBtn) showMapBtn.addEventListener('click', () => switchTab('mappa'));

  drawSegmentsAndFit(segments);
}

function runQuery(rawText, refDate) {
  const matches = findStreetMatches(rawText);
  if (matches.length === 0) {
    renderNoStreetFound(rawText);
    return;
  }
  renderAnswer(matches[0], refDate, matches);
}

// ---------- Vicino a me / raccomandazioni ----------
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function recordMinDistance(r, lat, lon) {
  let minDist = Infinity;
  if (r.pt) minDist = Math.min(minDist, haversine(lat, lon, r.pt[1], r.pt[0]));
  if (r.ln) {
    for (const line of r.ln) {
      for (const [plon, plat] of line) {
        const d = haversine(lat, lon, plat, plon);
        if (d < minDist) minDist = d;
      }
    }
  }
  return minDist;
}

// Distanza minima per segmento (raggruppato), usata sia per "vicino a me" che per "ho parcheggiato qui"
function nearestSegments(lat, lon, limit) {
  const distByKey = new Map();
  for (const r of SWEEPING_RECORDS) {
    const key = r.via + '||' + r.tr;
    const d = recordMinDistance(r, lat, lon);
    const prev = distByKey.get(key);
    if (!prev || d < prev) distByKey.set(key, d);
  }
  const segments = groupSegments(SWEEPING_RECORDS);
  const withDist = segments.map(seg => ({ seg, dist: distByKey.get(seg.via + '||' + seg.tr) }));
  withDist.sort((a, b) => a.dist - b.dist);
  return withDist.slice(0, limit);
}

function renderNearby(lat, lon, refDate) {
  const nearby = nearestSegments(lat, lon, 60).map(x => Object.assign({}, x.seg, evaluateSegment(x.seg, refDate), { dist: x.dist }));

  const recommended = nearby.filter(s => s.status === 'free').sort((a, b) => a.dist - b.dist).slice(0, 3);
  const recommendedKeys = new Set(recommended.map(s => s.via + '||' + s.tr));
  const others = nearby.filter(s => !recommendedKeys.has(s.via + '||' + s.tr))
    .sort((a, b) => {
      const order = { busy: 0, soon: 1, free: 2 };
      return order[a.status] - order[b.status] || a.dist - b.dist;
    })
    .slice(0, 8);

  let html = '<p class="answer-lead">Le vie libere più vicine rispetto a ' + fmtDateTime(refDate) + '.</p>';

  if (recommended.length) {
    html += '<div class="section-label">Consigliati — liberi e vicini</div><div class="segment-list">';
    for (const seg of recommended) html += segmentCardHtml(seg, { showVia: true, distance: seg.dist, recommended: true });
    html += '</div>';
  } else {
    html += '<p class="no-result">Nessuna via completamente libera nelle vicinanze in questo momento: guarda le altre opzioni qui sotto.</p>';
  }

  if (others.length) {
    html += '<div class="section-label">Altre vie nella zona</div><div class="segment-list">';
    for (const seg of others) html += segmentCardHtml(seg, { showVia: true, distance: seg.dist });
    html += '</div>';
  }

  showMapSheet('🏆 Vicino a te', html);
  drawSegmentsAndFit(recommended.concat(others));
  L.marker([lat, lon]).addTo(layerGroup).bindPopup('Sei qui');
  switchTab('mappa');
}

// ---------- Ho parcheggiato qui ----------
function getParkedCar() {
  try {
    const raw = localStorage.getItem(CAR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveParkedCar(car) {
  localStorage.setItem(CAR_STORAGE_KEY, JSON.stringify(car));
}

function clearParkedCar() {
  localStorage.removeItem(CAR_STORAGE_KEY);
}

const parkPickerEl = document.getElementById('park-picker');
const manualParkEl = document.getElementById('manual-park');
const carPanelEl = document.getElementById('car-panel');
const mapSheetEl = document.getElementById('map-sheet');

// ---------- Schede (tab bar in basso) ----------
const TAB_TITLES = { verifica: 'Verifica una via', auto: 'La tua auto', mappa: 'Mappa' };

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.tab !== name; });
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('is-active', b.dataset.target === name));
  const t = document.getElementById('topbar-title');
  if (t) t.textContent = TAB_TITLES[name] || '';
  if (name === 'mappa' && map) {
    // La mappa era nascosta: Leaflet deve ricalcolare le dimensioni, poi
    // ri-adatto l'inquadratura all'ultimo disegno.
    setTimeout(() => {
      map.invalidateSize();
      if (lastBounds && lastBounds.length) map.fitBounds(lastBounds, { padding: [30, 30], maxZoom: 17 });
    }, 60);
  } else {
    window.scrollTo(0, 0);
  }
}

function updateAutoBadge() {
  const b = document.getElementById('tab-badge-auto');
  if (b) b.hidden = !getParkedCar();
}

// Pannello a scomparsa in fondo alla mappa (risultati ricerca / consigli)
function showMapSheet(title, innerHtml) {
  mapSheetEl.hidden = false;
  mapSheetEl.innerHTML =
    '<div class="map-sheet-grabber"></div>' +
    '<div class="map-sheet-head"><h2>' + title + '</h2>' +
    '<button type="button" class="map-sheet-close" id="map-sheet-close" aria-label="Chiudi">✕</button></div>' +
    innerHtml;
  document.getElementById('map-sheet-close').addEventListener('click', () => { mapSheetEl.hidden = true; });
  mapSheetEl.scrollTop = 0;
}

// Ricerca via dalla scheda Mappa: disegna e mostra il riepilogo nel pannello,
// restando sulla mappa (a differenza di renderAnswer che sta nella scheda Verifica).
function renderMapStreet(streetName, refDate) {
  const records = recordsForStreet(streetName);
  const segments = groupSegments(records).map(seg => Object.assign(seg, evaluateSegment(seg, refDate)));
  if (!segments.length) {
    showMapSheet(titleCase(streetName), '<p class="no-result">Nessuna regola di pulizia per questa via nel dataset.</p>');
    return;
  }
  segments.sort((a, b) => (a.tr || '').localeCompare(b.tr || ''));
  let html = '<div class="segment-list">';
  for (const seg of segments) html += segmentCardHtml(seg);
  html += '</div>';
  showMapSheet('Risultato: ' + titleCase(streetName), html);
  drawSegmentsAndFit(segments);
}

function handleParkHere() {
  if (!navigator.geolocation) {
    alert('Geolocalizzazione non supportata da questo browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const candidates = nearestSegments(lat, lon, 5);
      if (!candidates.length) return;
      const closest = candidates[0];
      const secondDist = candidates[1] ? candidates[1].dist : Infinity;
      if (closest.dist < 35 && closest.dist < secondDist * 0.6) {
        confirmParkedHere(closest.seg, lat, lon);
      } else {
        showParkPicker(candidates, lat, lon);
      }
    },
    (err) => alert('Impossibile ottenere la posizione: ' + err.message)
  );
}

function showParkPicker(candidates, lat, lon) {
  switchTab('auto');
  let html = '<h2>🚗 Conferma dove hai parcheggiato</h2>';
  html += '<p class="answer-lead">Ho trovato più tratti vicini alla tua posizione: scegli quello giusto.</p>';
  html += '<div class="pick-list">';
  candidates.forEach((c, i) => {
    const title = titleCase(c.seg.via) + (c.seg.tr ? ' — ' + titleCase(c.seg.tr) : '');
    html += '<div class="pick-option" data-idx="' + i + '"><span>' + escapeHtml(title) + '</span><span class="pick-dist">' + formatDistance(c.dist) + '</span></div>';
  });
  html += '</div>';
  parkPickerEl.hidden = false;
  parkPickerEl.innerHTML = html;
  parkPickerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  parkPickerEl.querySelectorAll('.pick-option').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      confirmParkedHere(candidates[idx].seg, lat, lon);
    });
  });
}

function showManualParkForm() {
  parkPickerEl.hidden = true;
  parkPickerEl.innerHTML = '';
  manualParkEl.hidden = false;
  manualParkEl.innerHTML =
    '<h2>✏️ Scegli dove hai parcheggiato</h2>' +
    '<p class="answer-lead">Utile se hai dimenticato di segnarlo appena sceso dall\'auto: cerca la via.</p>' +
    '<div class="ask-row">' +
      '<span class="ask-icon">🔎</span>' +
      '<input type="text" id="manual-park-input" placeholder="Es: via dell\'Agnolo" list="street-list">' +
      '<button type="button" id="manual-park-search" class="btn btn-primary">Cerca</button>' +
    '</div>';
  manualParkEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const input = document.getElementById('manual-park-input');
  const runSearch = () => {
    const text = input.value.trim();
    if (!text) return;
    const matches = findStreetMatches(text);
    if (!matches.length) {
      manualParkEl.innerHTML += '<p class="no-result">Nessuna via trovata per "' + escapeHtml(text) + '".</p>';
      return;
    }
    const via = matches[0];
    const segments = groupSegments(recordsForStreet(via));
    if (!segments.length) {
      manualParkEl.innerHTML += '<p class="no-result">"' + escapeHtml(titleCase(via)) + '" non ha regole di pulizia nel dataset.</p>';
      return;
    }
    if (segments.length === 1) {
      confirmParkedHere(segments[0], null, null);
    } else {
      showManualSegmentPicker(via, segments);
    }
  };
  document.getElementById('manual-park-search').addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
}

function showManualSegmentPicker(via, segments) {
  let html = '<h2>✏️ Quale tratto di ' + escapeHtml(titleCase(via)) + '?</h2>';
  html += '<p class="answer-lead">Questa via ha più tratti con regole diverse: scegli quello giusto.</p>';
  html += '<div class="pick-list">';
  segments.forEach((seg, i) => {
    const title = seg.tr ? titleCase(seg.tr) : 'intera via';
    html += '<div class="pick-option" data-idx="' + i + '"><span>' + escapeHtml(title) + '</span></div>';
  });
  html += '</div>';
  manualParkEl.innerHTML = html;
  manualParkEl.querySelectorAll('.pick-option').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      confirmParkedHere(segments[idx], null, null);
    });
  });
}

function confirmParkedHere(seg, lat, lon) {
  parkPickerEl.hidden = true;
  parkPickerEl.innerHTML = '';
  manualParkEl.hidden = true;
  manualParkEl.innerHTML = '';
  const existing = getParkedCar();
  const car = {
    via: seg.via, tr: seg.tr, lat, lon,
    ts: Date.now(),
    leadHours: existing ? existing.leadHours : 24,
    lastNotifiedStart: null,
    snoozeUntil: null,
    dismissedForStart: null
  };
  saveParkedCar(car);
  renderCarPanel();
  switchTab('auto');
  checkCarReminder();
  syncPushCarInfo(car);
  const segEval = Object.assign({}, seg, evaluateSegment(seg, new Date()));
  drawSegmentsAndFit([segEval]);
}

// ---------- Selettore sveglia a swipe (giorni / ore / minuti) ----------
const SWIPE_FIELD_RANGES = { days: [0, 7], hours: [0, 24], minutes: [0, 59] };
const SWIPE_FIELD_STEP = { days: 1, hours: 1, minutes: 5 };
const SWIPE_STEP_PX = 24;

function snapToStep(value, field) {
  const step = SWIPE_FIELD_STEP[field];
  const [min, max] = SWIPE_FIELD_RANGES[field];
  return Math.max(min, Math.min(max, Math.round(value / step) * step));
}

function decomposeLeadHours(hours) {
  let totalMin = Math.round((hours || 0) * 60);
  totalMin = Math.max(0, totalMin);
  return {
    days: Math.floor(totalMin / 1440),
    hours: Math.floor((totalMin % 1440) / 60),
    minutes: snapToStep(totalMin % 60, 'minutes')
  };
}

function composeLeadHours(parts) {
  return parts.days * 24 + parts.hours + parts.minutes / 60;
}

function swipeStepperHtml(field, value, label) {
  const [min, max] = SWIPE_FIELD_RANGES[field];
  const step = SWIPE_FIELD_STEP[field];
  const prev = value - step >= min ? value - step : '';
  const next = value + step <= max ? value + step : '';
  return '<div class="swipe-stepper" data-field="' + field + '">' +
    '<div class="swipe-track">' +
      '<div class="swipe-value swipe-prev">' + prev + '</div>' +
      '<div class="swipe-value swipe-current">' + value + '</div>' +
      '<div class="swipe-value swipe-next">' + next + '</div>' +
    '</div>' +
    '<div class="swipe-label">' + label + '</div>' +
  '</div>';
}

function wireSwipeSteppers(container, parts, onChange) {
  container.querySelectorAll('.swipe-stepper').forEach((el) => {
    const field = el.getAttribute('data-field');
    const [min, max] = SWIPE_FIELD_RANGES[field];
    const step = SWIPE_FIELD_STEP[field];
    const prevEl = el.querySelector('.swipe-prev');
    const currentEl = el.querySelector('.swipe-current');
    const nextEl = el.querySelector('.swipe-next');
    let startY = 0, startVal = 0, dragging = false;

    function render(val) {
      currentEl.textContent = val;
      prevEl.textContent = val - step >= min ? val - step : '';
      nextEl.textContent = val + step <= max ? val + step : '';
    }

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startVal = parts[field];
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const steps = Math.round((startY - e.clientY) / SWIPE_STEP_PX);
      const newVal = Math.max(min, Math.min(max, startVal + steps * step));
      render(newVal);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      parts[field] = parseInt(currentEl.textContent, 10);
      onChange(parts);
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  });
}

// ---------- Push reale (arriva anche ad app/browser chiuso) ----------
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function sendSubscriptionToWorker(sub, car) {
  try {
    const res = await fetch(PUSH_WORKER_URL + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: getDeviceId(),
        subscription: sub.toJSON(),
        via: car.via, tr: car.tr, leadHours: car.leadHours
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function enablePushForCar(car) {
  if (!pushSupported()) {
    alert('Le notifiche push non sono supportate da questo browser.');
    return false;
  }
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  return sendSubscriptionToWorker(sub, car);
}

async function syncPushCarInfo(car) {
  const sub = await getExistingPushSubscription();
  if (!sub) return;
  await sendSubscriptionToWorker(sub, car);
}

async function disablePushRecord() {
  try {
    await fetch(PUSH_WORKER_URL + '/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId() })
    });
  } catch (e) {}
}

function renderCarPanel() {
  updateAutoBadge();
  const car = getParkedCar();
  if (!car) { carPanelEl.hidden = true; carPanelEl.innerHTML = ''; return; }

  const seg = { via: car.via, tr: car.tr, rules: recordsForStreet(car.via).filter(r => r.tr === car.tr) };
  const evald = evaluateSegment(seg, new Date());
  const title = titleCase(car.via) + (car.tr ? ' — ' + titleCase(car.tr) : '');
  const rulesDesc = seg.rules.map(r => describeFrequency(r)).join(' • ');
  const emoji = evald.status === 'busy' ? '🚨' : evald.status === 'soon' ? '⚠️' : '🚗';

  const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
  let permHtml;
  if (permission === 'granted') permHtml = '<span class="notif-status">🔔 Notifiche del browser attive (bonus)</span>';
  else if (permission === 'denied') permHtml = '<span class="notif-status">La sveglia interna funziona comunque; notifiche del browser bloccate</span>';
  else permHtml = '<button type="button" id="btn-enable-notif" class="btn btn-ghost">🔔 Attiva anche notifiche browser</button>';

  const parts = decomposeLeadHours(car.leadHours);

  carPanelEl.hidden = false;
  carPanelEl.innerHTML =
    '<div class="car-summary">' +
      '<div class="car-emoji">' + emoji + '</div>' +
      '<div class="segment-info">' +
        '<div class="title">La mia auto — ' + escapeHtml(title) + '</div>' +
        '<div class="detail">' + escapeHtml(rulesDesc) + '</div>' +
        '<div class="status-text ' + evald.status + '">' + escapeHtml(statusText(Object.assign({}, seg, evald))) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="alarm-setter">' +
      '<div class="alarm-setter-label">⏰ Avvisami prima con:</div>' +
      '<div class="swipe-steppers">' +
        swipeStepperHtml('days', parts.days, 'giorni') +
        swipeStepperHtml('hours', parts.hours, 'ore') +
        swipeStepperHtml('minutes', parts.minutes, 'minuti') +
      '</div>' +
      '<div class="alarm-setter-caption">scorri su/giù sui riquadri, poi conferma</div>' +
      '<button type="button" id="btn-confirm-alarm" class="btn btn-primary btn-block">✅ Imposta sveglia</button>' +
      '<div id="alarm-active-line" class="alarm-active-line"></div>' +
      '<div id="alarm-setter-warning" class="alarm-setter-warning" hidden></div>' +
    '</div>' +
    '<div class="car-controls">' +
      permHtml +
      '<button type="button" id="btn-clear-car" class="btn btn-danger">Ho spostato l\'auto</button>' +
    '</div>' +
    '<div class="car-controls" id="push-controls"><span class="notif-status">Controllo stato push…</span></div>';

  const pending = { days: parts.days, hours: parts.hours, minutes: parts.minutes };
  const confirmBtn = document.getElementById('btn-confirm-alarm');

  function updateConfirmState() {
    const c = getParkedCar();
    if (!c) return;
    const changed = composeLeadHours(pending) !== c.leadHours;
    confirmBtn.disabled = !changed;
    confirmBtn.textContent = changed ? '✅ Imposta sveglia' : 'Sveglia impostata';
    updateAlarmValidity(c, composeLeadHours(pending));
  }

  confirmBtn.addEventListener('click', async () => {
    const c = getParkedCar();
    if (!c) return;
    c.leadHours = composeLeadHours(pending);
    c.lastNotifiedStart = null;
    c.dismissedForStart = null;
    saveParkedCar(c);
    updateConfirmState();
    renderActiveAlarmLine(c);
    const sub = await getExistingPushSubscription();
    if (sub) {
      const ok = await sendSubscriptionToWorker(sub, c);
      if (!ok) {
        const warnEl = document.getElementById('alarm-setter-warning');
        if (warnEl) {
          warnEl.hidden = false;
          warnEl.textContent = '⚠️ Sveglia salvata sul telefono ma non sul server push: controlla la connessione e premi di nuovo "Imposta sveglia".';
        }
      }
    }
  });

  wireSwipeSteppers(carPanelEl, pending, () => updateConfirmState());
  updateConfirmState();
  renderActiveAlarmLine(car);

  const btnEnable = document.getElementById('btn-enable-notif');
  if (btnEnable) {
    btnEnable.addEventListener('click', () => {
      Notification.requestPermission().then(() => { renderCarPanel(); checkCarReminder(); });
    });
  }

  document.getElementById('btn-clear-car').addEventListener('click', () => {
    disablePushRecord();
    clearParkedCar();
    closeAlarmOverlay();
    renderCarPanel();
  });

  renderPushControls(car);
}

async function renderPushControls(car) {
  const el = document.getElementById('push-controls');
  if (!el) return;
  if (!pushSupported()) {
    el.innerHTML = '<span class="notif-status">Push non supportato da questo browser: resta valida la sveglia interna.</span>';
    return;
  }
  const sub = await getExistingPushSubscription();
  if (sub) {
    el.innerHTML = '<span class="notif-status">🌍 Push attivo: arriva un avviso anche se chiudi l\'app o spegni il telefono</span>' +
      '<button type="button" id="btn-test-push" class="btn btn-ghost">📬 Prova notifica</button>' +
      '<button type="button" id="btn-disable-push" class="btn btn-ghost">Disattiva</button>';
    document.getElementById('btn-test-push').addEventListener('click', async () => {
      const btn = document.getElementById('btn-test-push');
      btn.disabled = true;
      btn.textContent = 'Richiesta in corso…';
      try {
        const res = await fetch(PUSH_WORKER_URL + '/test-push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getDeviceId() })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        el.innerHTML = '<span class="notif-status">📬 Prova richiesta! Ora <strong>chiudi completamente l\'app</strong>: la notifica di prova arriverà entro 5 minuti. Se non arriva, controlla le impostazioni di batteria/notifiche del telefono.</span>';
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '📬 Prova notifica';
        alert('Impossibile richiedere la prova: riprova tra poco.');
      }
    });
    document.getElementById('btn-disable-push').addEventListener('click', async () => {
      await disablePushRecord();
      try { await sub.unsubscribe(); } catch (e) {}
      renderPushControls(getParkedCar());
    });
  } else {
    el.innerHTML = '<button type="button" id="btn-enable-push" class="btn btn-primary">🌍 Attiva push anche ad app chiusa</button>';
    document.getElementById('btn-enable-push').addEventListener('click', async () => {
      const c = getParkedCar();
      if (!c) return;
      const ok = await enablePushForCar(c);
      el.innerHTML = ok
        ? '<span class="notif-status">🌍 Push attivato!</span>'
        : '<span class="notif-status">Attivazione non riuscita (permesso negato o problema di rete): la sveglia interna resta comunque attiva.</span>';
      renderPushControls(getParkedCar());
    });
  }
}

// ---------- Sveglia (suono + overlay a schermo intero) ----------
let audioCtx = null;
function unlockAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) audioCtx = new Ctx();
}
document.addEventListener('click', unlockAudio, { once: false });

function playAlarmSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.35, 0.7].forEach((offset) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.3);
  });
}

function closeAlarmOverlay() {
  const el = document.getElementById('alarm-overlay');
  if (el) el.remove();
}

function showAlarmOverlay(car, info) {
  closeAlarmOverlay();
  const title = titleCase(car.via) + (car.tr ? ' — ' + titleCase(car.tr) : '');
  const when = info.start ? fmtDateTime(info.start) : '';
  const overlay = document.createElement('div');
  overlay.id = 'alarm-overlay';
  overlay.className = 'alarm-overlay';
  overlay.innerHTML =
    '<div class="alarm-card">' +
      '<div class="alarm-emoji">⏰</div>' +
      '<h2>' + (info.testMode ? 'Prova sveglia' : 'Sposta la 🚗') + '</h2>' +
      '<p>Hai parcheggiato in ' + escapeHtml(title) + (when ? '<br>Pulizia prevista ' + escapeHtml(when) : '') + '</p>' +
      '<div class="alarm-buttons">' +
        (info.testMode
          ? '<button type="button" class="btn btn-primary" id="alarm-ok">Ok</button>'
          : '<button type="button" class="btn btn-ghost" id="alarm-snooze">😴 Rimanda 30 min</button>' +
            '<button type="button" class="btn btn-danger" id="alarm-moved">🚗 Ho spostato l\'auto</button>' +
            '<button type="button" class="btn btn-ghost" id="alarm-close">Chiudi</button>') +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const okBtn = document.getElementById('alarm-ok');
  if (okBtn) okBtn.addEventListener('click', closeAlarmOverlay);

  const snoozeBtn = document.getElementById('alarm-snooze');
  if (snoozeBtn) snoozeBtn.addEventListener('click', () => {
    const c = getParkedCar();
    if (c) { c.snoozeUntil = Date.now() + 30 * 60000; saveParkedCar(c); }
    closeAlarmOverlay();
  });

  const movedBtn = document.getElementById('alarm-moved');
  if (movedBtn) movedBtn.addEventListener('click', () => {
    clearParkedCar();
    closeAlarmOverlay();
    renderCarPanel();
  });

  const closeBtn = document.getElementById('alarm-close');
  if (closeBtn) closeBtn.addEventListener('click', closeAlarmOverlay);
}

async function fireBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) { reg.showNotification(title, { body, icon: 'notif-car-192.png', badge: 'badge-96.png' }); return; }
  }
  new Notification(title, { body, icon: 'notif-car-192.png' });
}

function updateAlarmValidity(car, leadHoursOverride) {
  const warnEl = document.getElementById('alarm-setter-warning');
  if (!warnEl) return;
  const leadHours = leadHoursOverride != null ? leadHoursOverride : car.leadHours;
  const seg = { via: car.via, tr: car.tr, rules: recordsForStreet(car.via).filter(r => r.tr === car.tr) };
  const evald = evaluateSegment(seg, new Date());
  if (!evald.nextInfo || !evald.nextInfo.start) { warnEl.hidden = true; return; }
  const reminderTime = evald.nextInfo.start.getTime() - leadHours * 3600000;
  if (Date.now() >= reminderTime) {
    warnEl.hidden = false;
    warnEl.textContent = '⚠️ Con questo preavviso l\'avviso scatterebbe già ora: lo spazzamento è troppo vicino per avvisarti con così tanto anticipo.';
  } else {
    warnEl.hidden = true;
  }
}

// Riga di stato sotto il tasto conferma: dice esattamente quando arriverà
// l'avviso, così l'utente ha la certezza di cosa è impostato.
function renderActiveAlarmLine(car) {
  const el = document.getElementById('alarm-active-line');
  if (!el) return;
  const seg = { via: car.via, tr: car.tr, rules: recordsForStreet(car.via).filter(r => r.tr === car.tr) };
  const evald = evaluateSegment(seg, new Date());
  if (!evald.nextInfo || !evald.nextInfo.start) { el.textContent = ''; return; }
  const reminderAt = new Date(evald.nextInfo.start.getTime() - car.leadHours * 3600000);
  if (reminderAt.getTime() <= Date.now()) { el.textContent = ''; return; }
  el.innerHTML = '🔔 Ti avviserò <strong>' + escapeHtml(fmtDateTime(reminderAt)) + '</strong>';
}

async function checkServerAlreadyNotified(startMs) {
  try {
    const sub = await getExistingPushSubscription();
    if (!sub) return false;
    const res = await fetch(PUSH_WORKER_URL + '/status?deviceId=' + encodeURIComponent(getDeviceId()));
    if (!res.ok) return false;
    const data = await res.json();
    return !!data && data.lastNotifiedStart === startMs;
  } catch (e) {
    return false;
  }
}

async function checkCarReminder() {
  const car = getParkedCar();
  if (!car) return;

  const seg = { via: car.via, tr: car.tr, rules: recordsForStreet(car.via).filter(r => r.tr === car.tr) };
  if (!seg.rules.length) return;
  const evald = evaluateSegment(seg, new Date());
  if (!evald.nextInfo || !evald.nextInfo.start) return;

  const startMs = evald.nextInfo.start.getTime();
  const reminderTime = startMs - car.leadHours * 3600000;
  const now = Date.now();

  if (car.snoozeUntil && now < car.snoozeUntil) return;
  if (car.dismissedForStart === startMs) return;

  if (now >= reminderTime && now < startMs) {
    const alreadySentByServer = await checkServerAlreadyNotified(startMs);
    if (alreadySentByServer) {
      car.lastNotifiedStart = startMs;
      car.dismissedForStart = startMs;
      saveParkedCar(car);
      return;
    }
    const title = titleCase(car.via) + (car.tr ? ' — ' + titleCase(car.tr) : '');
    if (car.lastNotifiedStart !== startMs) {
      fireBrowserNotification('Sposta la 🚗', 'Hai parcheggiato in ' + title + ': pulizia prevista ' + fmtDateTime(evald.nextInfo.start) + '.');
      car.lastNotifiedStart = startMs;
      saveParkedCar(car);
    }
    playAlarmSound();
    showAlarmOverlay(car, { start: evald.nextInfo.start });
  }
}

// ---------- Service worker (PWA) ----------
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ---------- Eventi UI ----------
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  registerServiceWorker();
  renderCarPanel();
  checkCarReminder();
  setInterval(checkCarReminder, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkCarReminder();
  });

  const datalist = document.getElementById('street-list');
  const frag = document.createDocumentFragment();
  for (const s of STREET_NAMES) {
    const opt = document.createElement('option');
    opt.value = titleCase(s);
    frag.appendChild(opt);
  }
  datalist.appendChild(frag);

  const form = document.getElementById('ask-form');
  const input = document.getElementById('ask-input');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    runQuery(text, parseWhenFromText(text, new Date()));
  });

  document.getElementById('btn-geo').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocalizzazione non supportata da questo browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => renderNearby(pos.coords.latitude, pos.coords.longitude, new Date()),
      (err) => alert('Impossibile ottenere la posizione: ' + err.message)
    );
  });

  document.getElementById('btn-park-here').addEventListener('click', handleParkHere);
  document.getElementById('btn-park-manual').addEventListener('click', showManualParkForm);

  // Schede in basso
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.target));
  });

  // Pulsante flottante "Ho parcheggiato qui" sulla mappa
  document.getElementById('fab-park').addEventListener('click', handleParkHere);

  // Ricerca dalla scheda Mappa
  const mapSearch = document.getElementById('map-search-input');
  mapSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = mapSearch.value.trim();
    if (!text) return;
    const matches = findStreetMatches(text);
    if (!matches.length) {
      showMapSheet('Nessun risultato', '<p class="no-result">Nessuna via trovata per "' + escapeHtml(text) + '".</p>');
      return;
    }
    renderMapStreet(matches[0], parseWhenFromText(text, new Date()));
  });

  updateAutoBadge();
});
