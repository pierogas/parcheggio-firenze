/* Dove posso parcheggiare a Firenze — logica app
   Dati: SWEEPING_RECORDS / STREET_NAMES da data.js (generato da convert_kml.pl)
*/

const DAY_CODE_TO_JS = { DO: 0, LU: 1, MA: 2, ME: 3, GI: 4, VE: 5, SA: 6 };
const DAY_NAME = {
  DO: 'domenica', LU: 'lunedì', MA: 'martedì', ME: 'mercoledì',
  GI: 'giovedì', VE: 'venerdì', SA: 'sabato'
};
const ORDINAL = ['1°', '2°', '3°', '4°', '5°'];
const CAR_STORAGE_KEY = 'parcheggioFirenze.parkedCar';

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

// ---------- Calcolo regole di pulizia ----------
function ruleMatchesDate(rule, date) {
  if (DAY_CODE_TO_JS[rule.day] !== date.getDay()) return false;
  const occ = Math.ceil(date.getDate() / 7); // 1..5, quale occorrenza del giorno settimana nel mese
  const weekFlags = [rule.w1, rule.w2, rule.w3, rule.w4, rule.w5];
  if (weekFlags[occ - 1] !== 1) return false;
  const dayOfMonthEven = date.getDate() % 2 === 0;
  if (rule.pari === 1 && rule.dispari === 0) {
    if (!dayOfMonthEven) return false;
  } else if (rule.dispari === 1 && rule.pari === 0) {
    if (dayOfMonthEven) return false;
  }
  return true;
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function atTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
  return d;
}

function findNextOccurrence(rule, fromDate) {
  for (let i = 1; i <= 60; i++) {
    const cand = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    if (ruleMatchesDate(rule, cand)) {
      return { start: atTime(cand, rule.s), end: atTime(cand, rule.e) };
    }
  }
  return null;
}

function getRuleInfo(rule, refDate) {
  const todayMatches = ruleMatchesDate(rule, refDate);
  const nowMin = refDate.getHours() * 60 + refDate.getMinutes();
  const startMin = timeToMinutes(rule.s);
  const endMin = timeToMinutes(rule.e);

  if (todayMatches) {
    if (nowMin < startMin) {
      return { status: 'today-soon', start: atTime(refDate, rule.s), end: atTime(refDate, rule.e) };
    }
    if (nowMin >= startMin && nowMin < endMin) {
      return { status: 'busy', start: atTime(refDate, rule.s), end: atTime(refDate, rule.e) };
    }
  }
  const next = findNextOccurrence(rule, refDate);
  return { status: 'future', start: next ? next.start : null, end: next ? next.end : null };
}

