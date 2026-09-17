'use strict';
/**
 * Veil Center: the Veil Store and Veil Appearance, as one program.
 *
 *     veil-center --store
 *     veil-center --appearance
 *
 * Two launchers, one binary: they share a runtime, a design and most of their
 * plumbing, and shipping Electron twice for two small windows would double
 * the size for nothing. Each mode is its own single instance, so opening the
 * Store while Appearance is open opens the Store.
 *
 * --mock runs both against stand-ins for gsettings, flatpak and apt, which is
 * how the interface is worked on away from a Veil OS machine.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme, protocol, dialog, shell, net } = require('electron');

const MODE = process.argv.includes('--appearance') ? 'appearance' : 'store';
const MOCK = process.argv.includes('--mock') || process.env.VEIL_CENTER_MOCK === '1';

// Separate profiles, so each mode holds its own single-instance lock.
app.setName(MODE === 'store' ? 'Veil Store' : 'Veil Appearance');

// One program, two apps: each window carries its own launcher's name, so the
// taskbar shows the right icon and keeps the two apart.
const DESKTOP_ID = MODE === 'store' ? 'veil-store' : 'veil-appearance';
app.commandLine.appendSwitch('class', DESKTOP_ID);
if (process.platform === 'linux') app.setDesktopName(`${DESKTOP_ID}.desktop`);
app.setPath('userData', path.join(app.getPath('appData'), `veil-${MODE}`));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'veil-local', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'veil-icon', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

/* -------------------------------------------------------------- backends */

const layouts = require('./data/layouts.json');
const catalog = require('./data/catalog.json');
const { GSettings } = require('./lib/gsettings');
const { Appearance } = require('./lib/appearance');
const { Store } = require('./lib/store');

let backend;
if (MOCK) {
  backend = require('./lib/mock').create({ layouts, catalog });
} else {
  const { run, stream } = require('./lib/run');
  const gs = new GSettings(run);
  let browserDesktop = '';
  try { browserDesktop = fs.readFileSync('/usr/lib/veil/browser-desktop-id', 'utf8').trim(); } catch {}
  backend = {
    appearance: new Appearance({ gs, run, layouts }),
    store: new Store({ catalog, run, stream, fetch: (u, i) => net.fetch(u, i), browserDesktop }),
    fsys: fs
  };
}

/* --------------------------------------------------------- local files */

// Only these directories can be read by the pages - wallpapers, icons and
// the logo - so a page that asked for anything else gets nothing.
const LOCAL_ROOTS = [
  '/usr/share/backgrounds',
  '/usr/share/icons',
  '/usr/share/pixmaps',
  path.join(os.homedir(), '.local', 'share', 'icons'),
  path.join(os.homedir(), 'Pictures'),
  path.join(os.homedir(), 'Downloads')
];

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function inside(file, roots) {
  const real = path.resolve(file);
  return roots.some(r => real === r || real.startsWith(r + path.sep));
}

// Where an icon named in the catalog lives, in the order GNOME would look.
const ICON_SEARCH = [
  '/usr/share/icons/Papirus/64x64/apps',
  '/usr/share/icons/Papirus/48x48/apps',
  '/usr/share/icons/hicolor/scalable/apps',
  '/usr/share/icons/hicolor/256x256/apps',
  '/usr/share/icons/hicolor/128x128/apps',
  '/usr/share/icons/hicolor/64x64/apps',
  '/usr/share/icons/hicolor/48x48/apps',
  '/usr/share/pixmaps'
];

function findIcon(name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  for (const dir of ICON_SEARCH) {
    for (const ext of ['.svg', '.png']) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function serveFile(file) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return new Response(fs.readFileSync(file), { headers: { 'content-type': type, 'cache-control': 'max-age=3600' } });
}

function placeholderIcon(label) {
  const letter = String(label || '?').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="#232b36"/>
    <text x="32" y="42" font-family="Inter, sans-serif" font-size="28" font-weight="600"
      text-anchor="middle" fill="#9aa6b4">${letter}</text></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
}

function registerProtocols() {
  // veil-local://f/usr/share/... - a fixed host, because a standard scheme
  // with an empty one would read the first directory as the host name.
  protocol.handle('veil-local', (req) => {
    const u = new URL(req.url);
    const file = decodeURIComponent(u.pathname);
    if (MOCK) {
      const real = backend.localFile(file);
      return real ? serveFile(real) : placeholderIcon(path.basename(file));
    }
    // Pictures only, whatever else those folders hold.
    if (!MIME[path.extname(file).toLowerCase()] || !inside(file, LOCAL_ROOTS) || !fs.existsSync(file)) {
      return new Response('', { status: 404 });
    }
    return serveFile(file);
  });

  // veil-icon://i/NAME - the name in the path, because hosts are lowercased.
  protocol.handle('veil-icon', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
    if (MOCK) return placeholderIcon(name);
    const file = findIcon(name);
    return file ? serveFile(file) : placeholderIcon(name);
  });
}

