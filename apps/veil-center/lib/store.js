'use strict';
const path = require('node:path').posix;

/**
 * The Veil Store's engine.
 *
 * Two sources, one list. Most apps come from Flathub, installed system-wide
 * with flatpak, which asks for a password through the desktop's own prompt
 * when policy wants one. The few that belong in the base system - Steam,
 * LibreOffice, disk tools - come from Ubuntu's archive, installed by a small
 * root helper through pkexec.
 *
 * Nothing about what a person installs is sent anywhere except the request to
 * Flathub for the app itself.
 */

const FLATHUB = 'https://flathub.org/api/v2';
const HELPER = '/usr/lib/veil/veil-store-helper';
const APP_ID = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){2,}$/;
const APT_NAME = /^[a-z0-9][a-z0-9+.-]+$/;

class Store {
  /**
   * @param {object} deps
   * @param {object} deps.catalog     data/catalog.json
   * @param {Function} deps.run       run(cmd, args)
   * @param {Function} deps.stream    stream(cmd, args, onLine)
   * @param {Function} deps.fetch     fetch(url, init)
   * @param {string}  [deps.browserDesktop]  the browser's desktop id
   */
  constructor({ catalog, run, stream, fetch, browserDesktop }) {
    this.catalog = catalog;
    this.run = run;
    this.stream = stream;
    this.fetch = fetch;
    this.browserDesktop = browserDesktop || '';
    this.details = new Map();       // id -> app, from Flathub, for this session
    this.busy = new Map();          // id -> what is happening to it
  }

  /* ------------------------------------------------------------ describing */

  isLocal(id) { return Object.prototype.hasOwnProperty.call(this.catalog.local, id); }

