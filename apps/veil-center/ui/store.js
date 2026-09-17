'use strict';
/* The Veil Store page. */

const api = window.veil.store;
const main = document.getElementById('main');
const sheet = document.getElementById('sheet');
const scrim = document.getElementById('scrim');
const searchBox = document.getElementById('search');

const state = {
  home: null,              // what store:home returned
  installed: new Set(),
  busy: new Map(),         // id -> { action, percent, text }
  names: new Map(),        // id -> name, for messages
  view: 'discover',
  pick: 0,                 // which Windows program the translator shows
  detail: null             // id in the sheet
};

const WINDOWS_NOTE = 'Most Windows programs install with a double-click on their .exe file: '
  + 'Veil runs them with Wine. For games, Steam and Heroic handle it for you.';

/* ------------------------------------------------------------------ icons */

function appIcon(app, size) {
  const img = el('img', {
    class: 'icon', alt: '', width: size, height: size,
    src: app.icon || iconUrl(app.name)
  });
  img.addEventListener('error', () => {
    const fallback = iconUrl(app.name);
    if (img.src !== fallback) img.src = fallback;
  });
  return img;
}

/* ---------------------------------------------------------------- actions */

// Every place an app appears has an action area tagged with its id, so
// progress for that app can be redrawn wherever it is on screen.
function actionArea(app, { detail = false } = {}) {
  const box = el('div', { class: 'act', 'data-act': app.id });
  box.dataset.detail = detail ? '1' : '0';
  fillAction(box, app.id);
  return box;
}

function fillAction(box, id) {
  const detail = box.dataset.detail === '1';
  box.replaceChildren();
  const busy = state.busy.get(id);

  if (busy) {
    const known = typeof busy.percent === 'number';
    const bar = el('div', { class: 'progress' + (known ? '' : ' unknown'), role: 'progressbar',
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': known ? busy.percent : null,
      'aria-label': busy.action === 'remove' ? 'Removing' : 'Installing' },
      el('div', { class: 'bar' }, el('span', { style: { '--p': (busy.percent || 0) + '%' } })),
      el('div', { class: 'text', text: busy.text || (busy.action === 'remove' ? 'Removing' : 'Installing') }));
    box.append(bar);
    return;
  }

  if (state.installed.has(id)) {
    box.append(el('button', { class: 'btn', text: 'Open', onclick: (e) => { e.stopPropagation(); launch(id); } }));
    if (detail) {
      box.append(el('button', { class: 'btn quiet danger', text: 'Remove', onclick: () => confirmRemove(box, id) }));
    }
  } else {
    box.append(el('button', { class: 'btn primary', text: 'Install', onclick: (e) => { e.stopPropagation(); install(id); } }));
  }
}

function confirmRemove(box, id) {
  const name = state.names.get(id) || 'this app';
  box.replaceChildren(
    el('span', { class: 'muted', text: `Remove ${name}?` }),
    el('button', { class: 'btn danger', text: 'Remove', onclick: () => remove(id) }),
    el('button', { class: 'btn quiet', text: 'Keep', onclick: () => fillAction(box, id) })
  );
}

function redraw(id) {
  for (const box of document.querySelectorAll(`[data-act="${CSS.escape(id)}"]`)) fillAction(box, id);
}

async function install(id) {
  const name = state.names.get(id) || id;
  state.busy.set(id, { action: 'install', percent: null, text: 'Starting' });
  redraw(id);
  try {
    await api.install(id);
    state.installed.add(id);
    toast(`Installed ${name}`);
  } catch (e) {
    toast(`${name} wasn't installed: ${e.message}`, { error: true });
  } finally {
    state.busy.delete(id);
    redraw(id);
  }
}

async function remove(id) {
  const name = state.names.get(id) || id;
  state.busy.set(id, { action: 'remove', percent: null, text: 'Removing' });
  redraw(id);
  try {
    await api.remove(id);
    state.installed.delete(id);
    toast(`Removed ${name}`);
    if (state.view === 'installed') show('installed');
  } catch (e) {
    toast(`${name} wasn't removed: ${e.message}`, { error: true });
  } finally {
    state.busy.delete(id);
    redraw(id);
  }
}

async function launch(id) {
  try {
    await api.launch(id);
  } catch (e) {
    toast(`Couldn't open ${state.names.get(id) || id}: ${e.message}`, { error: true });
  }
}

api.onProgress((p) => {
  if (!p || !p.id) return;
  if (p.id === 'updates') return updateProgress(p);
  const busy = state.busy.get(p.id);
  if (!busy) return;
  if (typeof p.percent === 'number') busy.percent = p.percent;
  if (p.text) busy.text = p.text;
  redraw(p.id);
});

