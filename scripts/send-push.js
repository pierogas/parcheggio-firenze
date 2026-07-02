const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { groupSegments, evaluateSegment, fmtDateTime, titleCase } = require('../logic.js');

const WORKER_URL = process.env.WORKER_URL;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (!WORKER_URL || !WORKER_SHARED_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Variabili d\'ambiente mancanti (WORKER_URL, WORKER_SHARED_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function loadRecords() {
  const dataSrc = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
  const { SWEEPING_RECORDS } = new Function(dataSrc + '\nreturn { SWEEPING_RECORDS };')();
  return SWEEPING_RECORDS;
}

async function main() {
  const records = loadRecords();
  const res = await fetch(WORKER_URL + '/list', {
    headers: { Authorization: `Bearer ${WORKER_SHARED_SECRET}` }
  });
  if (!res.ok) throw new Error('Impossibile leggere le iscrizioni dal worker: ' + res.status);
  const subs = await res.json();
  console.log(`Trovate ${subs.length} iscrizioni push.`);

  const now = new Date();

  for (const record of subs) {
    if (!record.via) continue;
    const segRecords = records.filter(r => r.via === record.via && (r.tr || '') === (record.tr || ''));
    if (!segRecords.length) continue;

    const seg = { via: record.via, tr: record.tr, rules: segRecords };
    const evald = evaluateSegment(seg, now);
    if (!evald.nextInfo || !evald.nextInfo.start) continue;

    const startMs = evald.nextInfo.start.getTime();
    const reminderTime = startMs - (record.leadHours || 24) * 3600000;
    const nowMs = now.getTime();

    if (nowMs >= reminderTime && nowMs < startMs && record.lastNotifiedStart !== startMs) {
      const title = titleCase(record.via) + (record.tr ? ' — ' + titleCase(record.tr) : '');
      const payload = JSON.stringify({
        title: 'Devi spostare la macchina!',
        body: `Hai parcheggiato in ${title}: pulizia prevista ${fmtDateTime(evald.nextInfo.start)}.`
      });
      try {
        await webpush.sendNotification(record.subscription, payload);
        await fetch(WORKER_URL + '/mark-notified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WORKER_SHARED_SECRET}` },
          body: JSON.stringify({ deviceId: record.deviceId, startMs })
        });
        console.log(`Push inviato a ${record.deviceId} per ${title}`);
      } catch (err) {
        console.error(`Errore invio push a ${record.deviceId}:`, err.statusCode || err.message);
        if (err.statusCode === 404 || err.statusCode === 410) {
          await fetch(WORKER_URL + '/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: record.deviceId })
          }).catch(() => {});
        }
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
