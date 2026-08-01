/**
 * colorpickfromimage.com — тема, мобильное меню и ЖИВОЙ пикер на главной.
 * Вся математика цветов — в core.js (сгенерированная копия core/core.js).
 * Никакой сети: файл декодируется в канвас этой страницы и никуда не уходит.
 */
import {
  toHex, toRgbString, toHslString, pixelAt, palette, toImageCoords,
} from './core.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- тема и меню
for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cpfi-theme', next); } catch { /* приватный режим */ }
  });
}
const sheet = $('sheet');
for (const btn of document.querySelectorAll('[data-menu-toggle]')) {
  btn.addEventListener('click', () => {
    const open = sheet.hidden;
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
}
sheet.addEventListener('click', (e) => {
  if (e.target.closest('a')) sheet.hidden = true;
});

// ---------------------------------------------------------------- пикер
const LOUPE_N = 15;                 // сетка 15×15 — как в расширении
const LOUPE_PX = 135;
const MAX_PIXELS = 32e6;

const emptyCard = $('tool-empty');
const loadedCard = $('tool-loaded');
const drop = $('drop');
const errEl = $('tool-err');
const fileInput = $('t-file');
const canvas = $('t-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const crossV = $('cross-v');
const crossH = $('cross-h');
const loupe = $('t-loupe');
const loupeCanvas = $('t-loupe-canvas');
const lctx = loupeCanvas.getContext('2d');
const badge = $('t-badge');
const coordsEl = $('t-coords');
const swatch = $('t-swatch');
const hexbig = $('t-hexbig');
const palEl = $('t-pal');

let imageData = null;
let natural = { w: 0, h: 0 };
let pos = null;
let picked = null;

function err(msg) {
  errEl.textContent = msg;
  errEl.hidden = !msg;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      btn.textContent = 'Copied ✓';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1400);
    }
    return true;
  } catch {
    if (btn) btn.textContent = 'Press Ctrl+C';
    return false;
  }
}

const vals = {};
for (const el of document.querySelectorAll('#t-vals .v')) vals[el.dataset.v] = el;
for (const btn of document.querySelectorAll('#t-vals .copy')) {
  btn.addEventListener('click', () => {
    const v = vals[btn.dataset.copy].textContent;
    if (v && v !== '—') copyText(v, btn);
  });
}

function renderPicked() {
  if (!picked) return;
  const hex = toHex(picked);
  swatch.style.background = hex;
  hexbig.textContent = hex;
  vals.hex.textContent = hex;
  vals.rgb.textContent = toRgbString(picked);
  vals.hsl.textContent = toHslString(picked);
}

function renderPalette(colors) {
  palEl.textContent = '';
  for (const rgb of colors) {
    const hex = toHex(rgb);
    const b = document.createElement('button');
    b.title = `Copy ${hex}`;
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = hex;
    const hx = document.createElement('span');
    hx.className = 'hx';
    hx.textContent = hex;
    b.append(sw, hx);
    b.addEventListener('click', () => {
      picked = { ...rgb };
      renderPicked();
      copyText(hex);
    });
    palEl.appendChild(b);
  }
}

function drawLoupe() {
  const cell = LOUPE_PX / LOUPE_N;
  lctx.imageSmoothingEnabled = false;
  for (let y = 0; y < LOUPE_N; y++) {
    for (let x = 0; x < LOUPE_N; x++) {
      lctx.fillStyle = (x + y) & 1 ? '#B9BBC0' : '#D5D7DB';
      lctx.fillRect(x * cell, y * cell, cell + 1, cell + 1);
    }
  }
  const half = (LOUPE_N - 1) / 2;
  lctx.drawImage(canvas, pos.x - half, pos.y - half, LOUPE_N, LOUPE_N, 0, 0, LOUPE_PX, LOUPE_PX);
  lctx.strokeStyle = 'rgba(0,0,0,.18)';
  lctx.lineWidth = 1;
  lctx.beginPath();
  for (let i = 1; i < LOUPE_N; i++) {
    lctx.moveTo(i * cell + 0.5, 0);
    lctx.lineTo(i * cell + 0.5, LOUPE_PX);
    lctx.moveTo(0, i * cell + 0.5);
    lctx.lineTo(LOUPE_PX, i * cell + 0.5);
  }
  lctx.stroke();
  lctx.strokeStyle = '#000';
  lctx.strokeRect(half * cell - 0.5, half * cell - 0.5, cell + 1, cell + 1);
  lctx.strokeStyle = '#fff';
  lctx.strokeRect(half * cell + 0.5, half * cell + 0.5, cell - 1, cell - 1);
}