/* ------------------------------------------------------------------ pieces */

function remember(apps) {
  for (const a of apps) state.names.set(a.id, a.name);
  return apps;
}

function sourceLabel(app) {
  return app.source === 'ubuntu' ? 'From Ubuntu' : (app.verified ? 'Flathub, verified' : 'Flathub');
}

function row(app) {
  return el('div', { class: 'row' },
    appIcon(app, 48),
    el('div', { class: 'body' },
      el('button', { class: 'hit name', text: app.name, onclick: () => openDetail(app.id) }),
      el('div', { class: 'summary', text: app.summary || '' }),
      el('div', { class: 'source', text: sourceLabel(app) })),
    actionArea(app));
}

function feature(app) {
  return el('div', { class: 'feature' },
    appIcon(app, 64),
    el('button', { class: 'hit name', text: app.name, onclick: () => openDetail(app.id) }),
    el('div', { class: 'summary', text: app.summary || '' }),
    actionArea(app));
}

function ghosts(n) {
  return el('div', { class: 'grid' }, Array.from({ length: n }, () => el('div', { class: 'ghost' })));
}

function page(...children) {
  const p = el('div', { class: 'page' }, ...children);
  main.replaceChildren(p);
  main.scrollTop = 0;
  return p;
}

/* ------------------------------------------------------------------- views */

async function loadHome() {
  if (state.home) return state.home;
  const home = await api.home();
  state.home = home;
  state.installed = new Set(home.installed);
  remember(home.featured);
  for (const c of home.categories) remember(c.apps);
  for (const w of home.windows) remember(w.apps);
  return home;
}

function translator(home) {
  const choices = home.windows.filter(w => w.apps.length);
  if (!choices.length) return null;
  if (state.pick >= choices.length) state.pick = 0;

  const answer = el('div', { class: 'answer', 'aria-live': 'polite' });
  const list = el('div', { class: 'from-list', role: 'group', 'aria-label': 'Windows programs' });

  const choose = (i) => {
    state.pick = i;
    for (const [j, b] of [...list.children].entries()) b.setAttribute('aria-pressed', String(j === i));
    const w = choices[i];
    fillWith(answer,
      el('p', { class: 'lead' }, 'Instead of ', el('b', { text: w.from }), ', use'),
      el('div', { class: 'rows' }, w.apps.map(row)),
      w.from.includes('.exe') ? el('p', { class: 'muted', text: WINDOWS_NOTE }) : null
    );
  };

  choices.forEach((w, i) => {
    list.append(el('button', { 'aria-pressed': 'false', text: w.from, onclick: () => choose(i) }));
  });
  choose(state.pick);

  return el('section', { class: 'translator', 'aria-labelledby': 'tr-title' },
    el('div', {},
      el('h1', { id: 'tr-title', text: 'What did you use on Windows?' }),
      list),
    answer);
}

async function showDiscover() {
  const p = page(el('div', { class: 'ghost', style: { height: '260px' } }), ghosts(6));
  let home;
  try {
    home = await loadHome();
  } catch (e) {
    return showError(e);
  }
  if (state.view !== 'discover') return;

  const offline = home.featured.length === 0;
  const parts = [];
  if (offline) {
    parts.push(el('div', { class: 'notice' },
      el('strong', { text: 'Flathub can\'t be reached. ' }),
      'Apps from Ubuntu are still listed below. Connect to the internet to see the rest.'));
  }
  parts.push(translator(home));

  if (home.featured.length) {
    parts.push(el('section', {},
      el('div', { class: 'section-head' }, el('h2', { text: 'Worth a look' })),
      el('div', { class: 'featured' }, home.featured.map(feature))));
  }

  for (const c of home.categories) {
    if (!c.apps.length) continue;
    parts.push(el('section', {},
      el('div', { class: 'section-head' },
        el('h2', { text: c.name }),
        c.apps.length > 4 ? el('button', { class: 'link', text: `All ${c.apps.length}`, onclick: () => show('cat:' + c.id) }) : null),
      el('div', { class: 'grid' }, c.apps.slice(0, 4).map(row))));
  }

  fillWith(p, parts);
}

async function showCategory(id) {
  const p = page(ghosts(8));
  let home;
  try { home = await loadHome(); } catch (e) { return showError(e); }
  if (state.view !== 'cat:' + id) return;
  const c = home.categories.find(x => x.id === id);
  if (!c) return show('discover');

  p.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', { text: c.name }),
        id === 'windows' ? el('p', { text: WINDOWS_NOTE }) : null)),
    c.apps.length
      ? el('div', { class: 'grid' }, c.apps.map(row))
      : el('div', { class: 'empty' }, el('h2', { text: 'Nothing to show yet' }),
          'These apps come from Flathub, which can\'t be reached right now.'));
}

