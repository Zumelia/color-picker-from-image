/**
 * PixelPeek background — минимальный сервис-воркер MV3 (SPEC §2): пункт
 * контекстного меню на картинках с лестницей тиров и welcome/uninstall-URL.
 * Контент-скриптов и резидентной логики нет — код просыпается по событиям.
 *
 * Лестница тиров «ПКМ по картинке» (никогда не падает молча):
 *   1. в страницу инжектится probeImage: CORS-перезагрузка картинки с
 *      crossOrigin='anonymous' → CDN отдал ACAO → toDataURL с истинными
 *      пикселями натурального разрешения;
 *   2. иначе captureVisibleTab (activeTab уже дан кликом по меню; снимать
 *      надо ДО открытия пикера — потом вкладка не активна) + кроп по
 *      видимой части картинки — отрендеренные пиксели, но всегда;
 *   3. иначе пикер открывается с подсказкой «Copy image → Ctrl+V» (kind:'hint').
 * Съезд по лестнице случается и на квоте storage.local (10 МБ): PNG-гигант
 * тира 1 не влез — снимок вкладки тира 2 влезет почти наверняка.
 */

const MENU_ID = 'pp-pick-image';
const APP_PATH = 'src/app.html';
const K_INCOMING = 'pp-incoming';
const PROBE_TIMEOUT_MS = 4000;

// Домен продукта: colorpickfromimage.com (куплен 2026-08-01). Слэш в конце
// обязателен — без него nginx добавляет лишний 301. Welcome открывается только
// на install; uninstall-URL ставится на install И update (после апдейта слетает).
const WELCOME_URL = 'https://colorpickfromimage.com/welcome/';
const UNINSTALL_URL = 'https://colorpickfromimage.com/uninstall/';

/**
 * Выполняется В СТРАНИЦЕ (chrome.scripting сериализует функцию: никаких
 * замыканий и chrome.* внутри). Делает сразу два дела:
 *  — тир 1: заново грузит картинку с crossOrigin='anonymous' (ДО src, иначе
 *    обычная загрузка запятнает канвас); ACAO есть → канвас чистый и
 *    toDataURL('image/png') отдаёт истинные пиксели без потерь;
 *  — данные для тира 2: видимая часть картинки в CSS-пикселях вьюпорта.
 *    Масштаб снимка по этим данным пикер меряет сам по фактическому размеру
 *    (devicePixelRatio бывает дробным — 2.28 замерено, доверять ему нельзя).
 */
async function probeImage(srcUrl, timeoutMs) {
  const el = [...document.images].find((i) => i.currentSrc === srcUrl || i.src === srcUrl);
  let visible = null;
  if (el) {
    const r = el.getBoundingClientRect();
    const x = Math.max(r.left, 0);
    const y = Math.max(r.top, 0);
    const x2 = Math.min(r.right, window.innerWidth);
    const y2 = Math.min(r.bottom, window.innerHeight);
    if (x2 - x >= 3 && y2 - y >= 3) {
      visible = {
        x, y, w: x2 - x, h: y2 - y,
        viewportW: window.innerWidth, viewportH: window.innerHeight,
      };
    }
  }

  let name = 'Image';
  try {
    // data:-URL парсится как URL, но pathname у него — мусор вида "png;base64,…"
    if (!srcUrl.startsWith('data:')) {
      name = decodeURIComponent(new URL(srcUrl, location.href).pathname.split('/').pop()) || 'Image';
    }
  } catch { /* экзотика — обойдёмся дефолтом */ }

  const dataUrl = await new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve(null);                    // память на гигантах и пр. → тир 2
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.crossOrigin = 'anonymous';
    img.src = srcUrl;
  });

  return { dataUrl, name, visible };
}

/** Пишет pp-incoming; false — не влезло в квоту, пусть пробует следующий тир. */
async function deliver(incoming) {
  try {
    await chrome.storage.local.set({ [K_INCOMING]: incoming });
  } catch {
    return false;
  }
  await openPicker();
  return true;
}

/**
 * Открывает пикер, переиспользуя уже открытую вкладку: её storage.onChanged
 * съест pp-incoming, и свежесозданная копия осталась бы пустой. Свои страницы
 * видны в tabs.query без permission "tabs".
 */
async function openPicker() {
  const url = chrome.runtime.getURL(APP_PATH);
  try {
    const [existing] = await chrome.tabs.query({ url });
    if (existing && typeof existing.id === 'number') {
      await chrome.tabs.update(existing.id, { active: true });
      if (typeof existing.windowId === 'number') {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
  } catch { /* не разглядели своих вкладок — просто откроем новую */ }
  try {
    await chrome.tabs.create({ url });
  } catch { /* дальше падать некуда */ }
}

async function pickFromImage(srcUrl, tab) {
  let probe = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: probeImage,
      args: [srcUrl, PROBE_TIMEOUT_MS],
    });
    probe = res?.result || null;
  } catch { /* chrome://, PDF, CWS: инъекция запрещена → сразу тиры 2–3 */ }

  const label = probe?.name || 'Image';

  if (probe?.dataUrl && await deliver({ kind: 'dataurl', src: probe.dataUrl, label })) return;

  if (probe?.visible) {
    try {
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      if (shot && await deliver({ kind: 'capture', src: shot, crop: probe.visible, label })) return;
    } catch { /* защищённая вкладка — остаётся подсказка */ }
  }

  await deliver({ kind: 'hint', label });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  if (!tab || typeof tab.id !== 'number') return;
  pickFromImage(info.srcUrl, tab);
});

chrome.runtime.onInstalled.addListener((details) => {
  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create(
        { id: MENU_ID, title: 'Pick color from this image', contexts: ['image'] },
        () => void chrome.runtime.lastError,
      );
    });
  } catch { /* меню — не повод ронять install */ }

  if (details && details.reason === 'install' && WELCOME_URL) {
    try {
      chrome.tabs.create({ url: WELCOME_URL });
    } catch { /* ignore */ }
  }
  if (UNINSTALL_URL) {
    try {
      // ?v= попадает в поле «Extension version» опроса на странице uninstall
      const v = chrome.runtime.getManifest().version;
      chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?v=${v}`,
        () => void chrome.runtime.lastError);
    } catch { /* ignore */ }
  }
});
