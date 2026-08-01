/**
 * PixelPeek app — логика страницы пикера (app.html).
 * Вся математика цветов/палитры/истории — в core.js (сгенерированная копия
 * core/core.js); здесь только DOM: canvas, лупа, клавиатура, буфер, storage.
 *
 * Ключи chrome.storage.local (разделяются с попапом):
 *   pp-history  — история пиков [{hex,r,g,b,at}], новые сверху, ≤ HISTORY_LIMIT
 *   pp-settings — { autoCopy }
 *   pp-incoming — входящая картинка от background/попапа, контракт:
 *     { kind: 'dataurl'|'url'|'capture'|'hint', src?, label?, crop? }.
 *     Страница забирает значение при старте и по storage.onChanged, удаляет
 *     ключ и действует: dataurl/url — целая картинка (url — с
 *     crossOrigin='anonymous', тир 1 лестницы из SPEC §2); capture — снимок
 *     вкладки + crop {x,y,w,h,viewportW,viewportH} в CSS-пикселях, масштаб
 *     меряется по фактическому размеру снимка (дробный DPR!); hint — тир 3:
 *     показать подсказку «Copy image → Ctrl+V».
 *
 * Без chrome.* страница живёт на localStorage — открывается как файл для
 * ручной проверки и для jsdom-харнеса.
 */
import {
  toHex, toRgbString, toHslString, contrastInk,
  pixelAt, palette, pushHistory, toImageCoords,
} from './core.js';

const K_HISTORY = 'pp-history';
const K_SETTINGS = 'pp-settings';
const K_INCOMING = 'pp-incoming';

const LOUPE_GRID = 15;      // нечётное: пик-пиксель ровно в центре сетки
const LOUPE_CELL = 10;
const MAX_PIXELS = 32e6;    // выше ~32 МП getImageData упирается в память

const TIER3_HINT = 'Couldn’t reach that image. On the page: right-click → “Copy image”, then press Ctrl+V here';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const stageInner = $('stageInner');
const empty = $('empty');
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const marker = $('marker');
const loupe = $('loupe');
const loupeCanvas = $('loupeCanvas');
const lctx = loupeCanvas.getContext('2d');
const loupeLabel = $('loupeLabel');
const fileInput = $('file');
const toastEl = $('toast');
const pickedSwatch = $('pickedSwatch');
const pickedBig = $('pickedBig');
const valHex = $('valHex');
const valRgb = $('valRgb');
const valHsl = $('valHsl');
const autoCopyEl = $('autoCopy');
const palettePanel = $('palettePanel');
const paletteEl = $('palette');
const historyEl = $('history');
const historyHint = $('historyHint');
const btnClear = $('btn-clear');
const statFile = $('statFile');
const statPos = $('statPos');
const statHoverWrap = $('statHoverWrap');
const statDot = $('statDot');
const statHover = $('statHover');

let imageData = null;
let natural = { w: 0, h: 0 };
let pos = null;                       // текущая позиция пипетки в пикселях картинки
let picked = null;                    // последний взятый цвет {r,g,b}
let hist = [];
let settings = { autoCopy: true };

// ---------------------------------------------------------------- storage
const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const store = {
  async get(defaults) {
    if (hasChrome) return chrome.storage.local.get(defaults);
    const out = {};
    for (const [k, v] of Object.entries(defaults)) {
      try {
        const raw = localStorage.getItem(k);
        out[k] = raw === null ? v : JSON.parse(raw);
      } catch { out[k] = v; }
    }
    return out;
  },
  async set(items) {
    if (hasChrome) return chrome.storage.local.set(items);
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
  },
  async remove(key) {
    if (hasChrome) return chrome.storage.local.remove(key);
    localStorage.removeItem(key);
  },
};

