// Genera notif-car-192.png: macchinina bianca su fondo viola pieno.
// Usata come icona grande delle notifiche push (lo slot non può restare
// vuoto: Chrome altrimenti mostra una "P" grigia generata dall'iniziale
// del sito). Uso: node scripts/make-notif-icon.js
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'worker', 'node_modules', 'sharp'));

// Sagoma "directions car" (Material Icons, viewBox 24x24), bianca,
// centrata su quadrato viola a tinta piena (i launcher la ritagliano
// a cerchio, il colore copre tutto il canvas).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="#752786"/>
  <g transform="translate(36,36) scale(5)">
    <path fill="#ffffff" d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
  </g>
</svg>`;

sharp(Buffer.from(svg))
  .png()
  .toFile(path.join(__dirname, '..', 'notif-car-192.png'))
  .then(() => console.log('notif-car-192.png generata'))
  .catch((err) => { console.error(err); process.exit(1); });
