'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path').posix;
const { gv } = require('./gsettings');

/**
 * Everything Veil Appearance changes, and how.
 *
 * All of it is per-user and none of it needs a password: settings go through
 * gsettings, the libadwaita theme is copied into ~/.config/gtk-4.0, and folder
 * colours are an icon theme of the user's own that inherits Papirus and
 * repoints its folder icons - rather than papirus-folders, which rewrites the
 * system theme for everyone and needs root to do it.
 */

const DTP = 'org.gnome.shell.extensions.dash-to-panel';
const ARC = 'org.gnome.shell.extensions.arcmenu';
const BLUR = 'org.gnome.shell.extensions.blur-my-shell';
const IFACE = 'org.gnome.desktop.interface';
const WM = 'org.gnome.desktop.wm.preferences';
const BG = 'org.gnome.desktop.background';
const SHELL = 'org.gnome.shell';
const USER_THEME = 'org.gnome.shell.extensions.user-theme';

const MONITORS = [0, 1, 2, 3, 4, 5];

const THEMES_DIR = '/usr/share/themes';
const ICONS_DIR = '/usr/share/icons';
const WALLPAPERS_DIR = '/usr/share/backgrounds/veil';
const MARK_LIGHT = '/usr/share/pixmaps/veil/veil-mark-light.png';
const MARK_DARK = '/usr/share/pixmaps/veil/veil-mark-dark.png';

class Appearance {
  /**
   * @param {object} deps
   * @param {GSettings} deps.gs
   * @param {Function} deps.run      run(cmd, args)
   * @param {object}  deps.layouts   desktop/layouts.json
   * @param {string}  [deps.home]    for tests
   * @param {object}  [deps.fsys]    node:fs, or a stand-in for tests
   */
  constructor({ gs, run, layouts, home, fsys }) {
    this.gs = gs;
    this.run = run;
    this.data = layouts;
    this.home = home || os.homedir();
    this.fs = fsys || fs;
    this.configFile = path.join(this.home, '.config', 'veil', 'appearance.json');
  }

  /* ----------------------------------------------------------- memory */

  remembered() {
    try { return JSON.parse(this.fs.readFileSync(this.configFile, 'utf8')); } catch { return {}; }
  }

  remember(patch) {
    const next = { ...this.remembered(), ...patch };
    this.fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    this.fs.writeFileSync(this.configFile, JSON.stringify(next, null, 2));
    return next;
  }

  /* -------------------------------------------------------- the picture */

  /** What the page needs to draw itself as things currently are. */
  async state() {
    const mem = this.remembered();
    const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

    const gtkTheme = await safe(() => this.gs.read(IFACE, 'gtk-theme'), '');
    const scheme = await safe(() => this.gs.read(IFACE, 'color-scheme'), 'prefer-dark');
    const wallpaperUri = await safe(() => this.gs.read(BG,
      scheme === 'prefer-light' || scheme === 'default' ? 'picture-uri' : 'picture-uri-dark'), '');

    return {
      layout: mem.layout || this.data.default,
      accent: mem.accent || this.accentFromTheme(gtkTheme) || 'green',
      scheme: scheme === 'prefer-light' || scheme === 'default' ? 'light' : 'dark',
      wallpaper: uriToPath(wallpaperUri),
      blur: mem.blur != null ? mem.blur : 50,
      panel: {
        position: await safe(() => this.gs.read(DTP, 'panel-position'), 'BOTTOM'),
        size: await safe(() => this.gs.read(DTP, 'panel-size'), 48),
        opacity: Math.round(100 * await safe(() => this.gs.read(DTP, 'trans-panel-opacity'), 0.72))
      },
      font: splitFont(await safe(() => this.gs.read(IFACE, 'font-name'), 'Inter 11')),
      textScale: await safe(() => this.gs.read(IFACE, 'text-scaling-factor'), 1),
      cursor: {
        theme: await safe(() => this.gs.read(IFACE, 'cursor-theme'), 'Bibata-Modern-Ice'),
        size: await safe(() => this.gs.read(IFACE, 'cursor-size'), 24)
      },
      buttons: String(await safe(() => this.gs.read(WM, 'button-layout'), ':close')).startsWith('close')
        ? 'left' : 'right',
      animations: await safe(() => this.gs.read(IFACE, 'enable-animations'), true),
      options: {
        layouts: Object.entries(this.data.layouts).map(([id, l]) => ({
          id, name: l.name, description: l.description, preview: l.preview
        })),
        accents: Object.entries(this.data.accents).map(([id, a]) => ({
          id, name: a.name, colour: a.colour
        })),
        wallpapers: this.wallpapers(),
        cursors: this.cursors(),
        fonts: await this.fonts()
      }
    };
  }

