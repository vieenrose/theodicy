// scene.js — the valley, drawn.
//
// Pure functions that return SVG *markup strings*. No React import, so this file
// loads identically in the browser (injected via dangerouslySetInnerHTML) and in
// Node (for offline preview / rasterisation). engine.js is dependency-free, so
// importing `ranking` here is safe in both.
//
// The map is the board. Everything the design doc adds later — story beats, the
// RTS skirmish, the geography of the four domains — hangs off these coordinates.
// It reacts to world state: bandit fires scale with their strength, the well
// darkens when fouled, the shrine cracks when desecrated, an ember haze thickens
// with tension, and each god's sigil glows by its wrath.

import { ranking } from './engine.js';
import { t as tr, DEITY_I18N, MAP_I18N } from './i18n.js';

// --- colour + math helpers ---------------------------------------------------
const DEITY = {
  vurm:  { color: '#f0a63a', glow: '#f59e0b', name: 'Vurm' },
  kel:   { color: '#fb7185', glow: '#f43f5e', name: 'Kel' },
  oss:   { color: '#34d399', glow: '#10b981', name: 'Oss' },
  ithra: { color: '#a78bfa', glow: '#8b5cf6', name: 'Ithra' },
};
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = hx(a), B = hx(b), tt = cl(t, 0, 1);
  return `rgb(${A.map((x, i) => Math.round(lerp(x, B[i], tt))).join(',')})`;
};
// deterministic per-index jitter so the map is stable within a render (no flicker)
const jit = (i, s = 1) => { const t = Math.sin(i * 127.1 + 311.7) * 43758.5453; return ((t - Math.floor(t)) - 0.5) * 2 * s; };

// --- the four god sigils, as path data on a 0..24 box ------------------------
export function sigilPath(deity) {
  switch (deity) {
    case 'vurm':  // the thirst — a droplet cracked by drought
      return 'M12 3 C7 10 5 13 5 16 a7 7 0 0 0 14 0 c0-3-2-6-7-13 Z M12 9 l-2 5 l3 1 l-2 4';
    case 'kel':   // the iron grudge — two crossed blades
      return 'M5 4 L19 20 M19 4 L5 20 M4 6 L7 3 M20 6 L17 3';
    case 'oss':   // the quiet hand — a sheltering arch over a hearth
      return 'M4 20 C4 10 20 10 20 20 M9 20 L9 15 L15 15 L15 20 M12 15 L12 20';
    case 'ithra': // the ledger — a balance that always tips
      return 'M12 3 L12 20 M6 20 L18 20 M5 7 L19 7 M5 7 L2 13 L8 13 Z M19 7 L16 13 L22 13 Z';
    default: return '';
  }
}