// ---------------------------------------------------------------- мелочи
function clampI(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

let toastTimer = 0;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), isError ? 2800 : 1500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${text} copied`);
  } catch {
    toast('Copy failed — check clipboard permissions', true);
  }
}

// ---------------------------------------------------------------- рендер панелей
function renderPicked() {
  if (!picked) {
    pickedSwatch.classList.add('placeholder');
    pickedSwatch.style.background = '';
    pickedBig.style.color = '';
    pickedBig.textContent = 'Click the image to pick a color';
    valHex.textContent = valRgb.textContent = valHsl.textContent = '—';
    return;
  }
  const hex = toHex(picked);
  pickedSwatch.classList.remove('placeholder');
  pickedSwatch.style.background = hex;
  pickedBig.style.color = contrastInk(picked);
  pickedBig.textContent = hex;
  valHex.textContent = hex;
  valRgb.textContent = toRgbString(picked);
  valHsl.textContent = toHslString(picked);
}

function colorChip(hex, extraClass, onClick) {
  const b = document.createElement('button');
  b.className = `chip${extraClass ? ` ${extraClass}` : ''}`;
  b.style.background = hex;
  b.title = hex;
  b.setAttribute('aria-label', `Copy ${hex}`);
  b.addEventListener('click', onClick);
  return b;
}

function renderPalette(colors) {
  palettePanel.hidden = !colors.length;
  paletteEl.textContent = '';
  for (const rgb of colors) {
    const hex = toHex(rgb);
    paletteEl.appendChild(colorChip(hex, '', () => pickColor(rgb)));
  }
}

function renderHistory() {
  historyEl.textContent = '';
  for (const item of hist) {
    historyEl.appendChild(colorChip(item.hex, 'small', () => copyText(item.hex)));
  }
  historyHint.hidden = hist.length > 0;
  btnClear.hidden = hist.length === 0;
}

// ---------------------------------------------------------------- пик
function pickColor(rgb) {
  picked = { r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b) };
  hist = pushHistory(hist, picked, Date.now());
  store.set({ [K_HISTORY]: hist });
  renderPicked();
  renderHistory();
  if (settings.autoCopy) copyText(toHex(picked));
  else toast(`${toHex(picked)} picked`);
}

function pickAt(p) {
  const px = pixelAt(imageData, p.x, p.y);
  if (!px) return;
  if (px.a === 0) {
    toast('Transparent pixel — nothing to pick here', true);
    return;
  }
  pickColor(px);
  marker.classList.remove('pulse');
  void marker.offsetWidth;              // перезапуск CSS-анимации
  marker.classList.add('pulse');
}

// ---------------------------------------------------------------- лупа и курсор
function drawLoupe() {
  const size = LOUPE_GRID * LOUPE_CELL;
  lctx.imageSmoothingEnabled = false;
  // шахматка: видна за краем картинки и под прозрачными пикселями
  for (let y = 0; y < LOUPE_GRID; y++) {
    for (let x = 0; x < LOUPE_GRID; x++) {
      lctx.fillStyle = (x + y) & 1 ? '#B9BBC0' : '#D5D7DB';
      lctx.fillRect(x * LOUPE_CELL, y * LOUPE_CELL, LOUPE_CELL, LOUPE_CELL);
    }
  }
  const half = (LOUPE_GRID - 1) / 2;
  lctx.drawImage(canvas, pos.x - half, pos.y - half, LOUPE_GRID, LOUPE_GRID, 0, 0, size, size);
  lctx.strokeStyle = 'rgba(0,0,0,0.18)';
  lctx.lineWidth = 1;
  lctx.beginPath();
  for (let i = 1; i < LOUPE_GRID; i++) {
    lctx.moveTo(i * LOUPE_CELL + 0.5, 0);
    lctx.lineTo(i * LOUPE_CELL + 0.5, size);
    lctx.moveTo(0, i * LOUPE_CELL + 0.5);
    lctx.lineTo(size, i * LOUPE_CELL + 0.5);
  }
  lctx.stroke();
  // центральная ячейка: чёрная и белая рамки, чтобы читалась на любом цвете
  lctx.strokeStyle = '#000';
  lctx.strokeRect(half * LOUPE_CELL - 0.5, half * LOUPE_CELL - 0.5, LOUPE_CELL + 1, LOUPE_CELL + 1);
  lctx.strokeStyle = '#fff';
  lctx.strokeRect(half * LOUPE_CELL + 0.5, half * LOUPE_CELL + 0.5, LOUPE_CELL - 1, LOUPE_CELL - 1);
}

function updateCursor() {
  if (!imageData || !pos) return;
  const rect = canvas.getBoundingClientRect();
  const cssX = (pos.x + 0.5) * rect.width / natural.w;
  const cssY = (pos.y + 0.5) * rect.height / natural.h;
  marker.hidden = false;
  marker.style.left = `${cssX}px`;
  marker.style.top = `${cssY}px`;

  drawLoupe();
  const p = pixelAt(imageData, pos.x, pos.y);
  const hex = p ? toHex(p) : '—';
  loupeLabel.textContent = p
    ? `${hex} · ${pos.x}, ${pos.y}${p.a < 255 ? ` · α${Math.round((p.a / 255) * 100)}%` : ''}`
    : '';
  loupe.hidden = false;
  const lw = loupe.offsetWidth || LOUPE_GRID * LOUPE_CELL + 2;
  const lh = loupe.offsetHeight || LOUPE_GRID * LOUPE_CELL + 26;
  let lx = cssX + 22;
  let ly = cssY + 22;
  if (lx + lw > rect.width + 8) lx = cssX - 22 - lw;
  if (ly + lh > rect.height + 8) ly = cssY - 22 - lh;
  loupe.style.left = `${clampI(lx, -8, Math.max(-8, rect.width - lw + 8))}px`;
  loupe.style.top = `${clampI(ly, -8, Math.max(-8, rect.height - lh + 8))}px`;

  statPos.textContent = `x ${pos.x} · y ${pos.y}`;
  if (p) {
    statHoverWrap.hidden = false;
    statDot.style.background = hex;
    statHover.textContent = hex;
  }
}

function setPos(p) {
  pos = p;
  updateCursor();
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

function updateFit() {
  const rect = canvas.getBoundingClientRect();
  canvas.classList.toggle('upscaled', rect.width > natural.w + 1);
}

// ---------------------------------------------------------------- загрузка картинки
const fullRegion = (w, h) => ({ sx: 0, sy: 0, sw: w, sh: h });

/**
 * region — прямоугольник источника в его пикселях; дробный допустим (кроп
 * снимка вкладки приходит в CSS×фактический DPR). Канвас = округлённый размер
 * региона, даунскейл — только у монстров крупнее MAX_PIXELS.
 */
function setImage(source, region, label) {
  const w = Math.max(1, Math.round(region.sw));
  const h = Math.max(1, Math.round(region.sh));
  let dw = w;
  let dh = h;
  if (w * h > MAX_PIXELS) {
    const s = Math.sqrt(MAX_PIXELS / (w * h));
    dw = Math.max(1, Math.round(w * s));
    dh = Math.max(1, Math.round(h * s));
  }
  canvas.width = dw;
  canvas.height = dh;
  // при 1:1 сглаживание выключено: кроп снимка не должен размывать пиксели
  ctx.imageSmoothingEnabled = dw !== w || dh !== h;
  ctx.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, dw, dh);
  let data;
  try {
    data = ctx.getImageData(0, 0, dw, dh);
  } catch {
    toast('Could not read pixels from this image', true);
    return false;
  }
  imageData = data;
  natural = { w: dw, h: dh };
  pos = { x: Math.floor(dw / 2), y: Math.floor(dh / 2) };
  empty.hidden = true;
  stageInner.hidden = false;
  statFile.textContent = `${label || 'Image'} — ${dw}×${dh}px`;
  if (dw !== w) toast(`Huge image — downscaled to ${dw}×${dh}px to fit memory`, true);

  // прореживание: палитре хватает ~250 тыс. сэмплов и на 4000×3000
  const step = Math.max(1, Math.ceil((dw * dh) / 250000));
  renderPalette(palette(imageData, 8, step));

  updateFit();
  updateCursor();
  stage.focus({ preventScroll: true });   // стрелки работают сразу, без клика
  return true;
}

async function loadBlob(blob, label) {
  if (!blob) return;
  let bmp = null;
  try {
    bmp = await createImageBitmap(blob);
  } catch { /* SVG и прочее без поддержки в createImageBitmap — фолбэк ниже */ }
  if (bmp) {
    setImage(bmp, fullRegion(bmp.width, bmp.height), label);
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
    setImage(img, fullRegion(w, h), label);
  } catch {
    toast('This file does not look like an image', true);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadFromSrc(src, label, { crossOrigin, crop } = {}) {
  const img = new Image();
  if (crossOrigin) img.crossOrigin = 'anonymous';
  img.src = src;
  try {
    await img.decode();
  } catch {
    toast(TIER3_HINT, true);
    return;
  }
  if (crop) {
    // Снимок вкладки = CSS-пиксели × devicePixelRatio, причём дробный (2.28
    // замерено). Масштаб меряем по факту — размер снимка на размер вьюпорта,
    // а не по заявленному DPR — иначе пипетка мажет.
    const scaleX = img.naturalWidth / crop.viewportW;
    const scaleY = img.naturalHeight / crop.viewportH;
    setImage(img, {
      sx: crop.x * scaleX,
      sy: crop.y * scaleY,
      sw: Math.max(1, crop.w * scaleX),
      sh: Math.max(1, crop.h * scaleY),
    }, label);
    return;
  }
  setImage(img, fullRegion(img.naturalWidth, img.naturalHeight), label);
}

async function consumeIncoming(v) {
  if (!v || !v.kind) return;
  await store.remove(K_INCOMING);
  const label = v.label || 'Image';
  if (v.kind === 'hint') {
    toast(TIER3_HINT, true);
    return;
  }
  if (!v.src) return;
  if (v.kind === 'capture') {
    const c = v.crop;
    const okCrop = c
      && [c.x, c.y, c.w, c.h, c.viewportW, c.viewportH].every(Number.isFinite)
      && c.w > 0 && c.h > 0 && c.viewportW > 0 && c.viewportH > 0;
    // битый кроп — не повод падать: целый снимок всё ещё полезен
    await loadFromSrc(v.src, label, okCrop ? { crop: c } : {});
    return;
  }
  await loadFromSrc(v.src, label, { crossOrigin: v.kind === 'url' });
}

// ---------------------------------------------------------------- события: мышь
canvas.addEventListener('mousemove', (e) => {
  const p = eventToPos(e);
  if (p) setPos(p);
});
canvas.addEventListener('click', (e) => {
  const p = eventToPos(e);
  if (!p) return;
  setPos(p);
  pickAt(p);
  stage.focus({ preventScroll: true });
});

// ---------------------------------------------------------------- события: клавиатура
const KEY_DELTA = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};
document.addEventListener('keydown', (e) => {
  if (!imageData) return;
  // не перехватываем клавиатуру у контролов (Enter на кнопке — это кнопка)
  if (e.target instanceof Element && e.target.closest('button, input, select, textarea, a')) return;
  const d = KEY_DELTA[e.key];
  if (d) {
    e.preventDefault();
    if (!pos) {
      // после Esc стрелка возвращает прицел в центр — клавиатура не «умирает»
      setPos({ x: Math.floor(natural.w / 2), y: Math.floor(natural.h / 2) });
      return;
    }
    const step = e.ctrlKey || e.altKey || e.metaKey ? 10 : 1;
    setPos({
      x: clampI(pos.x + d[0] * step, 0, natural.w - 1),
      y: clampI(pos.y + d[1] * step, 0, natural.h - 1),
    });
  } else if (e.key === 'Enter') {
    if (!pos) return;
    e.preventDefault();
    pickAt(pos);
  } else if (e.key === 'Escape') {
    // Esc убирает прицел и лупу (паритет с веб-версией на сайте)
    e.preventDefault();
    pos = null;
    marker.hidden = true;
    loupe.hidden = true;
    statPos.textContent = '';
    statHoverWrap.hidden = true;
  }
});

// ---------------------------------------------------------------- события: вставка и drag&drop
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      e.preventDefault();
      loadBlob(it.getAsFile(), 'Pasted image');
      return;
    }
  }
  const f = e.clipboardData?.files?.[0];
  if (f && f.type.startsWith('image/')) {
    e.preventDefault();
    loadBlob(f, f.name || 'Pasted image');
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) {
    loadBlob(f, f.name);
    return;
  }
  // картинку тащат прямо с чужой страницы: файла нет, только URL — офлайн его не скачать
  if (e.dataTransfer?.types.includes('text/uri-list')) {
    toast('Dragging from another page won’t work offline. Right-click the image → “Copy image”, then Ctrl+V here', true);
  }
});

// ---------------------------------------------------------------- события: контролы
$('btn-open').addEventListener('click', () => fileInput.click());
$('btn-browse').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadBlob(f, f.name);
  fileInput.value = '';               // повторный выбор того же файла снова даёт change
});

for (const btn of document.querySelectorAll('.val')) {
  btn.addEventListener('click', () => {
    if (!picked) {
      toast('Pick a color first', true);
      return;
    }
    copyText(btn.querySelector('.v').textContent);
  });
}

autoCopyEl.addEventListener('change', () => {
  settings.autoCopy = autoCopyEl.checked;
  store.set({ [K_SETTINGS]: settings });
});

btnClear.addEventListener('click', () => {
  hist = [];
  store.set({ [K_HISTORY]: hist });
  renderHistory();
  toast('History cleared');
});

window.addEventListener('resize', () => {
  if (!imageData) return;
  updateFit();
  updateCursor();
});

// ---------------------------------------------------------------- старт
loupeCanvas.width = loupeCanvas.height = LOUPE_GRID * LOUPE_CELL;

(async function init() {
  const got = await store.get({
    [K_HISTORY]: [],
    [K_SETTINGS]: { autoCopy: true },
    [K_INCOMING]: null,
  });
  hist = Array.isArray(got[K_HISTORY]) ? got[K_HISTORY] : [];
  settings = { autoCopy: true, ...got[K_SETTINGS] };
  autoCopyEl.checked = !!settings.autoCopy;
  renderPicked();
  renderHistory();
  await consumeIncoming(got[K_INCOMING]);
})();

if (hasChrome) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[K_INCOMING]?.newValue) {
      consumeIncoming(changes[K_INCOMING].newValue);
    }
  });
}
