/**
 * Тесты ядра PixelPeek. Запуск: node test/core.test.mjs
 * Без браузера и без chrome.* — только чистые функции.
 */
import assert from 'node:assert/strict';
import {
  toHex, toRgbString, rgbToHsl, toHslString, luminance, contrastInk,
  pixelAt, averageAt, palette, pushHistory, HISTORY_LIMIT, toImageCoords,
} from '../core/core.js';

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------- цвет
t('toHex: заглавные, с ведущими нулями', () => {
  assert.equal(toHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(toHex({ r: 255, g: 255, b: 255 }), '#FFFFFF');
  assert.equal(toHex({ r: 42, g: 168, b: 160 }), '#2AA8A0');   // teal бренда
  assert.equal(toHex({ r: 1, g: 2, b: 3 }), '#010203');
});

t('toHex: округляет и зажимает выход за диапазон', () => {
  assert.equal(toHex({ r: 254.6, g: -5, b: 300 }), '#FF00FF');
});

t('toRgbString', () => {
  assert.equal(toRgbString({ r: 42, g: 168, b: 160 }), 'rgb(42, 168, 160)');
  assert.equal(toRgbString({ r: 41.5, g: 0, b: 0 }), 'rgb(42, 0, 0)');
});

t('rgbToHsl: базовые цвета', () => {
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 255, b: 0 }), { h: 120, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 255 }), { h: 240, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, l: 100 });
  assert.deepEqual(rgbToHsl({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, l: 50 });
});

t('toHslString', () => {
  assert.equal(toHslString({ r: 255, g: 0, b: 0 }), 'hsl(0, 100%, 50%)');
});

t('contrastInk: тёмный текст на светлом и наоборот', () => {
  assert.equal(contrastInk({ r: 255, g: 255, b: 255 }), '#16181D');
  assert.equal(contrastInk({ r: 0, g: 0, b: 0 }), '#FFFFFF');
  assert.ok(luminance({ r: 255, g: 255, b: 255 }) > luminance({ r: 0, g: 0, b: 0 }));
});

// ---------------------------------------------------------------- пиксели
function makeImageData(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = fill(i % w, Math.floor(i / w));
    data.set([r, g, b, a], i * 4);
  }
  return { width: w, height: h, data };
}

t('pixelAt: читает нужный пиксель', () => {
  const img = makeImageData(3, 2, (x, y) => [x * 10, y * 20, 5, 255]);
  assert.deepEqual(pixelAt(img, 0, 0), { r: 0, g: 0, b: 5, a: 255 });
  assert.deepEqual(pixelAt(img, 2, 1), { r: 20, g: 20, b: 5, a: 255 });
});

t('pixelAt: вне границ -> null (а не мусор из соседней строки)', () => {
  const img = makeImageData(2, 2, () => [1, 2, 3, 255]);
  assert.equal(pixelAt(img, -1, 0), null);
  assert.equal(pixelAt(img, 0, -1), null);
  assert.equal(pixelAt(img, 2, 0), null);
  assert.equal(pixelAt(img, 0, 2), null);
});

t('pixelAt: дробные координаты обрезаются вниз', () => {
  const img = makeImageData(2, 1, (x) => [x * 100, 0, 0, 255]);
  assert.equal(pixelAt(img, 1.99, 0.4).r, 100);
});

t('averageAt: среднее по окну', () => {
  const img = makeImageData(3, 3, () => [10, 20, 30, 255]);
  assert.deepEqual(averageAt(img, 1, 1, 3), { r: 10, g: 20, b: 30, a: 255 });
});

t('averageAt: прозрачные пиксели не занижают среднее', () => {
  const img = makeImageData(3, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [200, 200, 200, 255]));
  const avg = averageAt(img, 1, 0, 3);
  assert.equal(Math.round(avg.r), 200);
});