function describeFrequency(rule) {
  const dayName = DAY_NAME[rule.day] || rule.day;
  const flags = [rule.w1, rule.w2, rule.w3, rule.w4, rule.w5];
  const allWeeks = flags.every(f => f === 1);
  let base;
  if (allWeeks) {
    base = 'ogni ' + capitalize(dayName);
  } else {
    const occ = flags.map((f, i) => f === 1 ? ORDINAL[i] : null).filter(Boolean);
    base = (occ.length ? occ.join(' e ') : '—') + ' ' + capitalize(dayName) + ' del mese';
  }
  if (rule.pari === 1 && rule.dispari === 0) base += ', nei giorni pari del mese';
  if (rule.dispari === 1 && rule.pari === 0) base += ', nei giorni dispari del mese';
  return base + ', ore ' + rule.s + '–' + rule.e + (rule.nott === 1 ? ' (notturna)' : '');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function fmtDateTime(d) {
  if (!d) return '';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long' }) +
    ' alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtTime(d) {
  return d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '?';
}

function formatDistance(meters) {
  if (meters < 1000) return Math.round(meters / 10) * 10 + ' m';
  return (meters / 1000).toFixed(1).replace('.0', '') + ' km';
}

// ---------- Raggruppamento record per segmento ----------
function recordsForStreet(via) {
  return SWEEPING_RECORDS.filter(r => r.via === via);
}

function groupSegments(records) {
  const groups = new Map();
  for (const r of records) {
    const key = r.via + '||' + r.tr;
    if (!groups.has(key)) groups.set(key, { via: r.via, tr: r.tr, rules: [] });
    groups.get(key).rules.push(r);
  }
  return Array.from(groups.values());
}

function evaluateSegment(segment, refDate) {
  const infos = segment.rules.map(r => ({ rule: r, info: getRuleInfo(r, refDate) }));
  let status = 'free';
  if (infos.some(x => x.info.status === 'busy')) status = 'busy';
  else if (infos.some(x => x.info.status === 'today-soon')) status = 'soon';

  let nextInfo = null;
  for (const x of infos) {
    if (x.info.status === 'busy' || x.info.status === 'today-soon') {
      if (!nextInfo || x.info.start < nextInfo.start) nextInfo = x.info;
    }
  }
  if (!nextInfo) {
    for (const x of infos) {
      if (x.info.start && (!nextInfo || x.info.start < nextInfo.start)) nextInfo = x.info;
    }
  }
  return { status, infos, nextInfo };
}

function statusText(seg) {
  if (seg.status === 'busy') return 'Pulizia in corso, termina alle ' + fmtTime(seg.nextInfo && seg.nextInfo.end);
  if (seg.status === 'soon') return 'Pulizia oggi alle ' + fmtTime(seg.nextInfo && seg.nextInfo.start);
  return seg.nextInfo && seg.nextInfo.start ? 'Libero ora — prossima pulizia: ' + fmtDateTime(seg.nextInfo.start) : 'Libero ora';
}

// ---------- Mappa ----------
let map, layerGroup;
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
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
}

function segmentPopupHtml(seg) {
  const title = seg.via + (seg.tr ? ' — ' + titleCase(seg.tr) : '');
  const lines = seg.rules.map(r => describeFrequency(r)).join('<br>');
  return '<strong>' + escapeHtml(title) + '</strong><br>' + lines;
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)([a-zà-ú])/g, (m, sp, c) => sp + c.toUpperCase());
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
  return '<div class="segment-card' + (opts.recommended ? ' recommended' : '') + '" data-key="' + escapeHtml(seg.via + '||' + seg.tr) + '">' +
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

  let html = '<h2>🏆 Dove parcheggiare vicino a te</h2>';
  html += '<p class="answer-lead">Consiglio le vie libere più vicine rispetto a ' + fmtDateTime(refDate) + '.</p>';

  if (recommended.length) {
    html += '<div class="section-label">Consigliati — liberi e vicini</div><div class="segment-list">';
    for (const seg of recommended) html += segmentCardHtml(seg, { showVia: true, distance: seg.dist, recommended: true });
    html += '</div>';
  } else {
    html += '<p class="no-result">Nessuna via completamente libera trovata nelle vicinanze in questo momento: guarda comunque le altre opzioni qui sotto.</p>';
  }

  if (others.length) {
    html += '<div class="section-label">Altre vie nella zona</div><div class="segment-list">';
    for (const seg of others) html += segmentCardHtml(seg, { showVia: true, distance: seg.dist });
    html += '</div>';
  }

  answerEl.hidden = false;
  answerEl.innerHTML = html;
  drawSegmentsAndFit(recommended.concat(others));
  map.setView([lat, lon], 16);
  L.marker([lat, lon]).addTo(layerGroup).bindPopup('Sei qui').openPopup();
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
const carPanelEl = document.getElementById('car-panel');

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

function confirmParkedHere(seg, lat, lon) {
  parkPickerEl.hidden = true;
  parkPickerEl.innerHTML = '';
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
  checkCarReminder();
  const segEval = Object.assign({}, seg, evaluateSegment(seg, new Date()));
  drawSegmentsAndFit([segEval]);
}

