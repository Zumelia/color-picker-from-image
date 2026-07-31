/**
 * PixelPeek core — чистая логика без DOM-зависимостей и без chrome.*.
 * Единственный источник правды; extension-chrome/src/core.js — сгенерированная копия
 * (npm run sync), расхождение ловит test/sync.test.mjs.
 *
 * Здесь: конвертация цветов, чтение пикселя из ImageData, квантование палитры,
 * работа с историей. Всё тестируется в node без браузера.
 */

// ---------------------------------------------------------------- цвет

/** Компонента 0..255 -> двухсимвольный hex. */
function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** {r,g,b} -> "#RRGGBB" (заглавными: дизайнеры копируют в Figma именно так). */
export function toHex({ r, g, b }) {
  return ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase();
}

/** {r,g,b} -> "rgb(r, g, b)". */
export function toRgbString({ r, g, b }) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** {r,g,b} 0..255 -> {h:0..360, s:0..100, l:0..100}. */
export function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn: h = ((gn - bn) / d) % 6; break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** {r,g,b} -> "hsl(h, s%, l%)". */
export function toHslString(rgb) {
  const { h, s, l } = rgbToHsl(rgb);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Относительная яркость по WCAG — нужна, чтобы подобрать читаемый цвет подписи на плашке. */
export function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Чёрный или белый текст поверх данного цвета. */
export function contrastInk(rgb) {
  return luminance(rgb) > 0.4 ? '#16181D' : '#FFFFFF';
}

// ---------------------------------------------------------------- пиксели

/**
 * Цвет одного пикселя из ImageData-подобного объекта {width, height, data}.
 * Координаты в пикселях ИСХОДНОГО изображения (не CSS!) — вызывающий обязан
 * сам поделить на devicePixelRatio/масштаб канваса. Возвращает null вне границ.
 */
export function pixelAt(imageData, x, y) {
  const px = Math.floor(x), py = Math.floor(y);
  if (!imageData || px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) return null;
  const i = (py * imageData.width + px) * 4;
  const d = imageData.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

/**
 * Средний цвет квадрата size×size вокруг (x,y) — режим сэмплинга для шумных фото.
 * Прозрачные пиксели (a=0) не учитываются: иначе край PNG «затемняет» среднее.
 */
export function averageAt(imageData, x, y, size = 3) {
  const half = Math.floor(size / 2);
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const p = pixelAt(imageData, x + dx, y + dy);
      if (p && p.a > 0) { r += p.r; g += p.g; b += p.b; n++; }
    }
  }
  if (!n) return null;
  return { r: r / n, g: g / n, b: b / n, a: 255 };
}

// ---------------------------------------------------------------- палитра

/**
 * Доминирующие цвета методом median cut.
 * Прозрачные пиксели отбрасываются; крупные картинки прореживаются шагом step,
 * чтобы палитра считалась мгновенно даже на 4000×3000.
 */
export function palette(imageData, count = 6, step = 4) {
  if (!imageData || !imageData.data || !imageData.width) return [];
  const px = [];
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4 * step) {
    if (d[i + 3] < 128) continue;             // прозрачное не участвует
    px.push([d[i], d[i + 1], d[i + 2]]);
  }
  if (!px.length) return [];

  const target = Math.max(1, Math.min(count, 16));
  let buckets = [px];
  while (buckets.length < target) {
    // делим бакет с наибольшим разбросом по самому «широкому» каналу
    let bi = 0, bestRange = -1, bestCh = 0;
    buckets.forEach((bucket, idx) => {
      if (bucket.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 255, mx = 0;
        for (const p of bucket) { if (p[ch] < mn) mn = p[ch]; if (p[ch] > mx) mx = p[ch]; }
        if (mx - mn > bestRange) { bestRange = mx - mn; bi = idx; bestCh = ch; }
      }
    });
    if (bestRange <= 0) break;                 // делить больше нечего
    const bucket = buckets[bi].slice().sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(bi, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  // Флэт-картинки (логотипы, UI-скрины) дробятся на корзины с одинаковой
  // модой — дубли схлопываем; палитра может выйти короче count, это честнее,
  // чем один цвет четырьмя плашками.
  const seen = new Set();
  return buckets
    .filter((b) => b.length)
    .map((b) => ({ rgb: representative(b), weight: b.length }))
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.rgb)
    .filter((c) => {
      const hex = toHex(c);
      if (seen.has(hex)) return false;
      seen.add(hex);
      return true;
    });
}

/**
 * Представитель бакета. НЕ среднее: усреднение выдаёт цвет, которого в картинке
 * может не быть вовсе (90% белого + 10% чёрного в одном бакете дают серый — и
 * дизайнер копирует несуществующий оттенок). Берём моду: квантуем до 32 уровней
 * на канал, находим самую населённую корзину и усредняем ТОЛЬКО её пиксели —
 * получается реальный доминирующий цвет с точностью до оттенка.
 */
function representative(bucket) {
  const key = (p) => ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
  const bins = new Map();
  for (const p of bucket) {
    const k = key(p);
    const bin = bins.get(k);
    if (bin) { bin.n++; bin.r += p[0]; bin.g += p[1]; bin.b += p[2]; }
    else bins.set(k, { n: 1, r: p[0], g: p[1], b: p[2] });
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

// ---------------------------------------------------------------- история

export const HISTORY_LIMIT = 50;

/**
 * Добавляет цвет в историю: новые сверху, дубликаты подтягиваются наверх
 * (а не плодятся), длина ограничена HISTORY_LIMIT.
 */
export function pushHistory(history, rgb, at = 0) {
  const hex = toHex(rgb);
  const rest = (history || []).filter((x) => x.hex !== hex);
  return [{ hex, r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b), at }, ...rest]
    .slice(0, HISTORY_LIMIT);
}

// ---------------------------------------------------------------- геометрия

/**
 * Перевод координат клика в пиксели исходного изображения.
 * Учитывает и масштаб отображения (картинка вписана в окно), и devicePixelRatio
 * снимка вкладки — главный источник промахов пипетки на retina и дробном зуме.
 */
export function toImageCoords({ clientX, clientY, rect, naturalWidth, naturalHeight }) {
  if (!rect || !rect.width || !rect.height) return null;
  const sx = naturalWidth / rect.width;
  const sy = naturalHeight / rect.height;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}