// --- deity portrait medallions -----------------------------------------------
// A designed avatar per god: a cowled figure with glowing eyes, its sigil as a
// brow-mark, and a domain motif — self-contained SVG, so it needs no download and
// is CSP-safe. Face() in index.html prefers a generated PNG if present, else this.
export function portraitMarkup(deity) {
  const d = DEITY[deity];
  const c = d.color, glow = d.glow;
  // per-god domain motif drawn faintly behind the head
  const motif = {
    vurm:  `<path d="M30 40 q8 10 0 22 M50 36 q8 12 0 26 M70 40 q8 10 0 22" stroke="${c}" stroke-width="2" fill="none" opacity="0.25"/>`,
    kel:   `<path d="M24 30 L46 58 M76 30 L54 58" stroke="${c}" stroke-width="3" fill="none" opacity="0.28"/>`,
    oss:   `<path d="M22 60 Q50 26 78 60" stroke="${c}" stroke-width="3" fill="none" opacity="0.28"/>`,
    ithra: `<path d="M50 26 V54 M34 54 h32 M30 40 h40" stroke="${c}" stroke-width="2.4" fill="none" opacity="0.28"/><circle cx="34" cy="46" r="5" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.28"/><circle cx="66" cy="46" r="5" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.28"/>`,
  }[deity];
  return `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
  <defs>
    <radialGradient id="bg-${deity}" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="${mix('#1c1917', glow, 0.28)}"/>
      <stop offset="70%" stop-color="#0c0a09"/><stop offset="100%" stop-color="#000"/>
    </radialGradient>
    <radialGradient id="eye-${deity}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff"/><stop offset="35%" stop-color="${glow}"/><stop offset="100%" stop-color="${mix('#000', glow, 0.4)}"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="url(#bg-${deity})"/>
  ${motif}
  <!-- mantle / shoulders -->
  <path d="M8 100 Q10 74 30 66 Q50 60 70 66 Q90 74 92 100 Z" fill="#14100e" stroke="${c}" stroke-width="0.8" stroke-opacity="0.5"/>
  <!-- cowl -->
  <path d="M28 58 Q26 24 50 20 Q74 24 72 58 Q72 70 50 72 Q28 70 28 58 Z" fill="#0f0c0b" stroke="${c}" stroke-width="1" stroke-opacity="0.7"/>
  <!-- face shadow -->
  <ellipse cx="50" cy="52" rx="15" ry="18" fill="#000" opacity="0.6"/>
  <!-- glowing eyes -->
  <ellipse cx="43.5" cy="50" rx="3.6" ry="2.6" fill="url(#eye-${deity})"/>
  <ellipse cx="56.5" cy="50" rx="3.6" ry="2.6" fill="url(#eye-${deity})"/>
  <!-- brow sigil -->
  <g transform="translate(38,26) scale(1.0)" opacity="0.92">
    <path d="${sigilPath(deity)}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <circle cx="50" cy="50" r="49" fill="none" stroke="${c}" stroke-width="1" stroke-opacity="0.4"/>
</svg>`.trim();
}

// --- a hut, scaled; lit windows fade in with morale --------------------------
function hut(x, y, s, lit) {
  const w = 22 * s, h = 15 * s, roof = 11 * s;
  const win = lit > 0 ? `<rect x="${x - 2.2 * s}" y="${y - h + 5 * s}" width="${4.4 * s}" height="${5 * s}" fill="#ffb347" opacity="${0.25 + 0.6 * lit}"/>` : '';
  return `<g>
    <rect x="${x - w / 2}" y="${y - h}" width="${w}" height="${h}" fill="#2a2320" stroke="#0f0c0b" stroke-width="1"/>
    <path d="M${x - w / 2 - 3 * s} ${y - h} L${x} ${y - h - roof} L${x + w / 2 + 3 * s} ${y - h} Z" fill="#3a2c22" stroke="#0f0c0b" stroke-width="1"/>
    ${win}
  </g>`;
}

// --- one bandit campfire on the ridge ---------------------------------------
function fire(x, y, i) {
  return `<g>
    <ellipse cx="${x}" cy="${y}" rx="9" ry="3.5" fill="#f9731633" />
    <path d="M${x} ${y} C${x - 5} ${y - 6} ${x - 3} ${y - 12} ${x} ${y - 16} C${x + 3} ${y - 12} ${x + 5} ${y - 6} ${x} ${y} Z" fill="#f97316"/>
    <path d="M${x} ${y - 2} C${x - 2.5} ${y - 6} ${x - 1.5} ${y - 10} ${x} ${y - 13} C${x + 1.5} ${y - 10} ${x + 2.5} ${y - 6} ${x} ${y - 2} Z" fill="#fde047"/>
    <path d="M${x - 1} ${y - 16} q${jit(i, 6)} -14 ${jit(i + 3, 4)} -28" stroke="#78716c55" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </g>`;
}