  accentFromTheme(themeName) {
    const base = String(themeName || '').replace(/-(Dark|Light)$/, '');
    for (const [id, a] of Object.entries(this.data.accents)) {
      if (a.theme === base) return id;
    }
    return null;
  }

  wallpapers() {
    try {
      return this.fs.readdirSync(WALLPAPERS_DIR)
        .filter(f => f.endsWith('.png'))
        .sort()
        .map(f => ({
          path: path.join(WALLPAPERS_DIR, f),
          thumb: path.join(WALLPAPERS_DIR, 'thumbs', f),
          name: f.replace(/^veil-/, '').replace(/\.png$/, '').replace(/-/g, ' ')
        }));
    } catch { return []; }
  }

  cursors() {
    try {
      return this.fs.readdirSync(ICONS_DIR)
        .filter(d => this.fs.existsSync(path.join(ICONS_DIR, d, 'cursors')))
        .sort();
    } catch { return []; }
  }

  /** A short list of good interface faces, of those that are installed. */
  async fonts() {
    const wanted = ['Inter', 'Cantarell', 'Noto Sans', 'DejaVu Sans', 'Liberation Sans', 'Ubuntu', 'Carlito'];
    const r = await this.run('fc-list', [':', 'family']);
    if (r.code !== 0) return wanted.slice(0, 1);
    const have = new Set(r.stdout.split('\n').flatMap(l => l.split(',')).map(s => s.trim()));
    return wanted.filter(f => have.has(f));
  }

  /* ------------------------------------------------------------ layouts */

  async applyLayout(id) {
    const layout = this.data.layouts[id];
    if (!layout) throw new Error('No such layout: ' + id);

    for (const uuid of layout.disable) await this.extension(uuid, false);

    // Settings before enabling, so an extension comes up already arranged
    // rather than flashing its own defaults first.
    for (const [schema, key, value] of layout.settings) {
      if (await this.gs.has(schema)) await this.gs.set(schema, key, value);
    }

    if (await this.gs.has(DTP)) {
      for (const [key, value] of Object.entries(layout.perMonitor || {})) {
        await this.gs.set(DTP, key, gv.str(this.perMonitor(value)));
      }
      // Serial-keyed entries would outrank the single values just set.
      await this.gs.set(DTP, 'panel-sizes', gv.str('{}'));
      await this.gs.set(DTP, 'panel-positions', gv.str('{}'));
    }

    for (const uuid of layout.enable) await this.extension(uuid, true);

    // The start button's mark has to stand out against the panel.
    const st = await this.state();
    await this.applyMenuIcon(st.scheme);

    this.remember({ layout: id });
    return id;
  }

  perMonitor(value) {
    const resolved = typeof value === 'string' && value.startsWith('@')
      ? this.data.elements[value.slice(1)]
      : value;
    const out = {};
    for (const i of MONITORS) out[String(i)] = resolved;
    return JSON.stringify(out);
  }

  /**
   * Turn an extension on or off. `gnome-extensions` does it through the
   * running shell and keeps both of GNOME's lists straight; when there is no
   * shell to ask, the lists are edited directly.
   */
  async extension(uuid, on) {
    const r = await this.run('gnome-extensions', [on ? 'enable' : 'disable', uuid]);
    if (r.code === 0) return;

    const enabled = await this.gs.read(SHELL, 'enabled-extensions').catch(() => []);
    const disabled = await this.gs.read(SHELL, 'disabled-extensions').catch(() => []);
    const without = (list) => list.filter(x => x !== uuid);
    if (on) {
      await this.gs.set(SHELL, 'enabled-extensions', gv.strv([...without(enabled), uuid]));
      await this.gs.set(SHELL, 'disabled-extensions', gv.strv(without(disabled)));
    } else {
      await this.gs.set(SHELL, 'enabled-extensions', gv.strv(without(enabled)));
      await this.gs.set(SHELL, 'disabled-extensions', gv.strv([...without(disabled), uuid]));
    }
  }

