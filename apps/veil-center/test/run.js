'use strict';
/**
 * Tests for the parts of Veil Center that do not need a desktop: GVariant
 * text, layouts, the Store's parsing and the root helper's refusals. Run with
 * `npm test`; no network is used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { gv } = require('../lib/gsettings');
const { splitFont, pathToUri, uriToPath } = require('../lib/appearance');
const { Store, aptPercent, flatpakPercent, stripHtml, APP_ID, APT_NAME } = require('../lib/store');
const mock = require('../lib/mock');

const ROOT = path.join(__dirname, '..');
const layouts = require('../data/layouts.json');
const catalog = require('../data/catalog.json');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* --------------------------------------------------------------- GVariant */

test('strings are quoted and escaped the way gsettings reads them', () => {
  assert.equal(gv.str('Inter 11'), "'Inter 11'");
  assert.equal(gv.str("it's"), "'it\\'s'");
  assert.equal(gv.str('a\\b'), "'a\\\\b'");
  assert.equal(gv.strv(['a', 'b']), "['a', 'b']");
  assert.equal(gv.dbl(1), '1.0');
  assert.equal(gv.dbl(0.72), '0.72');
  assert.throws(() => gv.num('x'));
});

test('gsettings output is read back as plain values', () => {
  assert.equal(gv.parse("'Colloid-Green-Dark'"), 'Colloid-Green-Dark');
  assert.equal(gv.parse('true'), true);
  assert.equal(gv.parse('48'), 48);
  assert.equal(gv.parse('uint32 24'), 24);
  assert.equal(gv.parse('0.72'), 0.72);
  assert.deepEqual(gv.parse("['a@b', 'c']"), ['a@b', 'c']);
  assert.deepEqual(gv.parse('@as []'), []);
  assert.equal(gv.parse(gv.str("it's")), "it's");
});

test('font names and file URIs round-trip', () => {
  assert.deepEqual(splitFont('Noto Sans 10.5'), { family: 'Noto Sans', size: 10.5 });
  assert.deepEqual(splitFont('Inter Bold 11'), { family: 'Inter', size: 11 });
  const p = '/home/veil/Pictures/my wallpaper #1.png';
  assert.equal(pathToUri(p), 'file:///home/veil/Pictures/my%20wallpaper%20%231.png');
  assert.equal(uriToPath(pathToUri(p)), p);
  assert.equal(uriToPath('https://example.com/x.png'), '');
});

/* ---------------------------------------------------------------- layouts */

test('the app ships the same layouts as the desktop build', () => {
  const desktop = fs.readFileSync(path.join(ROOT, '..', '..', 'desktop', 'layouts.json'), 'utf8');
  const bundled = fs.readFileSync(path.join(ROOT, 'data', 'layouts.json'), 'utf8');
  assert.equal(bundled, desktop, 'run build-deb.sh, or copy desktop/layouts.json to data/');
});