// A glowing site marker showing the god's painted avatar and a serif label.
function site(x, y, deity, wrath, label, sub) {
  const d = DEITY[deity];
  const r = 20 + wrath * 10;                          // glow radius scales with wrath
  const R = 17;
  return `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${d.glow}" opacity="${0.05 + 0.18 * wrath}" filter="url(#soft)"/>
    <clipPath id="clip-${deity}"><circle cx="${x}" cy="${y}" r="${R}"/></clipPath>
    <circle cx="${x}" cy="${y}" r="${R + 1}" fill="#0c0a09"/>
    <image href="./avatars/${deity}.png" x="${x - R}" y="${y - R}" width="${R * 2}" height="${R * 2}"
      clip-path="url(#clip-${deity})" preserveAspectRatio="xMidYMid slice"/>
    <circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="${d.color}" stroke-width="1.75" opacity="0.95"/>
    <text x="${x}" y="${y + 30}" text-anchor="middle" font-family="EB Garamond, Georgia, serif" font-size="15" fill="#e7e5e4" font-style="italic">${label}</text>
    <text x="${x}" y="${y + 44}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="8.5" fill="${d.color}" opacity="0.75" letter-spacing="1.5">${sub}</text>
  </g>`;
}

/**
 * valleyMapMarkup(w) — the whole region as one SVG string.
 * Anchors (the geography) are fixed; the contents breathe with world state.
 */
