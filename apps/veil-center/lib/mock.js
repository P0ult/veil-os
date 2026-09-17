'use strict';
const nodeFs = require('node:fs');
const nodePath = require('node:path');
const { GSettings } = require('./gsettings');
const { Appearance } = require('./appearance');
const { Store } = require('./store');

/**
 * Stand-ins for gsettings, flatpak, apt and the parts of the filesystem Veil
 * Appearance touches, so both windows can be run and looked at on a machine
 * that is not Veil OS. Flathub is still asked for real, because the Store is
 * mostly its pictures and words.
 *
 * Nothing here writes to the real disk.
 */

const HOME = '/home/veil';
const BRANDING = nodePath.join(__dirname, '..', '..', '..', 'branding', 'out');

const SCHEMAS = new Set([
  'org.gnome.desktop.interface',
  'org.gnome.desktop.wm.preferences',
  'org.gnome.desktop.background',
  'org.gnome.shell',
  'org.gnome.shell.extensions.user-theme',
  'org.gnome.shell.extensions.dash-to-panel',
  'org.gnome.shell.extensions.arcmenu',
  'org.gnome.shell.extensions.blur-my-shell',
  'org.gnome.shell.extensions.blur-my-shell.panel',
  'org.gnome.shell.extensions.blur-my-shell.overview',
  'org.gnome.shell.extensions.blur-my-shell.dash-to-panel'
]);

const DEFAULTS = {
  'org.gnome.desktop.interface gtk-theme': "'Colloid-Green-Dark'",
  'org.gnome.desktop.interface icon-theme': "'Papirus-Dark'",
  'org.gnome.desktop.interface color-scheme': "'prefer-dark'",
  'org.gnome.desktop.interface font-name': "'Inter 11'",
  'org.gnome.desktop.interface document-font-name': "'Inter 11'",
  'org.gnome.desktop.interface text-scaling-factor': '1.0',
  'org.gnome.desktop.interface cursor-theme': "'Bibata-Modern-Ice'",
  'org.gnome.desktop.interface cursor-size': '24',
  'org.gnome.desktop.interface enable-animations': 'true',
  'org.gnome.desktop.wm.preferences button-layout': "'appmenu:minimize,maximize,close'",
  'org.gnome.desktop.background picture-uri': "'file:///usr/share/backgrounds/veil/veil-night.png'",
  'org.gnome.desktop.background picture-uri-dark': "'file:///usr/share/backgrounds/veil/veil-night.png'",
  'org.gnome.shell enabled-extensions': "['dash-to-panel@jderose9.github.com', 'arcmenu@arcmenu.com', 'blur-my-shell@aunetx']",
  'org.gnome.shell disabled-extensions': '@as []',
  'org.gnome.shell.extensions.dash-to-panel panel-position': "'BOTTOM'",
  'org.gnome.shell.extensions.dash-to-panel panel-size': '48',
  'org.gnome.shell.extensions.dash-to-panel trans-panel-opacity': '0.72'
};

