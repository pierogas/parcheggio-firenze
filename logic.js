/* Logica di calcolo pulizia strade, condivisa tra browser (app.js) e
   Node.js (script GitHub Actions per l'invio dei promemoria push).
   Nessun riferimento a document/window: deve restare eseguibile anche in Node. */

const DAY_CODE_TO_JS = { DO: 0, LU: 1, MA: 2, ME: 3, GI: 4, VE: 5, SA: 6 };
const DAY_NAME = {
  DO: 'domenica', LU: 'lunedì', MA: 'martedì', ME: 'mercoledì',
  GI: 'giovedì', VE: 'venerdì', SA: 'sabato'
};
const ORDINAL = ['1°', '2°', '3°', '4°', '5°'];

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
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
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

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)([a-zà-ú])/g, (m, sp, c) => sp + c.toUpperCase());
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

function fmtDateTime(d) {
  if (!d) return '';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long' }) +
    ' alle ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtTime(d) {
  return d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '?';
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAY_CODE_TO_JS, DAY_NAME, ORDINAL,
    ruleMatchesDate, timeToMinutes, atTime, findNextOccurrence, getRuleInfo,
    capitalize, titleCase, describeFrequency, fmtDateTime, fmtTime,
    groupSegments, evaluateSegment
  };
}
