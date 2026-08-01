/**
 * Тесты сервис-воркера: меню, лестница тиров (включая съезд по квоте storage),
 * переиспользование открытой вкладки пикера, probeImage в jsdom-странице.
 * SW исполняется как у пилота: new Function('chrome', SRC).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { makeChrome } from './chrome-mock.mjs';

const SRC = readFileSync(new URL('../extension-chrome/src/background.js', import.meta.url), 'utf8');
const APP_URL = 'chrome-extension://test/src/app.html';
const MENU = { menuItemId: 'pp-pick-image', srcUrl: 'https://x.example/logo.png' };
const TAB = { id: 7, windowId: 1 };

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}
const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function boot(opts) {
  const env = makeChrome(opts);
  new Function('chrome', SRC)(env.chrome);
  return env;
}

const WELCOME = 'https://colorpickfromimage.com/welcome/';
const UNINSTALL = 'https://colorpickfromimage.com/uninstall/?v=0.1.1';

await t('onInstalled(install): меню пересоздано, welcome открыт, uninstall-URL стоит', async () => {
  const { handlers, calls } = boot();
  handlers.installed({ reason: 'install' });
  await flush();
  assert.equal(calls.removeAll, 1);
  assert.equal(calls.menus.length, 1);
  assert.equal(calls.menus[0].id, 'pp-pick-image');
  assert.deepEqual(calls.menus[0].contexts, ['image']);
  assert.equal(calls.created.length, 1, 'welcome открывается ровно один раз');
  assert.equal(calls.created[0].url, WELCOME);
  assert.equal(calls.uninstallUrl, UNINSTALL);
});

await t('onInstalled(update): меню пересоздано, welcome НЕ открывается, uninstall-URL переставлен', async () => {
  const { handlers, calls } = boot();
  handlers.installed({ reason: 'update' });
  await flush();
  assert.equal(calls.menus.length, 1);
  assert.equal(calls.created.length, 0, 'welcome только на install');
  assert.equal(calls.uninstallUrl, UNINSTALL, 'после апдейта URL слетает — ставим заново');
});

await t('тир 1: ACAO есть → kind:dataurl, снимок не снимается, вкладка открыта', async () => {
  const env = boot({ execResult: { dataUrl: 'data:image/png;base64,PIX', name: 'logo.png', visible: null } });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  const inc = env.state.store['pp-incoming'];
  assert.equal(inc.kind, 'dataurl');
  assert.equal(inc.src, 'data:image/png;base64,PIX');
  assert.equal(inc.label, 'logo.png');
  assert.equal(env.calls.captures, 0);
  assert.equal(env.calls.created[0].url, APP_URL);
});

await t('открытый пикер переиспользуется: фокус вместо новой вкладки', async () => {
  const env = boot({
    execResult: { dataUrl: 'data:,x', name: 'a.png', visible: null },
    tabs: [{ id: 5, windowId: 2, url: APP_URL }],
  });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  assert.equal(env.calls.created.length, 0, 'вторая вкладка пикера не создаётся');
  assert.deepEqual(env.calls.updated[0], [5, { active: true }]);
  assert.deepEqual(env.calls.winUpdated[0], [2, { focused: true }]);
});

await t('тир 2: без ACAO → captureVisibleTab + кроп; снимок ДО открытия вкладки', async () => {
  const visible = { x: 1, y: 2, w: 30, h: 40, viewportW: 800, viewportH: 600 };
  const env = boot({ execResult: { dataUrl: null, name: 'cdn.png', visible } });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  const inc = env.state.store['pp-incoming'];
  assert.equal(inc.kind, 'capture');
  assert.equal(inc.src, 'data:image/png;base64,SHOT');
  assert.deepEqual(inc.crop, visible);
  const o = env.calls.order;
  assert.ok(o.indexOf('capture') < o.indexOf('create'),
    `снимок должен быть до открытия пикера: ${o.join(',')}`);
});

await t('квота storage: PNG-гигант тира 1 не влез → съезд в тир 2', async () => {
  const visible = { x: 0, y: 0, w: 10, h: 10, viewportW: 100, viewportH: 100 };
  const env = boot({
    execResult: { dataUrl: 'data:image/png;base64,HUGE', name: 'big.png', visible },
    failSetTimes: 1,
  });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  const inc = env.state.store['pp-incoming'];
  assert.equal(inc.kind, 'capture', 'после квоты обязан приехать снимок, а не молчание');
  assert.equal(env.calls.captures, 1);
});

await t('инъекция запрещена (chrome://, PDF) → kind:hint, пикер всё равно открыт', async () => {
  const env = boot({ execError: true });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  assert.equal(env.state.store['pp-incoming'].kind, 'hint');
  assert.equal(env.calls.created.length, 1);
});

await t('снимок не удался → kind:hint, не молчим', async () => {
  const env = boot({
    execResult: { dataUrl: null, name: 'x.png', visible: { x: 0, y: 0, w: 5, h: 5, viewportW: 10, viewportH: 10 } },
    captureError: true,
  });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  assert.equal(env.state.store['pp-incoming'].kind, 'hint');
});

await t('чужой пункт меню и вкладка без числового id игнорируются', async () => {
  const env = boot({ execResult: { dataUrl: 'data:,x', name: 'a', visible: null } });
  env.handlers.menuClick({ menuItemId: 'other', srcUrl: 'u' }, TAB);
  env.handlers.menuClick(MENU, {});
  env.handlers.menuClick(MENU, undefined);
  await flush();
  assert.equal(env.state.store['pp-incoming'], undefined);
  assert.equal(env.calls.created.length, 0);
});

// ---------------------------------------------------------------- probeImage
// Функция уезжает в страницу через chrome.scripting — достаём её из записанных
// опций executeScript и гоняем в jsdom-окне с подменёнными глобалами.
async function grabProbe() {
  const env = boot({ execResult: null });
  env.handlers.menuClick(MENU, TAB);
  await flush();
  const func = env.calls.execOpts[0].func;
  assert.equal(typeof func, 'function', 'executeScript должен получить функцию');
  return func;
}

async function inPage(html, fn) {
  const dom = new JSDOM(html, { url: 'https://site.example/page' });
  const win = dom.window;
  class NeverImage {
    set src(v) { /* jsdom не грузит сеть: onload/onerror молчат — как CDN без ACAO */ }
  }
  const g = globalThis;
  const saved = { document: g.document, window: g.window, Image: g.Image, location: g.location };
  g.document = win.document;
  g.window = win;
  g.Image = NeverImage;
  g.location = { href: 'https://site.example/page' };
  try {
    return await fn(win);
  } finally {
    Object.assign(g, saved);
  }
}

