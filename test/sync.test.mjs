/**
 * Страж сгенерированной копии ядра: extension-chrome/src/core.js обязан быть
 * байт-в-байт core/core.js плюс предупреждающий заголовок первой строкой.
 * Разошлись — значит правили копию или забыли npm run sync.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('core/core.js', root), 'utf8');
const copy = readFileSync(new URL('extension-chrome/src/core.js', root), 'utf8');

const nl = copy.indexOf('\n');
assert.ok(copy.slice(0, nl).includes('GENERATED FILE'), 'копия ядра без предупреждающего заголовка');
assert.equal(
  copy.slice(nl + 1), src,
  'extension-chrome/src/core.js разошёлся с core/core.js — запусти npm run sync',
);

console.log('sync: копия ядра совпадает с исходником');
