/**
 * PixelPeek popup — быстрый доступ: открыть пикер, снять снимок вкладки,
 * скопировать недавний цвет. Историю пишет app.js (ключ pp-history);
 * ядро тут не нужно — hex уже посчитан при пике.
 *
 * «Grab this page» живёт именно здесь: клик по иконке — это жест, дающий
 * activeTab, поэтому captureVisibleTab доступен прямо из попапа, без фонового
 * скрипта. Снимок уходит в пикер через контракт pp-incoming (см. app.js).
 * EyeDropper'а в попапе сознательно НЕТ: SPEC §3 P2 требует вызывать его
 * со страницы расширения.
 *
 * Обёрнуто в IIFE под jsdom-харнес (window.eval, как в пилоте).
 */
(() => {
  const K_HISTORY = 'pp-history';
  const K_INCOMING = 'pp-incoming';
  const K_HIGHLIGHT = 'pp-highlight-grab';  // сигнал из пикера: подсветить Grab
  const APP_URL = 'app.html';         // относительный путь: попап и пикер лежат рядом в src/

  // Заполнить при публикации: https://chromewebstore.google.com/detail/<id>/reviews
  // Пустая строка = кнопка спрятана (вести в никуда хуже, чем не вести — правило пилота)
  const RATE_URL = '';

  const $ = (id) => document.getElementById(id);
  const historyEl = $('history');
  const historyHint = $('historyHint');
  const btnClear = $('btn-clear');
  const statusEl = $('status');

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

  /**
   * Ужимает PNG-dataUrl до квоты storage.local (10 МБ): на retina-мониторах
   * (DPR 2+) снимок вкладки в base64 может не влезать. Несколько шагов ×0.75;
   * не вышло — null, вызывающий покажет честную ошибку.
   */
  async function shrinkDataUrl(dataUrl, tries) {
    const LIMIT = 9_000_000;
    let src = dataUrl;
    for (let i = 0; i < tries; i++) {
      const img = await new Promise((resolve) => {
        const im = new Image();
        const timer = setTimeout(() => resolve(null), 800);
        im.onload = () => { clearTimeout(timer); resolve(im); };
        im.onerror = () => { clearTimeout(timer); resolve(null); };
        im.src = src;
      });
      if (!img || !img.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * 0.75));
      c.height = Math.max(1, Math.round(img.naturalHeight * 0.75));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      src = c.toDataURL('image/png');
      if (src.length < LIMIT) return src;
    }
    return null;
  }

  let statusTimer = 0;
  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, isError ? 4000 : 1600);
  }

  function renderHistory(hist) {
    historyEl.textContent = '';
    for (const item of hist) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.style.background = item.hex;
      b.title = item.hex;
      b.setAttribute('aria-label', `Copy ${item.hex}`);
      b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.hex);
          setStatus(`${item.hex} copied ✓`);
          b.classList.add('flash');
          setTimeout(() => b.classList.remove('flash'), 400);
        } catch {
          setStatus('Copy failed — check clipboard permissions', true);
        }
      });
      historyEl.appendChild(b);
    }
    historyHint.hidden = hist.length > 0;
    btnClear.hidden = hist.length === 0;
  }

  async function refresh() {
    const got = await store.get({ [K_HISTORY]: [] });
    renderHistory(Array.isArray(got[K_HISTORY]) ? got[K_HISTORY] : []);
  }

  async function openPicker() {
    if (!(hasChrome && chrome.tabs?.create)) {
      location.href = APP_URL;        // dev-режим без chrome.*: открыть файлом
      return;
    }
    const url = chrome.runtime.getURL(`src/${APP_URL}`);
    try {
      // Уже открытый пикер переиспользуем: его storage.onChanged съедает
      // pp-incoming, и свежесозданная вкладка осталась бы пустой. Свои
      // страницы видны в tabs.query без permission "tabs".
      const [existing] = await chrome.tabs.query({ url });
      if (existing && typeof existing.id === 'number') {
        await chrome.tabs.update(existing.id, { active: true });
        if (typeof existing.windowId === 'number') {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
        window.close();
        return;
      }
    } catch { /* не разглядели — просто откроем новую */ }
    chrome.tabs.create({ url });
    window.close();
  }

  $('btn-open').addEventListener('click', openPicker);

  $('btn-grab').addEventListener('click', async () => {
    if (!hasChrome || !chrome.tabs?.captureVisibleTab) {
      setStatus('Needs the installed extension', true);
      return;
    }
    try {
      // не снимаем сам пикер: попап могли открыть из его вкладки
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.url && active.url.startsWith(chrome.runtime.getURL(''))) {
        setStatus('This is the picker itself — switch to the page you want, then click the icon.', true);
        return;
      }
    } catch { /* url не виден — обычная вкладка, продолжаем */ }
    try {
      // PNG без сжатия с потерями: пикер обязан читать истинные пиксели.
      // Снимаем ДО открытия новой вкладки — активной должна быть целевая.
      const dataUrl = await chrome.tabs.captureVisibleTab();
      let label = 'Page snapshot';
      try {
        // activeTab (жест клика по иконке) открывает title активной вкладки
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.title) label = tab.title;
      } catch { /* без title обойдёмся */ }
      try {
        await store.set({ [K_INCOMING]: { kind: 'dataurl', src: dataUrl, label } });
      } catch {
        // квота storage.local: retina-снимок не влез — ужимаем и пробуем ещё раз
        const scaled = await shrinkDataUrl(dataUrl, 3);
        if (!scaled) {
          setStatus('The snapshot is too large to hand over — try a smaller browser window', true);
          return;
        }
        await store.set({ [K_INCOMING]: { kind: 'dataurl', src: scaled, label } });
      }
      openPicker();
    } catch (e) {
      // chrome://, страницы CWS и другие защищённые вкладки снять нельзя —
      // говорим честно и НАЗЫВАЕМ причину (диагностика «не сработало»)
      setStatus(`This page can’t be captured — try a site whose address starts with http:// or https:// (${(e && e.message) || e})`, true);
    }
  });

  btnClear.addEventListener('click', async () => {
    await store.set({ [K_HISTORY]: [] });
    renderHistory([]);
    setStatus('History cleared');
  });

  if (RATE_URL) {
    const rate = $('link-rate');
    rate.href = RATE_URL;
    rate.hidden = false;
  }

  // пикер попросил подсветить Grab (кнопка в его шапке) — заберём сигнал
  (async () => {
    const got = await store.get({ [K_HIGHLIGHT]: false });
    if (!got[K_HIGHLIGHT]) return;
    await store.remove(K_HIGHLIGHT);
    const grab = $('btn-grab');
    grab.classList.add('attn');
    setStatus('“Grab this page” captures the tab under this popup — switch to the page you need first.');
    setTimeout(() => grab.classList.remove('attn'), 4000);
  })();

  // пик в открытой вкладке пикера сразу виден в попапе
  if (hasChrome) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[K_HISTORY]) {
        renderHistory(changes[K_HISTORY].newValue || []);
      }
    });
  }

  refresh();
})();