  /** What the Store shows for one id, from the catalog or from Flathub. */
  async app(id) {
    if (this.isLocal(id)) {
      const e = this.catalog.local[id];
      return {
        id, name: e.name, summary: e.summary, source: 'ubuntu',
        package: e.apt, icon: `veil-icon://i/${encodeURIComponent(e.icon)}`,
        desktop: e.desktop === '@browser' ? this.browserDesktop : e.desktop
      };
    }
    if (!APP_ID.test(id)) throw new Error('Not an app id: ' + id);
    if (this.details.has(id)) return this.details.get(id);

    const r = await this.fetch(`${FLATHUB}/appstream/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`Flathub answered ${r.status} for ${id}`);
    const d = await r.json();

    const shots = (d.screenshots || [])
      .map(s => pickScreenshot(s))
      .filter(Boolean)
      .slice(0, 6);

    const app = {
      id,
      name: d.name || id,
      summary: d.summary || '',
      description: stripHtml(d.description || ''),
      developer: d.developer_name || '',
      license: d.project_license || '',
      free: d.is_free_license !== false,
      verified: !!(d.metadata && d.metadata['flathub::verification::verified'] === 'true'),
      icon: d.icon || '',
      screenshots: shots,
      homepage: (d.urls && d.urls.homepage) || '',
      source: 'flathub'
    };
    this.details.set(id, app);
    return app;
  }

  /** Many at once, skipping the ones Flathub cannot describe right now. */
  async apps(ids) {
    const out = await Promise.all(ids.map(id => this.app(id).catch(() => null)));
    return out.filter(Boolean);
  }

  async home() {
    const installed = await this.installed();
    const categories = await Promise.all(this.catalog.categories.map(async c => ({
      id: c.id, name: c.name, apps: await this.apps(c.apps)
    })));
    const featured = await this.apps(this.catalog.featured);
    const windows = await Promise.all(this.catalog.windows.map(async w => ({
      from: w.from, apps: await this.apps(w.use)
    })));
    return { featured, categories, windows, installed: [...installed] };
  }

  /** Flathub's search, with anything from the catalog that matches first. */
  async search(query) {
    const q = String(query || '').trim().slice(0, 100);
    if (!q) return [];
    const needle = q.toLowerCase();

    const local = Object.entries(this.catalog.local)
      .filter(([, e]) => (e.name + ' ' + e.summary).toLowerCase().includes(needle))
      .map(([id]) => id);

    let remote = [];
    try {
      const r = await this.fetch(`${FLATHUB}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, filters: [] })
      });
      if (r.ok) {
        const data = await r.json();
        remote = (data.hits || [])
          .filter(h => h.type === 'desktop-application' || h.type === 'console-application' || !h.type)
          .slice(0, 40)
          .map(h => {
            const app = {
              id: h.app_id,
              name: h.name,
              summary: h.summary || '',
              developer: h.developer_name || '',
              icon: h.icon || '',
              verified: !!h.verification_verified,
              free: h.is_free_license !== false,
              installs: h.installs_last_month || 0,
              source: 'flathub'
            };
            if (!this.details.has(app.id)) this.details.set(app.id, app);
            return app;
          })
          .filter(a => APP_ID.test(a.id || ''));
      }
    } catch {
      // Offline: the catalog matches still show.
    }

    return [...await this.apps(local), ...remote];
  }

  /* --------------------------------------------------------- what's there */

  /** Every catalog or Flathub id that is installed, as a Set. */
  async installed() {
    const have = new Set();

    const fp = await this.run('flatpak', ['list', '--app', '--columns=application']);
    if (fp.code === 0) {
      for (const line of fp.stdout.split('\n')) {
        const id = line.trim();
        if (id && id !== 'Application ID') have.add(id);
      }
    }

    const pkgs = Object.values(this.catalog.local).map(e => e.apt);
    const dq = await this.run('dpkg-query', ['-W', '-f=${Package} ${db:Status-Abbrev}\\n', ...pkgs]);
    const installedPkgs = new Set(
      dq.stdout.split('\n')
        .map(l => l.trim().split(/\s+/))
        .filter(([, status]) => status && status.startsWith('ii'))
        .map(([name]) => name)
    );
    for (const [id, e] of Object.entries(this.catalog.local)) {
      if (installedPkgs.has(e.apt)) have.add(id);
    }
    return have;
  }

  /** Apps with a newer version waiting. */
  async updates() {
    const list = [];
    const fp = await this.run('flatpak', ['remote-ls', '--updates', '--app', '--columns=application']);
    if (fp.code === 0) {
      for (const line of fp.stdout.split('\n')) {
        const id = line.trim();
        if (id && id !== 'Application ID') list.push({ id, source: 'flathub' });
      }
    }
    const apt = await this.run('apt', ['list', '--upgradable'], { env: { LANG: 'C' } });
    if (apt.code === 0) {
      const count = apt.stdout.split('\n').filter(l => l.includes('[upgradable')).length;
      if (count > 0) list.push({ id: 'system', source: 'ubuntu', count });
    }
    return list;
  }

  /* --------------------------------------------------------- changing them */

  /**
   * Install one app. Progress arrives through `onProgress({ id, percent, text })`
   * while it runs; the promise settles when it is done.
   */
  async install(id, onProgress = () => {}) {
    return this.change('install', id, onProgress);
  }

  async remove(id, onProgress = () => {}) {
    return this.change('remove', id, onProgress);
  }

  async change(action, id, onProgress) {
    if (this.busy.has(id)) throw new Error('Already working on this app');
    this.busy.set(id, action);
    const report = (percent, text) => onProgress({ id, action, percent, text });

    try {
      if (this.isLocal(id)) {
        const pkg = this.catalog.local[id].apt;
        if (!APT_NAME.test(pkg)) throw new Error('Not a package name: ' + pkg);
        report(null, action === 'install' ? 'Asking for permission' : 'Asking for permission to remove');
        const r = await this.stream('pkexec', [HELPER, action, pkg], line => {
          const pct = aptPercent(line);
          report(pct, tidyLine(line));
        });
        if (r.code === 126 || r.code === 127) throw new Error('Permission was not given');
        if (r.code !== 0) throw new Error(lastUsefulLine(r.tail) || `apt stopped with code ${r.code}`);
      } else {
        if (!APP_ID.test(id)) throw new Error('Not an app id: ' + id);
        const args = action === 'install'
          ? ['install', '--system', '--noninteractive', '-y', 'flathub', id]
          : ['uninstall', '--system', '--noninteractive', '-y', id];
        report(0, action === 'install' ? 'Starting' : 'Removing');
        const r = await this.stream('flatpak', args, line => {
          report(flatpakPercent(line), tidyLine(line));
        });
        if (r.code !== 0) throw new Error(lastUsefulLine(r.tail) || `flatpak stopped with code ${r.code}`);
      }
      report(100, action === 'install' ? 'Installed' : 'Removed');
      return { id, action, ok: true };
    } finally {
      this.busy.delete(id);
    }
  }

  async updateAll(onProgress = () => {}) {
    const report = (percent, text) => onProgress({ id: 'updates', action: 'update', percent, text });
    report(0, 'Updating apps');
    const fp = await this.stream('flatpak', ['update', '--system', '--noninteractive', '-y'],
      line => report(flatpakPercent(line), tidyLine(line)));
    report(50, 'Updating the system');
    const sys = await this.stream('pkexec', [HELPER, 'upgrade'],
      line => report(aptPercent(line), tidyLine(line)));
    report(100, 'Up to date');
    return { apps: fp.code === 0, system: sys.code === 0 };
  }

  /** Open an installed app. */
  async launch(id) {
    if (this.isLocal(id)) {
      const desktop = (await this.app(id)).desktop;
      if (!desktop) throw new Error('No launcher for ' + id);
      return this.run('gtk-launch', [path.basename(desktop, '.desktop')]);
    }
    if (!APP_ID.test(id)) throw new Error('Not an app id: ' + id);
    return this.run('flatpak', ['run', id]);
  }
}