export function valleyMapMarkup(w, lang = 'en') {
  const M = MAP_I18N[lang] || MAP_I18N.en;
  const dsub = (d) => `${(DEITY_I18N[lang] || DEITY_I18N.en)[d][0]} · ${(DEITY_I18N[lang] || DEITY_I18N.en)[d][1]}`.toUpperCase();
  const v = w.village;
  const anger = Object.fromEntries(ranking(w).map((r) => [r.deity, r.anger]));
  const maxA = Math.max(1, ...Object.values(anger).map(Math.abs));
  const wr = (d) => cl(anger[d] / maxA, 0, 1);          // 0..1 normalised wrath
  const t = cl(w.tension / 100, 0, 1);

  // domain anchors — the map's permanent geography
  const A = {
    well:    { x: 250, y: 250 },   // Vurm, on the river
    ridge:   { x: 640, y: 120 },   // Kel, the bandit ridge (north-east)
    refuge:  { x: 300, y: 500 },   // Oss, the sheltered hollow (south-west)
    shrine:  { x: 760, y: 430 },   // Ithra, the shrine (east)
    village: { x: 480, y: 330 },   // the valley heart
  };

  // --- bandit fires along the ridge ---
  const nFires = cl(Math.round(w.bandits.strength), 0, 8);
  let fires = '';
  for (let i = 0; i < nFires; i++) fires += fire(A.ridge.x - 70 + i * 26 + jit(i, 5), A.ridge.y + 34 + jit(i + 9, 8), i);

  // --- village huts scale with population ---
  const nHuts = cl(Math.round(v.pop / 1.6), 3, 14);
  const morale = cl(v.morale / 100, 0, 1);
  let huts = '';
  for (let i = 0; i < nHuts; i++) {
    const ang = (i / nHuts) * Math.PI * 2, ring = 26 + (i % 3) * 15;
    huts += hut(A.village.x + Math.cos(ang) * ring * 1.5 + jit(i, 6), A.village.y + Math.sin(ang) * ring + jit(i + 2, 5), 0.8 + (i % 2) * 0.12, morale);
  }

  // --- palisade ring, segments by defense ---
  const seg = cl(Math.round(v.defense), 0, 10);
  let wall = '';
  for (let i = 0; i < seg; i++) {
    const a = (i / Math.max(1, seg)) * Math.PI * 2;
    const px = A.village.x + Math.cos(a) * 92, py = A.village.y + Math.sin(a) * 62;
    wall += `<line x1="${px}" y1="${py}" x2="${px}" y2="${py - 10}" stroke="#5b4636" stroke-width="3" stroke-linecap="round"/>`;
  }

  // --- fields: greenness by food ---
  const food = cl(v.food / 20, 0, 1);
  const fieldCol = mix('#6b5a2a', '#3f6b2a', food);
  let fields = '';
  for (let i = 0; i < 6; i++) {
    const fx = 360 + (i % 3) * 46, fy = 430 + Math.floor(i / 3) * 34;
    fields += `<g transform="rotate(-8 ${fx} ${fy})"><rect x="${fx}" y="${fy}" width="40" height="28" fill="${fieldCol}" stroke="#0f0c0b" stroke-width="0.75" opacity="0.85"/>
      <path d="M${fx + 5} ${fy + 4} V${fy + 24} M${fx + 15} ${fy + 4} V${fy + 24} M${fx + 25} ${fy + 4} V${fy + 24} M${fx + 35} ${fy + 4} V${fy + 24}" stroke="#0f0c0b22" stroke-width="1"/></g>`;
  }

  // --- the river + the well (Vurm), colour by clean/fouled + water ---
  const wellCol = w.sites.well.clean ? mix('#1e3a5f', '#3b82c4', cl(v.water / 15, 0, 1)) : '#4b5320';
  const river = `<path d="M120 180 C260 220 300 300 380 300 C 520 300 560 470 720 520"
      fill="none" stroke="${w.sites.well.clean ? '#24557d' : '#3f4420'}" stroke-width="14" stroke-linecap="round" opacity="0.55"/>
    <path d="M120 180 C260 220 300 300 380 300 C 520 300 560 470 720 520"
      fill="none" stroke="${w.sites.well.clean ? '#3b82c4' : '#5b6b25'}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>`;
  const well = `<g><circle cx="${A.well.x}" cy="${A.well.y}" r="17" fill="#1c1917" stroke="#3f3f46" stroke-width="3"/>
    <circle cx="${A.well.x}" cy="${A.well.y}" r="11" fill="${wellCol}"/>
    ${w.sites.well.clean ? '' : `<ellipse cx="${A.well.x}" cy="${A.well.y}" rx="9" ry="4" fill="#84812f" opacity="0.6"/>`}</g>`;

  // --- the shrine (Ithra): standing vs desecrated ---
  const sh = A.shrine;
  const shrine = w.sites.shrine.desecrated
    ? `<g><path d="M${sh.x - 12} ${sh.y + 10} l6 -18 l4 2" stroke="#57534e" stroke-width="4" fill="none"/><path d="M${sh.x + 4} ${sh.y + 10} l-3 -14" stroke="#57534e" stroke-width="4" fill="none"/><path d="M${sh.x - 16} ${sh.y + 11} h34" stroke="#3f3f46" stroke-width="3"/></g>`
    : `<g><rect x="${sh.x - 8}" y="${sh.y - 22}" width="16" height="30" rx="2" fill="#2a2536" stroke="#a78bfa" stroke-width="1.5"/><path d="M${sh.x} ${sh.y - 22} v-8" stroke="#a78bfa" stroke-width="2"/><circle cx="${sh.x}" cy="${sh.y - 32}" r="3" fill="#a78bfa"/></g>`;

  // --- roads between sites ---
  const road = (a, b) => `<path d="M${a.x} ${a.y} Q${(a.x + b.x) / 2 + jit(a.x, 20)} ${(a.y + b.y) / 2} ${b.x} ${b.y}" fill="none" stroke="#44403c" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" opacity="0.5"/>`;
  const roads = road(A.village, A.well) + road(A.village, A.shrine) + road(A.village, A.refuge) + road(A.village, A.ridge);

  // --- the four domain sites (glow by wrath) ---
  const sites =
    site(A.well.x, A.well.y - 2, 'vurm', wr('vurm'), M.well, dsub('vurm')) +
    site(A.ridge.x, A.ridge.y, 'kel', wr('kel'), M.ridge, dsub('kel')) +
    site(A.refuge.x, A.refuge.y, 'oss', wr('oss'), M.refuge, dsub('oss')) +
    site(A.shrine.x, A.shrine.y, 'ithra', wr('ithra'), M.shrine, dsub('ithra'));

  return `
<svg viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block" role="img" aria-label="Map of the valley">
  <defs>
    <radialGradient id="land" cx="48%" cy="52%" r="70%">
      <stop offset="0%" stop-color="#1c2a22"/><stop offset="55%" stop-color="#141d18"/><stop offset="100%" stop-color="#0c0a09"/>
    </radialGradient>
    <linearGradient id="ridgeG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#20160f"/><stop offset="100%" stop-color="#0c0a09"/>
    </linearGradient>
    <radialGradient id="ember" cx="50%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${mix('#3a0d0d', '#7c1d1d', t)}" stop-opacity="${0.10 + 0.42 * t}"/>
      <stop offset="100%" stop-color="#7c1d1d" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.04"/></feComponentTransfer><feComposite operator="over" in2="SourceGraphic"/></filter>
  </defs>

  <rect width="1000" height="640" fill="#0c0a09"/>
  <path d="M60 120 Q500 40 940 130 L960 600 Q500 660 40 600 Z" fill="url(#land)" stroke="#2a2320" stroke-width="2"/>

  <!-- northern ridge / mountains -->
  <path d="M60 150 L180 70 L280 140 L400 60 L520 130 L660 55 L800 135 L940 80 L940 140 Q500 90 60 150 Z" fill="url(#ridgeG)" stroke="#1a120c" stroke-width="1.5"/>
  <!-- western forest dots -->
  ${Array.from({ length: 26 }, (_, i) => { const x = 80 + (i % 6) * 22 + jit(i, 8), y = 250 + Math.floor(i / 6) * 34 + jit(i + 4, 10); return `<path d="M${x} ${y} l7 16 h-14 Z M${x} ${y + 7} l6 14 h-12 Z" fill="#16241a" stroke="#0f1a12" stroke-width="0.5"/>`; }).join('')}

  ${roads}
  ${river}
  ${fields}
  ${well}
  ${fires}
  ${wall}
  ${huts}
  <text x="${A.village.x}" y="${A.village.y + 96}" text-anchor="middle" font-family="EB Garamond, Georgia, serif" font-size="16" fill="#e7e5e4" font-style="italic">${M.village}</text>
  <text x="${A.village.x}" y="${A.village.y + 110}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="8.5" fill="#a8a29e" letter-spacing="1.5">${v.pop} ${tr(lang, 'soulsCap')}</text>
  ${shrine}
  ${sites}

  <!-- ember haze of tension over everything -->
  <rect width="1000" height="640" fill="url(#ember)" pointer-events="none"/>

  <!-- cartouche -->
  <g>
    <rect x="30" y="30" width="330" height="58" fill="#0c0a09cc" stroke="#3f3f46" stroke-width="1"/>
    <text x="46" y="60" font-family="EB Garamond, Georgia, serif" font-size="24" fill="#f5f5f4" letter-spacing="2">${tr(lang, 'valeTitle')}</text>
    <text x="46" y="78" font-family="ui-monospace, monospace" font-size="9" fill="#78716c" letter-spacing="2">${tr(lang, 'turn')} ${w.turn} / ${w.maxTurns} · ${tr(lang, 'tension').toUpperCase()} ${w.tension}</text>
  </g>
  <!-- compass -->
  <g transform="translate(905,560)" opacity="0.8">
    <circle r="26" fill="#0c0a09cc" stroke="#3f3f46"/>
    <path d="M0 -20 L5 0 L0 20 L-5 0 Z" fill="#a8a29e"/><path d="M0 -20 L5 0 L0 0 Z" fill="#e7e5e4"/>
    <text x="0" y="-27" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" fill="#a8a29e">N</text>
  </g>
</svg>`.trim();
}