  /* ------------------------------------------------------ colour and mode */

  themeName(accentId, scheme) {
    const accent = this.data.accents[accentId];
    if (!accent) throw new Error('No such colour: ' + accentId);
    return `${accent.theme}-${scheme === 'light' ? 'Light' : 'Dark'}`;
  }

  async setAccent(accentId) {
    const st = await this.state();
    await this.applyTheme(accentId, st.scheme);
    this.remember({ accent: accentId });
    return accentId;
  }

  async setScheme(scheme) {
    if (scheme !== 'dark' && scheme !== 'light') throw new Error('No such mode: ' + scheme);
    const st = await this.state();
    await this.gs.set(IFACE, 'color-scheme', gv.str(scheme === 'dark' ? 'prefer-dark' : 'prefer-light'));
    await this.applyTheme(st.accent, scheme);
    await this.applyMenuIcon(scheme);
    return scheme;
  }

  async applyTheme(accentId, scheme) {
    const theme = this.themeName(accentId, scheme);
    if (!this.fs.existsSync(path.join(THEMES_DIR, theme))) {
      throw new Error(`The ${theme} theme is not installed`);
    }
    const accent = this.data.accents[accentId];

    await this.gs.set(IFACE, 'gtk-theme', gv.str(theme));
    if (await this.gs.has(USER_THEME)) await this.gs.set(USER_THEME, 'name', gv.str(theme));

    this.copyGtk4(theme);

    const icons = this.folderTheme(accent.folders, scheme);
    await this.gs.set(IFACE, 'icon-theme', gv.str(icons));

    if (await this.gs.has(DTP)) {
      for (const n of [1, 2, 3, 4]) await this.gs.set(DTP, `dot-color-${n}`, gv.str(accent.colour));
      await this.gs.set(DTP, 'dot-color-override', 'true');
      await this.gs.set(DTP, 'focus-highlight-color', gv.str(accent.colour));
    }
  }

  async applyMenuIcon(scheme) {
    if (!(await this.gs.has(ARC))) return;
    await this.gs.set(ARC, 'menu-button-icon', gv.str(scheme === 'light' ? MARK_DARK : MARK_LIGHT));
  }

  /**
   * libadwaita ignores the GTK theme setting and reads ~/.config/gtk-4.0
   * instead, so GNOME's own apps only follow the colour if the theme's files
   * are there. A file the user put there by hand is moved aside, not lost.
   */
  copyGtk4(theme) {
    const src = path.join(THEMES_DIR, theme, 'gtk-4.0');
    const dest = path.join(this.home, '.config', 'gtk-4.0');
    if (!this.fs.existsSync(src)) return;
    this.fs.mkdirSync(dest, { recursive: true });

    const marker = path.join(dest, '.veil-theme');
    const ours = this.fs.existsSync(marker);
    for (const name of ['gtk.css', 'gtk-dark.css', 'assets']) {
      const target = path.join(dest, name);
      if (this.fs.existsSync(target) && !ours) {
        this.fs.renameSync(target, target + '.before-veil');
      } else if (this.fs.existsSync(target)) {
        this.fs.rmSync(target, { recursive: true, force: true });
      }
      const from = path.join(src, name);
      if (this.fs.existsSync(from)) this.fs.cpSync(from, target, { recursive: true, dereference: true });
    }
    this.fs.writeFileSync(marker, theme + '\n');
  }

