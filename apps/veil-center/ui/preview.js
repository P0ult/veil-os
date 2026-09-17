'use strict';
/**
 * Miniature Veil desktops, drawn as SVG: the six layout choices and the large
 * preview above them. They are drawn at a sixth of a 1920x1200 screen, so a
 * 48px taskbar is 8 units tall here and sizes stay in proportion.
 */

const Preview = (() => {
  const W = 320;
  const H = 200;
  const S = W / 1920;
  const APP_COLOURS = ['#5b9bf8', '#f5a524', '#ef6c57', '#9575cd', '#4db6ac', '#90a4ae'];
  const CLOSE = '#ef6b6b';
  let serial = 0;

  const n = (v) => Math.round(v * 100) / 100;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const rect = (x, y, w, h, attrs = '') =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}" ${attrs}/>`;
  const circle = (cx, cy, r, attrs = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs}/>`;

  function palette(scheme) {
    return scheme === 'light'
      ? { panel: '#f3f5f7', ink: '#1d242c', faint: '#8a95a1', win: '#ffffff', head: '#eceff3',
          side: '#f3f5f8', text: '#d3d9e0', shadow: 0.18 }
      : { panel: '#0f1318', ink: '#e6ebf2', faint: '#6f7b89', win: '#1c222a', head: '#242b35',
          side: '#171c23', text: '#353f4b', shadow: 0.45 };
  }

  /* ---------------------------------------------------------------- parts */

  function mark(cx, cy, size, colour) {
    const h = size / 2;
    return `<path d="M${n(cx - h)} ${n(cy - h * 0.72)} L${n(cx)} ${n(cy + h * 0.78)} L${n(cx + h)} ${n(cy - h * 0.72)}"
      fill="none" stroke="${colour}" stroke-width="${n(size * 0.17)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function appIcon(cx, cy, size, i) {
    return rect(cx - size / 2, cy - size / 2, size, size,
      `rx="${n(size * 0.28)}" fill="${APP_COLOURS[i % APP_COLOURS.length]}"`);
  }

  /** A translucent bar, with the wallpaper blurred behind it when blur is on. */
  function glass(ctx, x, y, w, h, r, fill, opacity) {
    const id = `${ctx.id}g${ctx.n++}`;
    let out = '';
    if (ctx.blur > 0 && ctx.wall) {
      out += `<clipPath id="c${id}">${rect(x, y, w, h, `rx="${n(r)}"`)}</clipPath>`;
      out += `<filter id="f${id}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${n(0.6 + ctx.blur / 100 * 3.4)}"/></filter>`;
      out += `<g clip-path="url(#c${id})"><image href="${ctx.wall}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" filter="url(#f${id})"/></g>`;
    }
    out += rect(x, y, w, h, `rx="${n(r)}" fill="${fill}" fill-opacity="${n(opacity)}"`);
    return out;
  }

  function tray(ctx, endX, cy, t, colour) {
    let out = '';
    const clockW = t * 1.2;
    out += rect(endX - clockW, cy - t * 0.14, clockW, t * 0.1, `rx="${n(t * 0.05)}" fill="${colour}"`);
    out += rect(endX - clockW * 0.8, cy + t * 0.06, clockW * 0.8, t * 0.08, `rx="${n(t * 0.04)}" fill="${colour}" fill-opacity="0.6"`);
    for (let i = 0; i < 3; i++) {
      out += circle(endX - clockW - t * 0.45 - i * t * 0.34, cy, t * 0.07, `fill="${colour}" fill-opacity="0.75"`);
    }
    return out;
  }

  /** GNOME's own top bar: workspaces on the left, clock in the middle. */
  function topBar(ctx, h) {
    let out = rect(0, 0, W, h, 'fill="#000" fill-opacity="0.88"');
    const cy = h / 2;
    out += rect(4, cy - h * 0.2, h * 1.1, h * 0.4, `rx="${n(h * 0.2)}" fill="#fff" fill-opacity="0.9"`);
    out += circle(4 + h * 1.5, cy, h * 0.18, 'fill="#fff" fill-opacity="0.45"');
    out += circle(4 + h * 1.95, cy, h * 0.18, 'fill="#fff" fill-opacity="0.45"');
    out += rect(W / 2 - h * 1.3, cy - h * 0.1, h * 2.6, h * 0.2, `rx="${n(h * 0.1)}" fill="#fff" fill-opacity="0.9"`);
    for (let i = 0; i < 3; i++) out += circle(W - 5 - i * h * 0.6, cy, h * 0.14, 'fill="#fff" fill-opacity="0.8"');
    return out;
  }

  /** Dash to Panel as a taskbar along one edge. */
  function taskbar(ctx) {
    const { pos, t, pal, kind } = ctx;
    const vertical = pos === 'LEFT' || pos === 'RIGHT';
    const x = pos === 'RIGHT' ? W - t : 0;
    const y = pos === 'BOTTOM' ? H - t : 0;
    const w = vertical ? t : W;
    const h = vertical ? H : t;
    let out = glass(ctx, x, y, w, h, 0, pal.panel, ctx.opacity);

    const len = vertical ? H : W;
    const icon = t * 0.5;
    const step = t * 0.86;
    const at = (a) => (vertical ? [x + t / 2, a] : [a, y + t / 2]);
    const centred = kind === 'modern' || kind === 'touch';
    const count = 4;
    const pill = kind === 'traditional' && !vertical;
    const startLen = pill ? step * 2.1 : step;
    let p = centred ? (len - startLen - count * step) / 2 : t * 0.15;

    if (pill) {
      const [, cy] = at(0);
      out += rect(p + t * 0.12, cy - t * 0.3, startLen - t * 0.24, t * 0.6,
        `rx="${n(t * 0.14)}" fill="${pal.ink}" fill-opacity="0.08"`);
      out += mark(p + t * 0.5, cy, icon * 0.8, pal.ink);
      out += rect(p + t * 0.85, cy - t * 0.05, startLen - t * 1.15, t * 0.1, `rx="${n(t * 0.05)}" fill="${pal.ink}" fill-opacity="0.8"`);
    } else {
      const [cx, cy] = at(p + startLen / 2);
      out += mark(cx, cy, icon * 0.95, pal.ink);
    }
    p += startLen;

    for (let i = 0; i < count; i++) {
      const [cx, cy] = at(p + step / 2);
      out += appIcon(cx, cy, icon, i);
      if (i < 2) {
        // Running apps get a mark on the screen-edge side, in the accent.
        const len2 = i === 0 ? icon * 0.55 : icon * 0.18;
        const thick = Math.max(0.8, t * 0.07);
        const colour = i === 0 ? ctx.accent : pal.faint;
        if (pos === 'BOTTOM') out += rect(cx - len2 / 2, y + t - thick - 0.4, len2, thick, `rx="${n(thick / 2)}" fill="${colour}"`);
        if (pos === 'TOP') out += rect(cx - len2 / 2, y + 0.4, len2, thick, `rx="${n(thick / 2)}" fill="${colour}"`);
        if (pos === 'LEFT') out += rect(x + 0.4, cy - len2 / 2, thick, len2, `rx="${n(thick / 2)}" fill="${colour}"`);
        if (pos === 'RIGHT') out += rect(x + t - thick - 0.4, cy - len2 / 2, thick, len2, `rx="${n(thick / 2)}" fill="${colour}"`);
      }
      p += step;
    }

    if (vertical) {
      const cx = x + t / 2;
      out += rect(cx - t * 0.3, H - t * 0.55, t * 0.6, t * 0.1, `rx="${n(t * 0.05)}" fill="${pal.ink}"`);
      out += rect(cx - t * 0.22, H - t * 0.38, t * 0.44, t * 0.08, `rx="${n(t * 0.04)}" fill="${pal.ink}" fill-opacity="0.6"`);
      for (let i = 0; i < 3; i++) out += circle(cx, H - t * 0.9 - i * t * 0.34, t * 0.07, `fill="${pal.ink}" fill-opacity="0.75"`);
    } else {
      out += tray(ctx, W - t * 0.3, y + t / 2, t, pal.ink);
    }
    return out;
  }

  /** Dash to Panel as a floating dock, the Mac-like layout. */
  function dock(ctx) {
    const { t, pal } = ctx;
    const icon = t * 0.56;
    const step = t * 0.84;
    const icons = 6;
    const w = icons * step + step * 1.2 + t * 0.3;
    const x = (W - w) / 2;
    const y = H - t - 3;
    let out = glass(ctx, x, y, w, t, t * 0.3, pal.panel, Math.max(ctx.opacity, 0.35));
    let p = x + t * 0.15;
    for (let i = 0; i < icons; i++) {
      out += appIcon(p + step / 2, y + t / 2, icon, i);
      if (i === 0) out += circle(p + step / 2, y + t - 1.1, 0.7, `fill="${ctx.accent}"`);
      p += step;
    }
    out += rect(p + step * 0.08, y + t * 0.25, 0.5, t * 0.5, `fill="${pal.ink}" fill-opacity="0.25"`);
    const gx = p + step * 0.6;
    const cell = icon / 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out += circle(gx - cell + c * cell, y + t / 2 - cell + r * cell, cell * 0.22, `fill="${pal.ink}"`);
      }
    }
    return out;
  }

  /** One app window, in the chosen mode, with the accent where apps use it. */
  function appWindow(ctx, bx, by, bw, bh) {
    const { pal, accent } = ctx;
    const id = `${ctx.id}w`;
    const r = 3.4;
    const head = Math.min(11, bh * 0.14);
    let out = rect(bx, by + 1.5, bw, bh, `rx="${r}" fill="#000" fill-opacity="${pal.shadow}" filter="url(#${id}s)"`);
    out = `<filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter>` + out;
    out += `<clipPath id="${id}c">${rect(bx, by, bw, bh, `rx="${r}"`)}</clipPath>`;
    out += `<g clip-path="url(#${id}c)">`;
    out += rect(bx, by, bw, bh, `fill="${pal.win}"`);
    out += rect(bx, by, bw, head, `fill="${pal.head}"`);

    const cy = by + head / 2;
    const br = head * 0.17;
    const gap = head * 0.55;
    const left = ctx.buttons === 'left';
    const order = left ? ['close', 'min', 'max'] : ['min', 'max', 'close'];
    order.forEach((b, i) => {
      const cx = left ? bx + head * 0.6 + i * gap : bx + bw - head * 0.6 - (order.length - 1 - i) * gap;
      out += circle(cx, cy, br, `fill="${b === 'close' ? CLOSE : pal.faint}" fill-opacity="${b === 'close' ? 1 : 0.55}"`);
    });
    out += rect(bx + bw / 2 - bw * 0.1, cy - 0.8, bw * 0.2, 1.6, `rx="0.8" fill="${pal.faint}"`);

    const sw = bw * 0.28;
    out += rect(bx, by + head, sw, bh - head, `fill="${pal.side}"`);
    for (let i = 0; i < 5; i++) {
      const iy = by + head + 6 + i * 7.5;
      if (i === 1) out += rect(bx + 3, iy - 2.4, sw - 6, 6.4, `rx="2" fill="${accent}" fill-opacity="0.22"`);
      out += rect(bx + 6, iy, sw * (i === 1 ? 0.5 : 0.42 + (i % 2) * 0.12), 1.6,
        `rx="0.8" fill="${i === 1 ? accent : pal.faint}" fill-opacity="${i === 1 ? 1 : 0.7}"`);
    }

    const cx0 = bx + sw + 8;
    const cw = bw - sw - 16;
    out += rect(cx0, by + head + 7, cw * 0.45, 3, `rx="1.2" fill="${pal.ink}" fill-opacity="0.85"`);
    for (let i = 0; i < 4; i++) {
      out += rect(cx0, by + head + 16 + i * 6, cw * (0.95 - i * 0.12), 1.6, `rx="0.8" fill="${pal.text}"`);
    }
    out += rect(cx0 + cw - 24, by + bh - 12, 24, 6.5, `rx="2" fill="${accent}"`);
    out += rect(cx0 + cw - 52, by + bh - 12, 24, 6.5, `rx="2" fill="${pal.ink}" fill-opacity="0.1"`);
    out += '</g>';
    return out;
  }

  /* ----------------------------------------------------------------- draw */

  /**
   * @param {object} o
   * @param {string} o.layout      classic, modern, dock, traditional, touch, gnome
   * @param {string} o.accent      #rrggbb
   * @param {string} o.wallpaper   an image URL the page may load
   * @param {string} o.scheme      dark or light
   * @param {string} o.position    BOTTOM, TOP, LEFT or RIGHT
   * @param {number} o.size        taskbar size in pixels
   * @param {number} o.opacity     0-100
   * @param {number} o.blur        0-100
   * @param {string} o.buttons     left or right
   */
  function draw(o) {
    const ctx = {
      id: `pv${++serial}`,
      n: 0,
      kind: o.layout,
      pal: palette(o.scheme),
      accent: /^#[0-9a-f]{6}$/i.test(o.accent || '') ? o.accent : '#7dd3a0',
      wall: o.wallpaper ? esc(o.wallpaper) : '',
      blur: Math.max(0, Math.min(100, Number(o.blur) || 0)),
      opacity: Math.max(0.1, Math.min(1, (o.opacity == null ? 72 : Number(o.opacity)) / 100)),
      pos: ['BOTTOM', 'TOP', 'LEFT', 'RIGHT'].includes(o.position) ? o.position : 'BOTTOM',
      // A little larger than true scale, so the taskbar reads at this size.
      t: Math.max(6, (Number(o.size) || 48) * S * 1.3),
      buttons: o.buttons === 'left' ? 'left' : 'right'
    };

    let body = `<defs><linearGradient id="${ctx.id}bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b0e13"/><stop offset="1" stop-color="#1b2a33"/></linearGradient></defs>`;
    body += rect(0, 0, W, H, `fill="url(#${ctx.id}bg)"`);
    if (ctx.wall) body += `<image href="${ctx.wall}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;

    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    let chrome = '';
    const bar = 6;
    if (ctx.kind === 'gnome') {
      y0 = bar;
      chrome = topBar(ctx, bar);
    } else if (ctx.kind === 'dock') {
      y0 = bar;
      y1 = H - ctx.t - 6;
      chrome = topBar(ctx, bar) + dock(ctx);
    } else {
      if (ctx.pos === 'BOTTOM') y1 = H - ctx.t;
      if (ctx.pos === 'TOP') y0 = ctx.t;
      if (ctx.pos === 'LEFT') x0 = ctx.t;
      if (ctx.pos === 'RIGHT') x1 = W - ctx.t;
      chrome = taskbar(ctx);
    }

    const fw = x1 - x0;
    const fh = y1 - y0;
    body += appWindow(ctx, x0 + fw * 0.13, y0 + fh * 0.12, fw * 0.74, fh * 0.76);
    body += chrome;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" focusable="false">${body}</svg>`;
  }

  return { draw };
})();