await t('probeImage: имя из URL (decodeURIComponent), видимая часть клампится, таймаут → dataUrl null', async () => {
  const probe = await grabProbe();
  const SRCURL = 'https://cdn.example/pics/logo%20v2.png';
  const res = await inPage('<img id="i">', async (win) => {
    const img = win.document.getElementById('i');
    img.setAttribute('src', SRCURL);
    Object.defineProperty(img, 'currentSrc', { value: SRCURL });
    img.getBoundingClientRect = () => ({ left: -20, top: 10, right: 300, bottom: 500 });
    return probe(SRCURL, 40);
  });
  assert.equal(res.dataUrl, null, 'без ACAO-загрузки только таймаут');
  assert.equal(res.name, 'logo v2.png');
  // jsdom-вьюпорт 1024×768; left −20 обрезан нулём
  assert.deepEqual(res.visible, { x: 0, y: 10, w: 300, h: 490, viewportW: 1024, viewportH: 768 });
});

await t('probeImage: картинка вне DOM или невидима → visible null', async () => {
  const probe = await grabProbe();
  const res = await inPage('<img id="i" src="https://cdn.example/a.png">', async (win) => {
    // рамка по умолчанию нулевая (jsdom) = скрыта/за экраном
    const img = win.document.getElementById('i');
    Object.defineProperty(img, 'currentSrc', { value: 'https://cdn.example/a.png' });
    return probe('https://cdn.example/a.png', 30);
  });
  assert.equal(res.visible, null);
  assert.equal(res.name, 'a.png');
});

await t('probeImage: data:-URL не превращается в мусорное имя', async () => {
  const probe = await grabProbe();
  const res = await inPage('<p>no images</p>', () => probe('data:image/png;base64,AAA', 20));
  assert.equal(res.name, 'Image');
  assert.equal(res.visible, null);
});

console.log(`background: ${passed} тестов пройдено`);