  /**
   * An icon theme of the user's own: Papirus, with its folders in one colour.
   *
   * Papirus ships every folder icon in every colour, as folder-<colour>-*.svg.
   * papirus-folders repoints the plain names at one colour inside the system
   * theme; this makes the same links inside a theme under ~/.local/share/icons
   * that inherits Papirus, so nothing system-wide changes and no password is
   * asked for.
   */
  folderTheme(colour, scheme) {
    const base = scheme === 'light' ? 'Papirus-Light' : 'Papirus-Dark';
    const name = `Papirus-Veil-${scheme === 'light' ? 'Light' : 'Dark'}`;
    const dest = path.join(this.home, '.local', 'share', 'icons', name);
    const source = path.join(ICONS_DIR, 'Papirus');

    if (!this.fs.existsSync(source)) return base;

    this.fs.rmSync(dest, { recursive: true, force: true });
    this.fs.mkdirSync(dest, { recursive: true });

    const dirs = [];
    for (const size of this.fs.readdirSync(source)) {
      const places = path.join(source, size, 'places');
      if (!this.fs.existsSync(places)) continue;
      const out = path.join(dest, size, 'places');
      this.fs.mkdirSync(out, { recursive: true });
      dirs.push(`${size}/places`);

      const prefix = `folder-${colour}`;
      const userPrefix = `user-${colour}`;
      for (const file of this.fs.readdirSync(places)) {
        let plain = null;
        if (file === `${prefix}.svg`) plain = 'folder.svg';
        else if (file.startsWith(prefix + '-')) plain = 'folder-' + file.slice(prefix.length + 1);
        else if (file.startsWith(userPrefix + '-')) plain = 'user-' + file.slice(userPrefix.length + 1);
        if (!plain) continue;
        try {
          this.fs.symlinkSync(path.join(places, file), path.join(out, plain));
        } catch {}
      }
    }

    const sections = dirs.map(d => {
      const size = d.split('/')[0];
      const px = parseInt(size, 10);
      const scalable = size === 'symbolic' || Number.isNaN(px);
      return `[${d}]\nContext=Places\nSize=${scalable ? 16 : px}\nType=${scalable ? 'Scalable' : 'Fixed'}\n`;
    });

    this.fs.writeFileSync(path.join(dest, 'index.theme'), [
      '[Icon Theme]',
      `Name=${name}`,
      `Comment=Papirus with ${colour} folders, made by Veil Appearance`,
      `Inherits=${base},Papirus,hicolor`,
      `Directories=${dirs.join(',')}`,
      '',
      ...sections
    ].join('\n'));

    return name;
  }

  /* ----------------------------------------------------------- the rest */

  async setWallpaper(file) {
    const p = String(file || '');
    if (!p || !this.fs.existsSync(p)) throw new Error('That picture could not be found');
    const uri = pathToUri(p);
    await this.gs.set(BG, 'picture-uri', gv.str(uri));
    await this.gs.set(BG, 'picture-uri-dark', gv.str(uri));
    await this.gs.set(BG, 'picture-options', gv.str('zoom'));
    return p;
  }

  /**
   * One slider for how glassy the panel and overview look. 0 turns blur off;
   * higher is softer and slightly darker, which keeps text readable over it.
   */
  async setBlur(level) {
    const n = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
    if (await this.gs.has(BLUR)) {
      const on = n > 0;
      const sigma = Math.round(n * 0.6);
      const brightness = Math.max(0.4, 0.9 - n * 0.004);
      await this.gs.set(BLUR, 'sigma', gv.num(Math.max(sigma, 1)));
      await this.gs.set(BLUR, 'brightness', gv.dbl(brightness));
      await this.gs.set(`${BLUR}.panel`, 'blur', gv.bool(on));
      await this.gs.set(`${BLUR}.panel`, 'customize', 'true');
      await this.gs.set(`${BLUR}.panel`, 'sigma', gv.num(Math.max(sigma, 1)));
      await this.gs.set(`${BLUR}.panel`, 'brightness', gv.dbl(brightness));
      await this.gs.set(`${BLUR}.overview`, 'blur', gv.bool(on));
      await this.gs.set(`${BLUR}.dash-to-panel`, 'blur-original-panel', gv.bool(on));
    }
    this.remember({ blur: n });
    return n;
  }