function clampI(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function updateCursor() {
  if (!imageData || !pos) return;
  const rect = canvas.getBoundingClientRect();
  const boxRect = $('stagebox').getBoundingClientRect();
  const offX = rect.left - boxRect.left;
  const offY = rect.top - boxRect.top;
  const cssX = offX + (pos.x + 0.5) * rect.width / natural.w;
  const cssY = offY + (pos.y + 0.5) * rect.height / natural.h;

  crossV.hidden = crossH.hidden = false;
  crossV.style.left = `${cssX}px`;
  crossH.style.top = `${cssY}px`;

  drawLoupe();
  const p = pixelAt(imageData, pos.x, pos.y);
  badge.textContent = p ? toHex(p) : '—';
  loupe.hidden = false;
  const lw = 141, lh = 141 + 33;
  let lx = cssX + 22;
  let ly = cssY - lh / 2;
  if (lx + lw > boxRect.width - 4) lx = cssX - 22 - lw;
  ly = clampI(ly, 4, Math.max(4, boxRect.height - lh - 4));
  loupe.style.left = `${lx}px`;
  loupe.style.top = `${ly}px`;

  coordsEl.hidden = false;
  coordsEl.textContent = `x ${pos.x} · y ${pos.y}`;
}

function clearCursor() {
  pos = null;
  crossV.hidden = crossH.hidden = loupe.hidden = coordsEl.hidden = true;
}

function eventToPos(e) {
  const rect = canvas.getBoundingClientRect();
  const c = toImageCoords({
    clientX: e.clientX, clientY: e.clientY, rect,
    naturalWidth: natural.w, naturalHeight: natural.h,
  });
  if (!c) return null;
  return {
    x: clampI(Math.floor(c.x), 0, natural.w - 1),
    y: clampI(Math.floor(c.y), 0, natural.h - 1),
  };
}

function pickAt(p) {
  const px = pixelAt(imageData, p.x, p.y);
  if (!px) return;
  if (px.a === 0) { err('Transparent pixel — nothing to pick here'); return; }
  err('');
  picked = { r: px.r, g: px.g, b: px.b };
  renderPicked();
  copyText(toHex(picked));       // авто-копия, как в расширении
}

function setImage(source, w, h, label) {
  let dw = w, dh = h;
  if (w * h > MAX_PIXELS) {
    const s = Math.sqrt(MAX_PIXELS / (w * h));
    dw = Math.max(1, Math.round(w * s));
    dh = Math.max(1, Math.round(h * s));
  }
  canvas.width = dw;
  canvas.height = dh;
  ctx.drawImage(source, 0, 0, dw, dh);
  try {
    imageData = ctx.getImageData(0, 0, dw, dh);
  } catch {
    err('Could not read pixels from this image');
    return;
  }
  natural = { w: dw, h: dh };
  err('');
  emptyCard.hidden = true;
  loadedCard.hidden = false;
  $('t-fname').textContent = label || 'Image';
  $('t-fdims').textContent = `${dw} × ${dh}`;
  const step = Math.max(1, Math.ceil((dw * dh) / 250000));
  renderPalette(palette(imageData, 6, step));
  clearCursor();
  loadedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadBlob(blob, label) {
  if (!blob) return;
  let bmp = null;
  try { bmp = await createImageBitmap(blob); } catch { /* SVG → фолбэк */ }
  if (bmp) {
    setImage(bmp, bmp.width, bmp.height, label);
    bmp.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('empty');
    setImage(img, w, h, label);
  } catch {
    err('This file does not look like an image');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// открытие: клик/клавиатура по дроп-зоне, кнопка «Open another», файл
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
$('t-again').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadBlob(f, f.name);
  fileInput.value = '';
});

// drag&drop на всю страницу
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.classList.add('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('dragging'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('dragging');
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { loadBlob(f, f.name); return; }
  if (e.dataTransfer?.types.includes('text/uri-list')) {
    err('Dragging from another page won’t work offline. Right-click the image → “Copy image”, then Ctrl+V here');
  }
});

// вставка из буфера
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      e.preventDefault();
      loadBlob(it.getAsFile(), 'Pasted image');
      return;
    }
  }
});

// мышь и клавиатура
canvas.addEventListener('mousemove', (e) => {
  const p = eventToPos(e);
  if (p) { pos = p; updateCursor(); }
});
canvas.addEventListener('click', (e) => {
  const p = eventToPos(e);
  if (!p) return;
  pos = p;
  updateCursor();
  pickAt(p);
});
const KEY_DELTA = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
document.addEventListener('keydown', (e) => {
  if (!imageData) return;
  if (e.target instanceof Element && e.target.closest('button, input, select, textarea, a, summary')) return;
  const d = KEY_DELTA[e.key];
  if (d) {
    e.preventDefault();
    if (!pos) { pos = { x: Math.floor(natural.w / 2), y: Math.floor(natural.h / 2) }; updateCursor(); return; }
    const step = e.ctrlKey || e.altKey || e.metaKey ? 10 : 1;
    pos = {
      x: clampI(pos.x + d[0] * step, 0, natural.w - 1),
      y: clampI(pos.y + d[1] * step, 0, natural.h - 1),
    };
    updateCursor();
  } else if (e.key === 'Enter') {
    if (pos) { e.preventDefault(); pickAt(pos); }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    clearCursor();
  }
});
window.addEventListener('resize', () => { if (imageData && pos) updateCursor(); });