const WALLPAPERS = ['veil-aurora.png', 'veil-dawn.png', 'veil-mark-light.png', 'veil-mark.png', 'veil-night.png', 'veil-tide.png'];
const ICON_THEMES = ['Adwaita', 'Bibata-Modern-Amber', 'Bibata-Modern-Classic', 'Bibata-Modern-Ice', 'DMZ-White', 'Papirus', 'Papirus-Dark', 'hicolor'];
const CURSOR_THEMES = new Set(['Adwaita', 'Bibata-Modern-Amber', 'Bibata-Modern-Classic', 'Bibata-Modern-Ice', 'DMZ-White']);

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function create({ layouts, catalog }) {
  const values = new Map(Object.entries(DEFAULTS));
  const files = new Map();
  const flatpaks = new Set(['com.usebottles.bottles', 'com.discordapp.Discord']);
  const debs = new Set(['vlc', 'libreoffice', 'veil-browser', 'steam-installer', 'lutris', 'timeshift', 'gparted']);

  /* ------------------------------------------------------------ programs */

  async function run(cmd, args = []) {
    await wait(15);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const fail = (stderr) => ({ code: 1, stdout: '', stderr });

    if (cmd === 'gsettings') {
      const [verb, schema, key, value] = args;
      if (!SCHEMAS.has(schema)) return fail(`No such schema "${schema}"`);
      const k = `${schema} ${key}`;
      if (verb === 'list-keys') return ok('');
      if (verb === 'get') return values.has(k) ? ok(values.get(k) + '\n') : fail(`No such key "${key}"`);
      if (verb === 'set') { values.set(k, value); return ok(); }
      if (verb === 'reset') { values.delete(k); if (DEFAULTS[k]) values.set(k, DEFAULTS[k]); return ok(); }
      return fail('unknown gsettings verb');
    }
    if (cmd === 'gnome-extensions') return ok();
    if (cmd === 'fc-list') return ok('Inter\nCantarell\nNoto Sans,Noto Sans Regular\nDejaVu Sans\nUbuntu\n');
    if (cmd === 'flatpak' && args[0] === 'list') {
      return ok(['Application ID', ...flatpaks].join('\n') + '\n');
    }
    if (cmd === 'flatpak' && args[0] === 'remote-ls') {
      return ok([...flatpaks].slice(0, 1).join('\n') + '\n');
    }
    if (cmd === 'dpkg-query') {
      const names = args.filter(a => !a.startsWith('-'));
      return ok(names.map(n => `${n} ${debs.has(n) ? 'ii ' : 'un '}`).join('\n') + '\n');
    }
    if (cmd === 'apt') return ok('Listing...\nfirefox/noble-updates 1.0 amd64 [upgradable from: 0.9]\nmesa/noble 2.0 amd64 [upgradable from: 1.9]\n');
    if (cmd === 'gtk-launch' || (cmd === 'flatpak' && args[0] === 'run')) return ok();
    return fail(`${cmd}: not available in the mock`);
  }

  // Installs take a few seconds and report progress the way the real
  // programs do, so the page's progress handling is exercised as written.
  async function stream(cmd, args, onLine) {
    const apt = cmd === 'pkexec';
    const [action, name] = apt ? [args[1], args[2]] : [args[0], args[args.length - 1]];
    if (apt && action === 'upgrade') {
      for (let p = 0; p <= 100; p += 20) { await wait(150); onLine(`pmstatus:dpkg-exec:${p}:Running dpkg`); }
      return { code: 0, tail: '' };
    }
    if (!apt && action === 'update') {
      for (let p = 0; p <= 100; p += 25) { await wait(150); onLine(`Updating... ${p}%`); }
      return { code: 0, tail: '' };
    }
    if (name === 'org.example.Fails') return { code: 1, tail: 'error: Unable to find org.example.Fails' };
    for (let p = 0; p <= 100; p += 10) {
      await wait(220);
      onLine(apt ? `pmstatus:${name}:${p}:Installing ${name}` : `Installing ${name}... ${p}%`);
    }
    const set = apt ? debs : flatpaks;
    if (action === 'install') set.add(name); else set.delete(name);
    return { code: 0, tail: '' };
  }

  /* ---------------------------------------------------------- filesystem */

  const norm = (p) => String(p).replace(/\\/g, '/');
  const fsys = {
    readFileSync(p) {
      const k = norm(p);
      if (!files.has(k)) { const e = new Error('ENOENT ' + k); e.code = 'ENOENT'; throw e; }
      return files.get(k);
    },
    writeFileSync(p, data) { files.set(norm(p), String(data)); },
    mkdirSync() {},
    renameSync() {},
    rmSync() {},
    cpSync() {},
    symlinkSync() {},
    existsSync(p) {
      const k = norm(p);
      if (files.has(k)) return true;
      if (/^\/usr\/share\/themes\/Colloid[\w-]*$/.test(k)) return true;
      if (k.startsWith('/usr/share/backgrounds/veil/')) return WALLPAPERS.includes(k.split('/').pop());
      const m = /^\/usr\/share\/icons\/([^/]+)\/cursors$/.exec(k);
      if (m) return CURSOR_THEMES.has(m[1]);
      return false;
    },
    readdirSync(p) {
      const k = norm(p);
      if (k === '/usr/share/backgrounds/veil') return [...WALLPAPERS, 'thumbs'];
      if (k === '/usr/share/icons') return [...ICON_THEMES];
      return [];
    }
  };

  // The generated wallpapers, when the branding has been built, so the
  // page shows the real pictures rather than placeholders.
  function localFile(p) {
    const k = norm(p);
    const m = /^\/usr\/share\/backgrounds\/veil\/(thumbs\/)?([\w.-]+\.png)$/.exec(k);
    if (!m) return null;
    const real = nodePath.join(BRANDING, 'wallpapers', m[1] ? 'thumbs' : '', m[2]);
    return nodeFs.existsSync(real) ? real : null;
  }

  const gs = new GSettings(run);
  return {
    appearance: new Appearance({ gs, run, layouts, home: HOME, fsys }),
    store: new Store({ catalog, run, stream, fetch: (u, i) => fetch(u, i), browserDesktop: 'veil-browser.desktop' }),
    fsys,
    localFile
  };
}

module.exports = { create };