/* ---------------------------------------------------------------- window */

let win = null;

function palette() {
  return nativeTheme.shouldUseDarkColors ? '#14181f' : '#f6f7f9';
}

function createWindow() {
  win = new BrowserWindow({
    width: MODE === 'store' ? 1120 : 920,
    height: MODE === 'store' ? 760 : 820,
    minWidth: 720,
    minHeight: 540,
    show: false,
    title: MODE === 'store' ? 'Veil Store' : 'Veil Appearance',
    icon: MODE === 'store' ? '/usr/share/icons/hicolor/256x256/apps/veil-store.png'
                           : '/usr/share/icons/hicolor/256x256/apps/veil-appearance.png',
    backgroundColor: palette(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.removeMenu();

  // Links out of the app open in the browser, never inside it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'ui', MODE === 'store' ? 'store.html' : 'appearance.html'));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

nativeTheme.on('updated', () => {
  if (win) win.webContents.send('app:theme', { dark: nativeTheme.shouldUseDarkColors });
});

/* ------------------------------------------------------------------- IPC */

// Every handler returns { ok, value } or { ok: false, error }, so a failure in
// the backend arrives in the page as a sentence rather than as a rejected
// promise with Electron's wrapping around it.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) return { ok: false, error: 'Not allowed' };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
}

const progress = (p) => { if (win) win.webContents.send('store:progress', p); };

handle('app:info', async () => {
  let accent = '#7dd3a0';
  try {
    const st = await backend.appearance.state();
    const a = layouts.accents[st.accent];
    if (a) accent = a.colour;
  } catch {}
  return { mode: MODE, mock: MOCK, dark: nativeTheme.shouldUseDarkColors, accent };
});

handle('app:open', (url) => {
  if (/^https:\/\//.test(String(url))) return shell.openExternal(String(url));
  throw new Error('Only web addresses can be opened');
});

if (MODE === 'store') {
  const store = backend.store;
  handle('store:categories', () => catalog.categories.map(c => ({ id: c.id, name: c.name })));
  handle('store:home', () => store.home());
  handle('store:search', (q) => store.search(q));
  handle('store:app', (id) => store.app(id));
  handle('store:installed', async () => [...await store.installed()]);
  handle('store:updates', () => store.updates());
  handle('store:install', (id) => store.install(id, progress));
  handle('store:remove', (id) => store.remove(id, progress));
  handle('store:update-all', () => store.updateAll(progress));
  handle('store:launch', (id) => store.launch(id));
}

if (MODE === 'appearance') {
  const look = backend.appearance;
  const after = async (p) => { await p; return look.state(); };
  handle('look:state', () => look.state());
  handle('look:layout', (id) => after(look.applyLayout(id)));
  handle('look:accent', (id) => after(look.setAccent(id)));
  handle('look:scheme', (s) => after(look.setScheme(s)));
  handle('look:wallpaper', (p) => after(look.setWallpaper(p)));
  handle('look:pick-wallpaper', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a picture',
      defaultPath: path.join(os.homedir(), 'Pictures'),
      properties: ['openFile'],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (r.canceled || !r.filePaths[0]) return look.state();
    return after(look.setWallpaper(r.filePaths[0]));
  });
  handle('look:blur', (n) => after(look.setBlur(n)));
  handle('look:panel', (opts) => after(look.setPanel(opts || {})));
  handle('look:font', (f, s) => after(look.setFont(f, s)));
  handle('look:text-scale', (s) => after(look.setTextScale(s)));
  handle('look:cursor', (t, s) => after(look.setCursor(t, s)));
  handle('look:buttons', (side) => after(look.setButtons(side)));
  handle('look:animations', (on) => after(look.setAnimations(on)));
  handle('look:reset', () => look.reset());
}

/* ------------------------------------------------------------------ start */

app.whenReady().then(() => {
  registerProtocols();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