test('every layout is complete and refers to real element lists', () => {
  assert.ok(layouts.layouts[layouts.default], 'default layout exists');
  for (const [id, l] of Object.entries(layouts.layouts)) {
    for (const k of ['name', 'description', 'preview', 'enable', 'disable', 'settings', 'perMonitor']) {
      assert.ok(k in l, `${id} has ${k}`);
    }
    for (const s of l.settings) {
      assert.equal(s.length, 3, `${id}: ${s.join(' ')}`);
      assert.match(s[0], /^org\.gnome\./);
    }
    for (const v of Object.values(l.perMonitor)) {
      if (typeof v === 'string' && v.startsWith('@')) assert.ok(layouts.elements[v.slice(1)], `${id}: ${v}`);
    }
  }
  for (const [id, a] of Object.entries(layouts.accents)) {
    assert.match(a.colour, /^#[0-9a-f]{6}$/, id);
    assert.match(a.theme, /^Colloid/, id);
  }
});

test('a layout is applied: extensions, settings, then every monitor', async () => {
  const b = mock.create({ layouts, catalog });
  await b.appearance.applyLayout('modern');
  const gs = b.appearance.gs;
  assert.equal(await gs.read('org.gnome.shell.extensions.arcmenu', 'menu-layout'), '11');
  const positions = JSON.parse(await gs.read('org.gnome.shell.extensions.dash-to-panel', 'panel-element-positions'));
  assert.deepEqual(Object.keys(positions), ['0', '1', '2', '3', '4', '5']);
  assert.equal(positions['0'].find(e => e.element === 'taskbar').position, 'centerMonitor');
  assert.equal(await gs.read('org.gnome.shell.extensions.dash-to-panel', 'panel-sizes'), '{}');
  assert.equal((await b.appearance.state()).layout, 'modern');
  await assert.rejects(b.appearance.applyLayout('nope'), /No such layout/);
});

test('colour, mode, blur and taskbar reach the right keys', async () => {
  const b = mock.create({ layouts, catalog });
  const a = b.appearance;
  const gs = a.gs;
  await a.setAccent('purple');
  assert.equal(await gs.read('org.gnome.desktop.interface', 'gtk-theme'), 'Colloid-Purple-Dark');
  assert.equal(await gs.read('org.gnome.shell.extensions.user-theme', 'name'), 'Colloid-Purple-Dark');
  assert.equal(await gs.read('org.gnome.shell.extensions.dash-to-panel', 'dot-color-1'), '#ab47bc');
  await a.setScheme('light');
  assert.equal(await gs.read('org.gnome.desktop.interface', 'gtk-theme'), 'Colloid-Purple-Light');
  assert.equal(await gs.read('org.gnome.desktop.interface', 'color-scheme'), 'prefer-light');
  assert.equal((await a.state()).accent, 'purple');
  await assert.rejects(a.setScheme('sepia'));

  await a.setBlur(0);
  assert.equal(await gs.read('org.gnome.shell.extensions.blur-my-shell.panel', 'blur'), false);
  await a.setBlur(100);
  assert.equal(await gs.read('org.gnome.shell.extensions.blur-my-shell.panel', 'blur'), true);
  assert.equal(await gs.read('org.gnome.shell.extensions.blur-my-shell', 'sigma'), 60);

  await a.setPanel({ position: 'left', size: 500, opacity: 40 });
  assert.equal(await gs.read('org.gnome.shell.extensions.dash-to-panel', 'panel-position'), 'LEFT');
  assert.equal(await gs.read('org.gnome.shell.extensions.dash-to-panel', 'panel-size'), 96);
  assert.equal(await gs.read('org.gnome.shell.extensions.dash-to-panel', 'trans-panel-opacity'), 0.4);
  await assert.rejects(a.setPanel({ position: 'middle' }), /No such position/);

  await assert.rejects(a.setFont("Inter'; rm", 11), /No such font/);
  await a.setFont('Noto Sans', 30);
  assert.equal(await gs.read('org.gnome.desktop.interface', 'font-name'), 'Noto Sans 20');
  await assert.rejects(a.setCursor('Nonexistent', null), /No such pointer/);
  await assert.rejects(a.setWallpaper('/nowhere.png'), /could not be found/);
  await a.setWallpaper('/usr/share/backgrounds/veil/veil-dawn.png');
  assert.equal((await a.state()).wallpaper, '/usr/share/backgrounds/veil/veil-dawn.png');
});

test('reset goes back to the defaults', async () => {
  const b = mock.create({ layouts, catalog });
  await b.appearance.setAccent('red');
  await b.appearance.applyLayout('dock');
  const st = await b.appearance.reset();
  assert.equal(st.layout, layouts.default);
  assert.equal(st.accent, 'green');
  assert.equal(st.scheme, 'dark');
});

/* ------------------------------------------------------------------ store */

test('install progress is read from apt and flatpak output', () => {
  assert.equal(aptPercent('pmstatus:vlc:42.8571:Installing vlc'), 43);
  assert.equal(aptPercent('dlstatus:1:12.5:Downloading'), 13);
  assert.equal(aptPercent('Reading package lists...'), null);
  assert.equal(flatpakPercent('Installing 2/3… ████▌ 57%  2.1 MB/s'), 57);
  assert.equal(flatpakPercent('Looking for matches…'), null);
});

test('descriptions lose their markup but keep paragraphs and lists', () => {
  const text = stripHtml('<p>One\n two.</p><ul><li>A &amp; B</li><li>C</li></ul>');
  assert.equal(text, 'One two.\n\n• A & B\n• C');
});

test('ids and package names are checked before anything runs', async () => {
  assert.ok(APP_ID.test('org.gimp.GIMP'));
  assert.ok(!APP_ID.test('--help'));
  assert.ok(!APP_ID.test('org.gimp'));
  assert.ok(APT_NAME.test('steam-installer'));
  assert.ok(!APT_NAME.test('-oDebug=1'));

  const ran = [];
  const store = new Store({
    catalog,
    run: async (c, a) => { ran.push([c, ...a]); return { code: 0, stdout: '', stderr: '' }; },
    stream: async (c, a) => { ran.push([c, ...a]); return { code: 0, tail: '' }; },
    fetch: async () => { throw new Error('no network in tests'); }
  });
  await assert.rejects(store.install('--system'), /Not an app id/);
  await assert.rejects(store.launch('../../bin/sh'), /Not an app id/);
  assert.equal(ran.length, 0);
});

test('the catalog only names apps the Store can install', () => {
  const all = [
    ...catalog.featured,
    ...catalog.categories.flatMap(c => c.apps),
    ...catalog.windows.flatMap(w => w.use)
  ];
  for (const id of all) {
    assert.ok(id in catalog.local || APP_ID.test(id), id);
  }
  for (const [id, e] of Object.entries(catalog.local)) {
    assert.ok(APT_NAME.test(e.apt), `${id}: ${e.apt}`);
    assert.ok(e.icon && e.name && e.summary, id);
  }
});

test('installing and removing changes what is installed', async () => {
  const b = mock.create({ layouts, catalog });
  const seen = [];
  assert.ok(!(await b.store.installed()).has('org.gimp.GIMP'));
  await b.store.install('org.gimp.GIMP', p => seen.push(p.percent));
  assert.ok((await b.store.installed()).has('org.gimp.GIMP'));
  assert.equal(seen.at(-1), 100);
  assert.ok(seen.some(p => p > 0 && p < 100));

  assert.ok((await b.store.installed()).has('vlc'));
  await b.store.remove('vlc');
  assert.ok(!(await b.store.installed()).has('vlc'));

  await assert.rejects(b.store.install('org.example.Fails'), /Unable to find/);
});

test('two changes to one app at once are refused', async () => {
  const b = mock.create({ layouts, catalog });
  const first = b.store.install('org.kde.krita');
  await assert.rejects(b.store.install('org.kde.krita'), /Already working/);
  await first;
});

/* ----------------------------------------------------------------- helper */

test('the root helper refuses anything that is not a package name', () => {
  const bash = spawnSync('bash', ['--version']);
  if (bash.error) return 'skipped: no bash';
  const helper = path.join(ROOT, 'helper', 'veil-store-helper');
  for (const args of [
    ['install', '--allow-unauthenticated'],
    ['install', 'Upper'],
    ['install', 'vlc', '-o'],
    ['remove'],
    ['upgrade', 'extra'],
    ['purge', 'vlc'],
    []
  ]) {
    const r = spawnSync('bash', [helper, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 64, `${args.join(' ')}: ${r.stderr}`);
  }
});

/* ------------------------------------------------------------------- run */

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      const note = await t.fn();
      console.log(`ok    ${t.name}${typeof note === 'string' ? ` (${note})` : ''}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${t.name}\n      ${String(e.stack || e).split('\n').slice(0, 4).join('\n      ')}`);
    }
  }
  console.log(`\n${tests.length - failed} of ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