  async setPanel({ position, size, opacity } = {}) {
    if (!(await this.gs.has(DTP))) throw new Error('The taskbar is not installed');
    if (position != null) {
      const pos = String(position).toUpperCase();
      if (!['TOP', 'BOTTOM', 'LEFT', 'RIGHT'].includes(pos)) throw new Error('No such position: ' + position);
      await this.gs.set(DTP, 'panel-positions', gv.str('{}'));
      await this.gs.set(DTP, 'panel-position', gv.str(pos));
    }
    if (size != null) {
      const s = Math.max(24, Math.min(96, Math.round(Number(size))));
      await this.gs.set(DTP, 'panel-sizes', gv.str('{}'));
      await this.gs.set(DTP, 'panel-size', gv.num(s));
    }
    if (opacity != null) {
      const o = Math.max(0, Math.min(100, Math.round(Number(opacity)))) / 100;
      await this.gs.set(DTP, 'trans-use-custom-opacity', 'true');
      await this.gs.set(DTP, 'trans-panel-opacity', gv.dbl(o));
    }
    return true;
  }

  async setFont(family, size) {
    const f = String(family || '').trim();
    const s = Math.max(8, Math.min(20, Math.round(Number(size) || 11)));
    if (!f || /[^\w .-]/.test(f)) throw new Error('No such font: ' + family);
    await this.gs.set(IFACE, 'font-name', gv.str(`${f} ${s}`));
    await this.gs.set(IFACE, 'document-font-name', gv.str(`${f} ${s}`));
    await this.gs.set(WM, 'titlebar-font', gv.str(`${f} Bold ${s}`));
    return { family: f, size: s };
  }

  async setTextScale(scale) {
    const s = Math.max(0.8, Math.min(2, Number(scale) || 1));
    await this.gs.set(IFACE, 'text-scaling-factor', gv.dbl(Math.round(s * 100) / 100));
    return s;
  }

  async setCursor(theme, size) {
    if (theme != null) {
      if (!this.cursors().includes(theme)) throw new Error('No such pointer: ' + theme);
      await this.gs.set(IFACE, 'cursor-theme', gv.str(theme));
    }
    if (size != null) {
      const s = [24, 32, 48, 64].includes(Number(size)) ? Number(size) : 24;
      await this.gs.set(IFACE, 'cursor-size', gv.num(s));
    }
    return true;
  }

  async setButtons(side) {
    const layout = side === 'left'
      ? 'close,minimize,maximize:appmenu'
      : 'appmenu:minimize,maximize,close';
    await this.gs.set(WM, 'button-layout', gv.str(layout));
    return side === 'left' ? 'left' : 'right';
  }

  async setAnimations(on) {
    await this.gs.set(IFACE, 'enable-animations', gv.bool(!!on));
    return !!on;
  }

  /** Back to how Veil OS looked when it was installed. */
  async reset() {
    for (const [schema, keys] of [
      [IFACE, ['gtk-theme', 'icon-theme', 'cursor-theme', 'cursor-size', 'color-scheme',
               'font-name', 'document-font-name', 'text-scaling-factor', 'enable-animations']],
      [WM, ['button-layout', 'titlebar-font']],
      [BG, ['picture-uri', 'picture-uri-dark', 'picture-options']]
    ]) {
      for (const key of keys) await this.gs.reset(schema, key);
    }
    this.remember({ layout: this.data.default, accent: 'green', blur: 50 });
    await this.applyLayout(this.data.default);
    await this.applyTheme('green', 'dark');
    await this.setBlur(50);
    await this.setPanel({ opacity: 72 });
    return this.state();
  }
}

/* ----------------------------------------------------------------- paths */

function pathToUri(p) {
  return 'file://' + p.split('/').map(encodeURIComponent).join('/');
}

function uriToPath(uri) {
  const u = String(uri || '');
  if (!u.startsWith('file://')) return '';
  try { return decodeURIComponent(u.slice(7)); } catch { return u.slice(7); }
}

function splitFont(name) {
  const m = /^(.*?)\s+(\d+(?:\.\d+)?)$/.exec(String(name || ''));
  return m ? { family: m[1].replace(/\s+(Regular|Bold|Semi-Bold|Medium)$/i, ''), size: Number(m[2]) }
           : { family: String(name || 'Inter'), size: 11 };
}

module.exports = { Appearance, pathToUri, uriToPath, splitFont };
