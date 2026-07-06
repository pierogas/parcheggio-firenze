// Genera le icone PNG di SpazzApp dal logo "spazzolone nel pin".
// Simbolo bianco su tile teal pieno (icone app), o bianco su trasparente
// (badge notifica monocromo che Android tinta). Uso:
//   node scripts/make-brand-icons.js
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'worker', 'node_modules', 'sharp'));

const ROOT = path.join(__dirname, '..');
const TEAL = '#0E7268';

// Tratti del logo (viewBox 48x48), da colorare a seconda dell'uso.
function symbol(stroke) {
  return `<g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 4 C15.2 4 8 11.2 8 20 C8 31.5 24 44 24 44 C24 44 40 31.5 40 20 C40 11.2 32.8 4 24 4 Z" stroke-width="3.2"/>
    <circle cx="24" cy="18.5" r="5" stroke-width="3"/>
    <path d="M20.75 24.13 L19.5 26.29" stroke-width="2.6"/>
    <path d="M24 25 L24 27.5" stroke-width="2.6"/>
    <path d="M27.25 24.13 L28.5 26.29" stroke-width="2.6"/>
    <path d="M17.5 30.5 L30.5 30.5" stroke-width="2.6"/>
  </g>`;
}

// Compone un SVG NxN: simbolo centrato che occupa una frazione `frac` del lato.
function tile(size, frac, bg, stroke) {
  const s = (size * frac) / 48;
  const off = size / 2 - 24 * s;
  const rect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    rect +
    `<g transform="translate(${off},${off}) scale(${s})">${symbol(stroke)}</g>` +
    `</svg>`
  );
}

const jobs = [
  ['icon-192.png', tile(192, 0.60, TEAL, '#fff')],
  ['icon-512.png', tile(512, 0.60, TEAL, '#fff')],
  ['icon-maskable-192.png', tile(192, 0.46, TEAL, '#fff')],
  ['icon-maskable-512.png', tile(512, 0.46, TEAL, '#fff')],
  ['apple-touch-icon.png', tile(180, 0.60, TEAL, '#fff')],
  ['notif-car-192.png', tile(192, 0.60, TEAL, '#fff')],
  ['badge-96.png', tile(96, 0.82, null, '#fff')]
];

Promise.all(jobs.map(([name, svg]) =>
  sharp(svg).png().toFile(path.join(ROOT, name)).then(() => console.log('ok', name))
)).catch((err) => { console.error(err); process.exit(1); });
