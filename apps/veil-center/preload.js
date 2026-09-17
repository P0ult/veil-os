'use strict';
/**
 * The only way the pages reach the system: a fixed list of calls, each of
 * which the main process checks again. Every call resolves to its value or
 * rejects with a sentence that can be shown as it is.
 */
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong');
  return r.value;
}

function listen(channel, fn) {
  const wrapped = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('veil', {
  info: () => call('app:info'),
  open: (url) => call('app:open', String(url)),
  onTheme: (fn) => listen('app:theme', fn),

  store: {
    categories: () => call('store:categories'),
    home: () => call('store:home'),
    search: (q) => call('store:search', String(q)),
    app: (id) => call('store:app', String(id)),
    installed: () => call('store:installed'),
    updates: () => call('store:updates'),
    install: (id) => call('store:install', String(id)),
    remove: (id) => call('store:remove', String(id)),
    updateAll: () => call('store:update-all'),
    launch: (id) => call('store:launch', String(id)),
    onProgress: (fn) => listen('store:progress', fn)
  },

  look: {
    state: () => call('look:state'),
    layout: (id) => call('look:layout', String(id)),
    accent: (id) => call('look:accent', String(id)),
    scheme: (s) => call('look:scheme', String(s)),
    wallpaper: (p) => call('look:wallpaper', String(p)),
    pickWallpaper: () => call('look:pick-wallpaper'),
    blur: (n) => call('look:blur', Number(n)),
    panel: (opts) => call('look:panel', {
      position: opts && opts.position != null ? String(opts.position) : undefined,
      size: opts && opts.size != null ? Number(opts.size) : undefined,
      opacity: opts && opts.opacity != null ? Number(opts.opacity) : undefined
    }),
    font: (family, size) => call('look:font', String(family), Number(size)),
    textScale: (s) => call('look:text-scale', Number(s)),
    cursor: (theme, size) => call('look:cursor', theme == null ? null : String(theme), size == null ? null : Number(size)),
    buttons: (side) => call('look:buttons', String(side)),
    animations: (on) => call('look:animations', !!on),
    reset: () => call('look:reset')
  }
});