let searchSerial = 0;
async function showSearch(query) {
  const q = query.trim();
  const serial = ++searchSerial;
  const p = page(el('div', { class: 'page-head' }, el('h1', { text: `Results for “${q}”` })), ghosts(8));
  let results;
  try {
    results = remember(await api.search(q));
    const have = await api.installed();
    for (const id of have) state.installed.add(id);
  } catch (e) {
    return showError(e);
  }
  if (serial !== searchSerial || state.view !== 'search') return;

  p.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', { text: `Results for “${q}”` })),
    results.length
      ? el('div', { class: 'grid' }, results.map(row))
      : el('div', { class: 'empty' },
          el('h2', { text: 'No apps match' }),
          'Try a shorter name, or describe what you want to do, like “photo editor” or “music”.'));
}

async function showInstalled() {
  const p = page(el('div', { class: 'page-head' }, el('h1', { text: 'Installed' })), ghosts(6));
  let apps;
  try {
    const ids = await api.installed();
    state.installed = new Set(ids);
    // Only apps the Store can describe: the base system's own packages
    // are not listed here.
    apps = remember((await Promise.all(ids.map(id => api.app(id).catch(() => null)))).filter(Boolean));
  } catch (e) {
    return showError(e);
  }
  if (state.view !== 'installed') return;
  apps.sort((a, b) => a.name.localeCompare(b.name));

  p.replaceChildren(
    el('div', { class: 'page-head' },
      el('div', {},
        el('h1', { text: 'Installed' }),
        el('p', { text: `${apps.length} ${apps.length === 1 ? 'app' : 'apps'} from the Store` }))),
    apps.length
      ? el('div', { class: 'list' }, apps.map(row))
      : el('div', { class: 'empty' }, el('h2', { text: 'Nothing installed from the Store yet' }),
          'Apps you install from Discover or search show up here.'));
}

let updateBox = null;
async function showUpdates() {
  const p = page(el('div', { class: 'page-head' }, el('h1', { text: 'Updates' })), ghosts(3));
  let list;
  try { list = await api.updates(); } catch (e) { return showError(e); }
  if (state.view !== 'updates') return;
  setUpdateCount(list);

  const system = list.find(x => x.id === 'system');
  const appIds = list.filter(x => x.id !== 'system').map(x => x.id);
  const apps = remember((await Promise.all(appIds.map(id => api.app(id).catch(() => null)))).filter(Boolean));
  if (state.view !== 'updates') return;

  if (!list.length) {
    p.replaceChildren(
      el('div', { class: 'page-head' }, el('h1', { text: 'Updates' })),
      el('div', { class: 'empty' }, el('h2', { text: 'Everything is up to date' }),
        'Veil checks for updates in the background and will list them here.'));
    return;
  }

  const summary = [
    apps.length ? `${apps.length} ${apps.length === 1 ? 'app' : 'apps'}` : null,
    system ? `${system.count} system ${system.count === 1 ? 'package' : 'packages'}` : null
  ].filter(Boolean).join(' and ');

  updateBox = el('div', { class: 'act' },
    el('button', { class: 'btn primary', text: 'Update all', onclick: updateAll }));

  fillWith(p,
    el('div', { class: 'page-head' }, el('h1', { text: 'Updates' })),
    el('div', { class: 'update-bar' },
      el('div', {}, el('h3', { text: `${summary} can be updated` }),
        el('p', { class: 'muted', text: 'Updating the system asks for your password.' })),
      updateBox),
    apps.length ? el('div', { class: 'list' }, apps.map(row)) : null);
}

async function updateAll() {
  if (!updateBox) return;
  updateProgress({ percent: 0, text: 'Starting' });
  try {
    const r = await api.updateAll();
    if (r.apps && r.system) toast('Everything is up to date');
    else toast(r.apps ? 'Apps updated. The system update did not finish.' : 'Some updates did not finish. Try again.', { error: true });
  } catch (e) {
    toast(`Updating stopped: ${e.message}`, { error: true });
  }
  if (state.view === 'updates') showUpdates();
}

function updateProgress(p) {
  if (!updateBox || !updateBox.isConnected) return;
  const known = typeof p.percent === 'number';
  updateBox.replaceChildren(el('div', { class: 'progress' + (known ? '' : ' unknown') },
    el('div', { class: 'bar' }, el('span', { style: { '--p': (p.percent || 0) + '%' } })),
    el('div', { class: 'text', text: p.text || 'Updating' })));
}

function setUpdateCount(list) {
  const n = list.length;
  const badge = document.getElementById('update-count');
  badge.hidden = n === 0;
  badge.textContent = String(n);
}