// ---------------------------------------------------------------- палитра
t('palette: два явных кластера -> два цвета', () => {
  const img = makeImageData(20, 20, (x) => (x < 10 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const p = palette(img, 2, 1);
  assert.equal(p.length, 2);
  const hexes = p.map(toHex).sort();
  assert.deepEqual(hexes, ['#0000FF', '#FF0000']);
});

t('palette: одноцветная картинка не падает и не плодит дубли', () => {
  const img = makeImageData(8, 8, () => [42, 168, 160, 255]);
  const p = palette(img, 6, 1);
  assert.ok(p.length >= 1);
  assert.equal(toHex(p[0]), '#2AA8A0');
});

t('palette: полностью прозрачная -> пусто, без исключения', () => {
  const img = makeImageData(4, 4, () => [0, 0, 0, 0]);
  assert.deepEqual(palette(img, 6, 1), []);
});

t('РЕГРЕССИЯ: флэт-картинка из 3 цветов не плодит дубли на 8 корзин', () => {
  // найдено живым прогоном 2026-07-31: median cut дробил три плоских цвета
  // на 8 корзин с одинаковыми модами — палитра показывала #FF0000 четырежды
  const img = makeImageData(12, 12, (x, y) => {
    if (y < 6) return x < 6 ? [255, 0, 0, 255] : [0, 102, 255, 255];
    return x < 6 ? [255, 213, 0, 255] : [0, 0, 0, 0];
  });
  const hexes = palette(img, 8, 1).map(toHex);
  assert.equal(new Set(hexes).size, hexes.length, `дубли в палитре: ${hexes.join(',')}`);
  assert.deepEqual([...hexes].sort(), ['#0066FF', '#FF0000', '#FFD500']);
});

t('palette: сортировка по весу (доминирующий первым)', () => {
  const img = makeImageData(10, 10, (x) => (x < 9 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const p = palette(img, 2, 1);
  assert.equal(toHex(p[0]), '#FFFFFF');
});

// ---------------------------------------------------------------- история
t('pushHistory: новые сверху', () => {
  let h = [];
  h = pushHistory(h, { r: 255, g: 0, b: 0 });
  h = pushHistory(h, { r: 0, g: 255, b: 0 });
  assert.equal(h[0].hex, '#00FF00');
  assert.equal(h.length, 2);
});

t('pushHistory: дубликат не плодится, а поднимается', () => {
  let h = [];
  h = pushHistory(h, { r: 255, g: 0, b: 0 });
  h = pushHistory(h, { r: 0, g: 255, b: 0 });
  h = pushHistory(h, { r: 255, g: 0, b: 0 });
  assert.equal(h.length, 2);
  assert.equal(h[0].hex, '#FF0000');
});

t('pushHistory: не длиннее лимита', () => {
  let h = [];
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = pushHistory(h, { r: i, g: 0, b: 0 });
  assert.equal(h.length, HISTORY_LIMIT);
});

// ---------------------------------------------------------------- геометрия
t('toImageCoords: масштаб отображения учтён', () => {
  const c = toImageCoords({
    clientX: 150, clientY: 100,
    rect: { left: 100, top: 50, width: 100, height: 100 },
    naturalWidth: 1000, naturalHeight: 1000,
  });
  assert.deepEqual(c, { x: 500, y: 500 });
});

t('toImageCoords: дробный devicePixelRatio (снимок вкладки 2.28) не мажет', () => {
  // вкладка 800 CSS-px, снимок 1824 px => картинка вдвое с хвостом больше рамки
  const c = toImageCoords({
    clientX: 400, clientY: 0,
    rect: { left: 0, top: 0, width: 800, height: 600 },
    naturalWidth: 1824, naturalHeight: 1368,
  });
  assert.equal(Math.round(c.x), 912);
});

t('toImageCoords: нулевая рамка -> null, без деления на ноль', () => {
  assert.equal(toImageCoords({
    clientX: 0, clientY: 0, rect: { left: 0, top: 0, width: 0, height: 0 },
    naturalWidth: 10, naturalHeight: 10,
  }), null);
});

// ---------------------------------------------------------------- регрессия
t('РЕГРЕССИЯ: палитра не выдумывает цвет, которого нет в картинке', () => {
  // 90% белого + 10% чёрного: усреднение бакета давало #CCCCCC — оттенок,
  // которого на картинке нет ни в одном пикселе. Дизайнер копировал ложь.
  const img = makeImageData(10, 10, (x) => (x < 9 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const present = new Set(['#FFFFFF', '#000000']);
  for (const c of palette(img, 4, 1)) {
    assert.ok(present.has(toHex(c)), `палитра выдала ${toHex(c)}, которого нет в изображении`);
  }
});

t('РЕГРЕССИЯ: доминирующий цвет фотоподобного шума — реальный, не усреднённый', () => {
  // фон #2AA8A0 с редкими шумовыми точками: мода обязана вернуть именно фон
  const img = makeImageData(20, 20, (x, y) =>
    (x === 3 && y === 3) ? [250, 10, 10, 255] : [42, 168, 160, 255]);
  assert.equal(toHex(palette(img, 3, 1)[0]), '#2AA8A0');
});

console.log(`core: ${passed} тестов пройдено`);