/* --------------------------------------------------------------- helpers */

function pickScreenshot(shot) {
  const sizes = shot && shot.sizes;
  if (!Array.isArray(sizes) || !sizes.length) return null;
  // The largest that is not enormous.
  const sorted = sizes
    .map(s => ({ src: s.src, width: Number(s.width) || 0 }))
    .filter(s => s.src)
    .sort((a, b) => a.width - b.width);
  const pick = sorted.filter(s => s.width <= 1280).pop() || sorted[0];
  return pick ? pick.src : null;
}

/**
 * AppStream descriptions are a little HTML: paragraphs and lists. Line breaks
 * inside a paragraph are only how the source file was wrapped, so they go;
 * paragraphs and list items keep their own lines.
 */
function stripHtml(html) {
  return String(html)
    .replace(/\s+/g, ' ')
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<\/(ul|ol)>\s*/gi, '\n\n')
    .replace(/\s*<li>\s*/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function flatpakPercent(line) {
  const m = /(\d{1,3})%/.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
}

/** apt's machine-readable progress, from the helper's APT::Status-Fd. */
function aptPercent(line) {
  const m = /^(?:pmstatus|dlstatus):[^:]*:(\d+(?:\.\d+)?):/.exec(line);
  return m ? Math.min(100, Math.round(Number(m[1]))) : null;
}

function tidyLine(line) {
  const m = /^(?:pmstatus|dlstatus):[^:]*:[^:]*:(.*)$/.exec(line);
  return (m ? m[1] : line).slice(0, 140);
}

function lastUsefulLine(tail) {
  const lines = String(tail || '').split('\n').map(s => s.trim()).filter(Boolean);
  const err = lines.reverse().find(l => /error|failed|not found|unable|denied/i.test(l));
  return (err || lines[0] || '').replace(/^error:\s*/i, '').slice(0, 200);
}

module.exports = { Store, flatpakPercent, aptPercent, stripHtml, APP_ID, APT_NAME };
