/**
 * Тесты попапа: история из pp-history, копия с подтверждением, открытие пикера
 * (включая переиспользование открытой вкладки), «Grab this page» с порядком
 * «снимок → storage → вкладка», честная ошибка на защищённых страницах.
 * Реальный popup.html + window.eval(popup.js) — как в харнесе пилота.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { makeChrome } from './chrome-mock.mjs';

const HTML = readFileSync(new URL('../extension-chrome/src/popup.html', import.meta.url), 'utf8');
const SRC = readFileSync(new URL('../extension-chrome/src/popup.js', import.meta.url), 'utf8');
const APP_URL = 'chrome-extension://test/src/app.html';

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}
const flush = (ms = 15) => new Promise((r) => setTimeout(r, ms));

function boot(opts = {}, { clipboardFail = false } = {}) {
  const env = makeChrome(opts);
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const win = dom.window;
  win.chrome = env.chrome;
  env.copied = [];
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text) => {
        if (clipboardFail) return Promise.reject(new Error('denied'));
        env.copied.push(text);
        return Promise.resolve();
      },
    },
  });
  env.closed = 0;
  win.close = () => { env.closed++; };
  win.eval(SRC);
  env.win = win;
  env.doc = win.document;
  return env;
}

const click = (env, el) => el.dispatchEvent(new env.win.Event('click', { bubbles: true }));
const chips = (env) => [...env.doc.querySelectorAll('#history .chip')];

await t('история рендерится из pp-history: чипы, Clear виден, подсказка спрятана', async () => {
  const env = boot({ store: { 'pp-history': [{ hex: '#FF0000' }, { hex: '#00FF00' }] } });
  await flush();
  assert.deepEqual(chips(env).map((c) => c.title), ['#FF0000', '#00FF00']);
  assert.equal(env.doc.getElementById('historyHint').hidden, true);
  assert.equal(env.doc.getElementById('btn-clear').hidden, false);
});

await t('пустая история: подсказка видна, Clear спрятан', async () => {
  const env = boot();
  await flush();
  assert.equal(chips(env).length, 0);
  assert.equal(env.doc.getElementById('historyHint').hidden, false);
  assert.equal(env.doc.getElementById('btn-clear').hidden, true);
});

await t('клик по чипу: копия в буфер + статус с подтверждением', async () => {
  const env = boot({ store: { 'pp-history': [{ hex: '#2AA8A0' }] } });
  await flush();
  click(env, chips(env)[0]);
  await flush();
  assert.deepEqual(env.copied, ['#2AA8A0']);
  assert.ok(env.doc.getElementById('status').textContent.includes('#2AA8A0 copied'));
});

await t('буфер недоступен: честная ошибка, не молчание', async () => {
  const env = boot({ store: { 'pp-history': [{ hex: '#000000' }] } }, { clipboardFail: true });
  await flush();
  click(env, chips(env)[0]);
  await flush();
  const status = env.doc.getElementById('status');
  assert.ok(status.textContent.includes('Copy failed'), status.textContent);
  assert.ok(status.classList.contains('error'));
});

await t('Open picker: вкладки нет → создаётся, попап закрывается', async () => {
  const env = boot();
  await flush();
  click(env, env.doc.getElementById('btn-open'));
  await flush();
  assert.equal(env.calls.created[0].url, APP_URL);
  assert.equal(env.closed, 1);
});

await t('Open picker: вкладка уже открыта → фокус, дубль не создаётся', async () => {
  const env = boot({ tabs: [{ id: 5, windowId: 2, url: APP_URL }] });
  await flush();
  click(env, env.doc.getElementById('btn-open'));
  await flush();
  assert.equal(env.calls.created.length, 0);
  // объекты рождаются в jsdom-релме: сравниваем структуру, не прототипы
  assert.equal(JSON.stringify(env.calls.updated[0]), '[5,{"active":true}]');
  assert.equal(JSON.stringify(env.calls.winUpdated[0]), '[2,{"focused":true}]');
  assert.equal(env.closed, 1);
});

await t('Grab this page: снимок → pp-incoming(kind:dataurl, label=title) → пикер', async () => {
  const env = boot({ activeTab: { id: 9, title: 'Example Page' } });
  await flush();
  click(env, env.doc.getElementById('btn-grab'));
  await flush();
  const inc = env.state.store['pp-incoming'];
  assert.equal(inc.kind, 'dataurl');
  assert.equal(inc.src, 'data:image/png;base64,SHOT');
  assert.equal(inc.label, 'Example Page');
  const o = env.calls.order;
  assert.ok(o.indexOf('capture') < o.indexOf('set') && o.indexOf('set') < o.indexOf('create'),
    `порядок обязан быть capture→set→create: ${o.join(',')}`);
  assert.equal(env.closed, 1);
});

await t('Grab на защищённой вкладке: честная ошибка, ничего не открыто', async () => {
  const env = boot({ captureError: true });
  await flush();
  click(env, env.doc.getElementById('btn-grab'));
  await flush();
  const status = env.doc.getElementById('status');
  assert.ok(status.textContent.includes('can’t be captured'), status.textContent);
  assert.ok(status.classList.contains('error'));
  assert.equal(env.state.store['pp-incoming'], undefined);
  assert.equal(env.calls.created.length, 0);
  assert.equal(env.closed, 0);
});

await t('Clear: история пустеет в storage и в DOM', async () => {
  const env = boot({ store: { 'pp-history': [{ hex: '#123456' }] } });
  await flush();
  click(env, env.doc.getElementById('btn-clear'));
  await flush();
  assert.equal(JSON.stringify(env.state.store['pp-history']), '[]');
  assert.equal(chips(env).length, 0);
  assert.equal(env.doc.getElementById('historyHint').hidden, false);
});

await t('storage.onChanged: пик в открытом пикере сразу виден в попапе', async () => {
  const env = boot();
  await flush();
  assert.equal(chips(env).length, 0);
  for (const fn of env.calls.changedListeners) {
    fn({ 'pp-history': { newValue: [{ hex: '#AA0000' }, { hex: '#00AA00' }, { hex: '#0000AA' }] } }, 'local');
  }
  await flush();
  assert.equal(chips(env).length, 3);
  assert.equal(chips(env)[0].title, '#AA0000');
});

console.log(`popup: ${passed} тестов пройдено`);
