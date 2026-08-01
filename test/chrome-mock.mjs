/**
 * Фейковый chrome.* для jsdom-тестов попапа и сервис-воркера — скелет харнеса
 * пилота, промисифицированный (наш код живёт на await, а не на колбэках).
 * calls.order пишет последовательность side-effect'ов — для проверок вида
 * «снимок вкладки ДО открытия пикера».
 */
export function makeChrome({
  store = {},
  tabs = [],
  activeTab = null,
  shot = 'data:image/png;base64,SHOT',
  failSetTimes = 0,
  execResult = null,
  execError = false,
  captureError = false,
} = {}) {
  const calls = {
    order: [],
    menus: [],
    removeAll: 0,
    created: [],
    updated: [],
    winUpdated: [],
    execOpts: [],
    captures: 0,
    uninstallUrl: null,
    changedListeners: [],
  };
  const state = { store, failSetTimes };
  const handlers = {};

  const chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => `chrome-extension://test/${p}`,
      getManifest: () => ({ version: '0.1.1' }),
      onInstalled: { addListener: (fn) => { handlers.installed = fn; } },
      setUninstallURL: (url, cb) => { calls.uninstallUrl = url; cb && cb(); },
    },
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...state.store }),
        set: async (items) => {
          if (state.failSetTimes > 0) {
            state.failSetTimes--;
            throw new Error('QUOTA_BYTES quota exceeded');
          }
          Object.assign(state.store, items);
          calls.order.push('set');
        },
        remove: async (key) => { delete state.store[key]; },
      },
      onChanged: { addListener: (fn) => calls.changedListeners.push(fn) },
    },
    contextMenus: {
      removeAll: (cb) => { calls.removeAll++; cb && cb(); },
      create: (props, cb) => { calls.menus.push(props); cb && cb(); },
      onClicked: { addListener: (fn) => { handlers.menuClick = fn; } },
    },
    tabs: {
      create: async (o) => {
        calls.created.push(o);
        calls.order.push('create');
        return { id: 1000 + calls.created.length };
      },
      update: async (id, o) => {
        calls.updated.push([id, o]);
        calls.order.push('update');
        return { id };
      },
      query: async (q) => {
        if (q && q.active) return activeTab ? [activeTab] : [];
        if (q && q.url) return tabs.filter((t) => t.url === q.url);
        return tabs;
      },
      captureVisibleTab: async () => {
        calls.captures++;
        calls.order.push('capture');
        if (captureError) throw new Error('Cannot capture contents of this page');
        return shot;
      },
    },
    windows: {
      update: async (id, o) => { calls.winUpdated.push([id, o]); return { id }; },
    },
    scripting: {
      executeScript: async (opts) => {
        calls.execOpts.push(opts);
        if (execError) throw new Error('Cannot access contents of the page');
        return [{ result: execResult }];
      },
    },
  };

  return { chrome, calls, handlers, state };
}