function showError(e) {
  page(el('div', { class: 'empty' },
    el('h2', { text: 'The Store couldn\'t load this page' }),
    el('p', { text: e.message }),
    el('p', { style: { marginTop: '16px' } },
      el('button', { class: 'btn', text: 'Try again', onclick: () => { state.home = null; show(state.view); } }))));
}

/* ------------------------------------------------------------------ routing */

function show(view) {
  state.view = view;
  for (const b of document.querySelectorAll('.side [data-view]')) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (view !== 'search') searchBox.value = '';
  if (view === 'discover') return showDiscover();
  if (view === 'installed') return showInstalled();
  if (view === 'updates') return showUpdates();
  if (view.startsWith('cat:')) return showCategory(view.slice(4));
}

document.querySelector('.side').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) show(b.dataset.view);
});

const runSearch = () => {
  const q = searchBox.value.trim();
  if (!q) { if (state.view === 'search') show('discover'); return; }
  state.view = 'search';
  for (const b of document.querySelectorAll('.side [data-view]')) b.removeAttribute('aria-current');
  showSearch(q);
};
searchBox.addEventListener('input', debounce(runSearch, 350));
searchBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

/* ------------------------------------------------------------------- sheet */

async function openDetail(id) {
  state.detail = id;
  sheet.replaceChildren(
    el('button', { class: 'close', 'aria-label': 'Close', text: '×', onclick: closeDetail }),
    el('div', { class: 'ghost', style: { height: '96px', marginTop: '12px' } }),
    el('div', { class: 'ghost', style: { height: '260px', marginTop: '28px' } }));
  scrim.hidden = false;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');

  let app;
  try {
    app = await api.app(id);
  } catch (e) {
    if (state.detail !== id) return;
    sheet.replaceChildren(
      el('button', { class: 'close', 'aria-label': 'Close', text: '×', onclick: closeDetail }),
      el('div', { class: 'empty' }, el('h2', { text: 'This app couldn\'t be loaded' }), e.message));
    return;
  }
  if (state.detail !== id) return;
  state.names.set(app.id, app.name);

  const facts = [];
  const fact = (k, v) => { if (v) facts.push(el('dt', { text: k }), el('dd', {}, v)); };
  fact('Comes from', app.source === 'ubuntu' ? `Ubuntu, as the ${app.package} package` : 'Flathub');
  fact('Licence', app.license ? (app.free ? app.license : `${app.license} (not open source)`) : '');
  fact('Website', app.homepage && /^https:\/\//.test(app.homepage)
    ? el('button', { class: 'link', text: app.homepage.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, ''),
        onclick: () => window.veil.open(app.homepage).catch(() => {}) })
    : '');
  fact('App ID', app.source === 'flathub' ? app.id : '');

  fillWith(sheet,
    el('button', { class: 'close', 'aria-label': 'Close', text: '×', onclick: closeDetail }),
    el('div', { class: 'detail-head' },
      appIcon(app, 96),
      el('div', {},
        el('h1', { id: 'sheet-title', text: app.name }),
        el('p', { class: 'by' },
          app.developer || (app.source === 'ubuntu' ? 'Part of Ubuntu' : ''),
          app.verified ? el('span', { class: 'verified', text: app.developer ? ', verified by Flathub' : 'Verified by Flathub' }) : null))),
    el('p', { class: 'muted', style: { marginTop: '14px', fontSize: 'var(--t-15)' }, text: app.summary || '' }),
    el('div', { class: 'detail-actions' }, actionArea(app, { detail: true })),
    app.screenshots && app.screenshots.length
      ? el('div', { class: 'shots' }, app.screenshots.map(src => el('img', { src, alt: '', loading: 'lazy' })))
      : null,
    app.description ? el('div', { class: 'description', text: app.description }) : null,
    facts.length ? el('dl', { class: 'facts' }, facts) : null
  );
  sheet.querySelector('.detail-actions .btn')?.focus();
}

function closeDetail() {
  state.detail = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  scrim.hidden = true;
}

scrim.addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.detail) closeDetail();
  if ((e.ctrlKey && e.key === 'f') || (e.key === '/' && document.activeElement !== searchBox)) {
    e.preventDefault();
    searchBox.focus();
    searchBox.select();
  }
});

/* -------------------------------------------------------------------- start */

(async () => {
  await boot();
  const nav = document.getElementById('nav-categories');
  try {
    for (const c of await api.categories()) {
      nav.append(el('button', { 'data-view': 'cat:' + c.id, text: c.name }));
    }
  } catch {}
  show('discover');
  api.updates().then(setUpdateCount).catch(() => {});
})();