function renderCarPanel() {
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

  const leadOptions = [1, 3, 6, 12, 24, 48].map(h =>
    '<option value="' + h + '"' + (car.leadHours === h ? ' selected' : '') + '>' +
    (h === 24 ? 'il giorno prima (24h)' : h + ' ore prima') + '</option>').join('');

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
    '<div class="car-controls">' +
      '<label>⏰ Sveglia <select id="lead-select">' + leadOptions + '</select></label>' +
      '<button type="button" id="btn-test-alarm" class="btn btn-ghost">🔔 Prova la sveglia</button>' +
      permHtml +
      '<button type="button" id="btn-clear-car" class="btn btn-danger">Ho spostato l\'auto</button>' +
    '</div>' +
    '<p class="detail" style="margin-top:10px">La sveglia suona qui nell\'app quando è il momento (tienila aperta, anche in un\'altra scheda o come app installata): non serve il permesso di notifica del browser.</p>';

  const leadSelect = document.getElementById('lead-select');
  leadSelect.addEventListener('change', () => {
    const c = getParkedCar();
    if (!c) return;
    c.leadHours = parseInt(leadSelect.value, 10);
    c.lastNotifiedStart = null;
    c.dismissedForStart = null;
    saveParkedCar(c);
    checkCarReminder();
  });

  document.getElementById('btn-test-alarm').addEventListener('click', () => {
    unlockAudio();
    playAlarmSound();
    showAlarmOverlay(car, { start: evald.nextInfo && evald.nextInfo.start, testMode: true });
  });

  const btnEnable = document.getElementById('btn-enable-notif');
  if (btnEnable) {
    btnEnable.addEventListener('click', () => {
      Notification.requestPermission().then(() => { renderCarPanel(); checkCarReminder(); });
    });
  }

  document.getElementById('btn-clear-car').addEventListener('click', () => {
    clearParkedCar();
    closeAlarmOverlay();
    renderCarPanel();
  });
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
      '<h2>' + (info.testMode ? 'Prova sveglia' : 'Sposta l\'auto!') + '</h2>' +
      '<p>' + escapeHtml(title) + (when ? '<br>Pulizia prevista ' + escapeHtml(when) : '') + '</p>' +
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
    if (reg) { reg.showNotification(title, { body, icon: 'icon.svg' }); return; }
  }
  new Notification(title, { body, icon: 'icon.svg' });
}

function checkCarReminder() {
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
    const title = titleCase(car.via) + (car.tr ? ' — ' + titleCase(car.tr) : '');
    if (car.lastNotifiedStart !== startMs) {
      fireBrowserNotification('🧹 Pulizia strade in arrivo', 'Hai parcheggiato in ' + title + ': pulizia prevista ' + fmtDateTime(evald.nextInfo.start) + '. Sposta l\'auto!');
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
  const whenDate = document.getElementById('when-date');
  const whenTime = document.getElementById('when-time');

  function hasCustomWhen() {
    return !!(whenDate.value || whenTime.value);
  }

  function currentRefDate() {
    if (!hasCustomWhen()) return new Date();
    const now = new Date();
    const [y, mo, d] = (whenDate.value || now.toISOString().slice(0, 10)).split('-').map(Number);
    const ref = new Date(y, mo - 1, d);
    if (whenTime.value) {
      const [h, mi] = whenTime.value.split(':').map(Number);
      ref.setHours(h, mi, 0, 0);
    } else {
      ref.setHours(now.getHours(), now.getMinutes(), 0, 0);
    }
    return ref;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const base = currentRefDate();
    const refDate = hasCustomWhen() ? base : parseWhenFromText(text, base);
    runQuery(text, refDate);
  });

  document.getElementById('btn-now').addEventListener('click', () => {
    whenDate.value = '';
    whenTime.value = '';
  });

  document.getElementById('btn-geo').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocalizzazione non supportata da questo browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => renderNearby(pos.coords.latitude, pos.coords.longitude, currentRefDate()),
      (err) => alert('Impossibile ottenere la posizione: ' + err.message)
    );
  });

  document.getElementById('btn-park-here').addEventListener('click', handleParkHere);
});
