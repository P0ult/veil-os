'use strict';
/* The Veil Appearance page. */

const look = window.veil.look;
const $ = (id) => document.getElementById(id);

// Each layout's own taskbar size and button side, for its small picture.
const LAYOUT_LOOK = {
  classic: { size: 48, buttons: 'right' },
  modern: { size: 48, buttons: 'right' },
  dock: { size: 56, buttons: 'left' },
  traditional: { size: 40, buttons: 'right' },
  touch: { size: 64, buttons: 'right' },
  gnome: { size: 48, buttons: 'right' }
};

const CURSOR_NAMES = {
  'Bibata-Modern-Ice': 'Bibata, white',
  'Bibata-Modern-Classic': 'Bibata, black',
  'Bibata-Modern-Amber': 'Bibata, amber',
  'Adwaita': 'Adwaita, GNOME\'s own',
  'DMZ-White': 'DMZ, white',
  'DMZ-Black': 'DMZ, black'
};

let st = null;                 // the last state the system reported
const live = {};               // slider values while they are being dragged
let built = false;

/* -------------------------------------------------------------- helpers */

function accentColour(id) {
  const a = st && st.options.accents.find(x => x.id === id);
  return a ? a.colour : '#7dd3a0';
}

function thumbFor(p) {
  if (!p) return '';
  const m = /^(\/usr\/share\/backgrounds\/veil)\/([^/]+)$/.exec(p);
  return localUrl(m ? `${m[1]}/thumbs/${m[2]}` : p);
}

function pressed(group, value) {
  for (const b of $(group).querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
  }
}

function fill(input) {
  const min = Number(input.min), max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function blurWord(v) {
  if (v <= 0) return 'Off';
  if (v < 35) return 'Light';
  if (v < 70) return 'Medium';
  return 'Strong';
}

// Changes run one after another, so a quick run of clicks lands in order.
let queue = Promise.resolve();
function apply(what, fn) {
  queue = queue.then(async () => {
    document.body.classList.add('busy');
    try {
      const next = await fn();
      if (next && next.options) render(next);
    } catch (e) {
      toast(`Couldn't change the ${what}: ${e.message}`, { error: true });
      try { render(await look.state()); } catch {}
    } finally {
      document.body.classList.remove('busy');
    }
  });
  return queue;
}

/* ------------------------------------------------------------- building */

function build() {
  const layouts = $('layouts');
  for (const l of st.options.layouts) {
    layouts.append(el('button', {
      class: 'layout', role: 'radio', 'aria-checked': 'false', 'data-id': l.id,
      onclick: () => { if (st.layout !== l.id) apply('layout', () => look.layout(l.id)); }
    },
      el('div', { class: 'shot' }),
      el('span', { class: 'name', text: l.name })));
  }

  const swatches = $('swatches');
  for (const a of st.options.accents) {
    swatches.append(el('button', {
      class: 'swatch', role: 'radio', 'aria-checked': 'false', 'aria-label': a.name, title: a.name,
      'data-id': a.id, style: { '--c': a.colour },
      onclick: () => {
        if (st.accent === a.id) return;
        setAccent(a.colour);
        live.accent = a.id;
        drawAll();
        apply('colour', async () => {
          try { return await look.accent(a.id); } finally { delete live.accent; }
        });
      }
    }));
  }

  $('scheme').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.value !== st.scheme) apply('mode', () => look.scheme(b.dataset.value));
  });
  $('position').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) apply('taskbar position', () => look.panel({ position: b.dataset.value }));
  });
  $('scale').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) apply('text scale', () => look.textScale(Number(b.dataset.value)));
  });
  $('cursor-size').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) apply('pointer size', () => look.cursor(null, Number(b.dataset.value)));
  });
  $('buttons').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) apply('title bar buttons', () => look.buttons(b.dataset.value));
  });
  $('animations').addEventListener('click', () => {
    apply('animations', () => look.animations(!st.animations));
  });

  slider('size', 'taskbar size', (v) => `${v} px`, (v) => look.panel({ size: v }));
  slider('opacity', 'taskbar opacity', (v) => `${v}%`, (v) => look.panel({ opacity: v }));
  slider('blur', 'frosted glass', blurWord, (v) => look.blur(v));

  $('font').addEventListener('change', () => apply('typeface', () => look.font($('font').value, Number($('font-size').value))));
  $('font-size').addEventListener('change', () => apply('text size', () => look.font($('font').value, Number($('font-size').value))));
  $('cursor').addEventListener('change', () => apply('pointer', () => look.cursor($('cursor').value, null)));

  for (let s = 8; s <= 16; s++) $('font-size').append(el('option', { value: s, text: `${s} pt` }));

  $('reset').addEventListener('click', confirmReset);

  // Arrow keys move through radio groups, as they do in GNOME's own.
  document.addEventListener('keydown', (e) => {
    const radio = e.target.closest && e.target.closest('[role="radio"]');
    if (!radio || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const all = [...radio.parentElement.querySelectorAll('[role="radio"]')];
    const i = all.indexOf(radio);
    const next = all[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length];
    e.preventDefault();
    next.focus();
    next.click();
  });

  built = true;
}

function slider(id, what, word, send) {
  const input = $(id);
  input.addEventListener('input', () => {
    live[id] = Number(input.value);
    $(`${id}-value`).textContent = word(live[id]);
    fill(input);
    drawAll();
  });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    apply(what, async () => {
      try { return await send(v); } finally { delete live[id]; }
    });
  });
}

function buildWalls() {
  const walls = $('walls');
  const list = [...st.options.wallpapers];
  if (st.wallpaper && !list.some(w => w.path === st.wallpaper)) {
    list.unshift({ path: st.wallpaper, name: 'Your picture', own: true });
  }
  const key = list.map(w => w.path).join('|');
  if (walls.dataset.key === key) return;
  walls.dataset.key = key;

  walls.replaceChildren(...list.map(w => el('button', {
    class: 'wall', role: 'radio', 'aria-checked': 'false', 'aria-label': w.name, title: w.name,
    'data-path': w.path,
    onclick: () => { if (st.wallpaper !== w.path) apply('wallpaper', () => look.wallpaper(w.path)); }
  }, el('img', { src: w.own ? localUrl(w.path) : localUrl(w.thumb), alt: '', loading: 'lazy' }))),
  el('button', { class: 'wall choose', onclick: () => apply('wallpaper', () => look.pickWallpaper()) },
    el('span', { class: 'plus', 'aria-hidden': 'true', text: '+' }),
    'Choose a picture'));
}

function confirmReset() {
  const foot = $('foot');
  foot.replaceChildren(
    el('span', { class: 'muted', text: 'Put back the layout, colour, wallpaper, text and pointer Veil started with?' }),
    el('button', { class: 'btn primary', text: 'Restore', onclick: () => {
      apply('look', () => look.reset()).then(() => { restoreFoot(); toast('Veil\'s look is back'); });
    } }),
    el('button', { class: 'btn quiet', text: 'Cancel', onclick: restoreFoot }));
  foot.querySelector('.btn.primary').focus();
}

function restoreFoot() {
  $('foot').replaceChildren(el('button', { class: 'btn quiet', id: 'reset', text: 'Restore Veil\'s look', onclick: confirmReset }));
}

/* ------------------------------------------------------------ rendering */

function current() {
  const accent = live.accent || st.accent;
  return {
    layout: st.layout,
    accent: accentColour(accent),
    wallpaper: thumbFor(st.wallpaper),
    scheme: st.scheme,
    position: st.panel.position,
    size: live.size != null ? live.size : st.panel.size,
    opacity: live.opacity != null ? live.opacity : st.panel.opacity,
    blur: live.blur != null ? live.blur : st.blur,
    buttons: st.buttons
  };
}

function drawAll() {
  const now = current();
  $('preview').innerHTML = Preview.draw(now);
  for (const b of $('layouts').children) {
    const id = b.dataset.id;
    const own = LAYOUT_LOOK[id] || LAYOUT_LOOK.classic;
    b.querySelector('.shot').innerHTML = Preview.draw({
      ...now, layout: id, position: 'BOTTOM', size: own.size, buttons: own.buttons
    });
  }
}

function render(next) {
  st = next;
  if (!built) build();

  setScheme(st.scheme === 'dark');
  if (!live.accent) setAccent(accentColour(st.accent));

  for (const b of $('layouts').children) b.setAttribute('aria-checked', String(b.dataset.id === st.layout));
  const layout = st.options.layouts.find(l => l.id === st.layout);
  $('now-name').textContent = layout ? layout.name : '';
  $('now-desc').textContent = layout ? layout.description : '';
  for (const b of $('swatches').children) b.setAttribute('aria-checked', String(b.dataset.id === (live.accent || st.accent)));
  const accent = st.options.accents.find(a => a.id === st.accent);
  $('accent-name').textContent = accent ? accent.name : '';
  pressed('scheme', st.scheme);

  buildWalls();
  for (const b of $('walls').querySelectorAll('.wall[data-path]')) {
    b.setAttribute('aria-checked', String(b.dataset.path === st.wallpaper));
  }

  const noBar = st.layout === 'gnome';
  $('taskbar-none').hidden = !noBar;
  $('taskbar-rows').classList.toggle('off', noBar);
  pressed('position', st.panel.position);
  for (const [id, value, word] of [
    ['size', st.panel.size, (v) => `${v} px`],
    ['opacity', st.panel.opacity, (v) => `${v}%`],
    ['blur', st.blur, blurWord]
  ]) {
    if (live[id] != null) continue;
    $(id).value = value;
    $(`${id}-value`).textContent = word(value);
    fill($(id));
  }

  const fonts = [...new Set([...st.options.fonts, st.font.family])];
  const font = $('font');
  if (font.dataset.key !== fonts.join('|')) {
    font.dataset.key = fonts.join('|');
    font.replaceChildren(...fonts.map(f => el('option', { value: f, text: f })));
  }
  font.value = st.font.family;
  $('font-size').value = String(Math.round(st.font.size));

  const scales = [0.9, 1, 1.1, 1.25, 1.5];
  const nearest = scales.reduce((a, b) => Math.abs(b - st.textScale) < Math.abs(a - st.textScale) ? b : a);
  pressed('scale', nearest);

  const cursors = [...new Set([...st.options.cursors, st.cursor.theme])];
  const cursor = $('cursor');
  if (cursor.dataset.key !== cursors.join('|')) {
    cursor.dataset.key = cursors.join('|');
    cursor.replaceChildren(...cursors.map(c => el('option', { value: c, text: CURSOR_NAMES[c] || c.replace(/-/g, ' ') })));
  }
  cursor.value = st.cursor.theme;
  pressed('cursor-size', st.cursor.size);

  pressed('buttons', st.buttons);
  $('animations').setAttribute('aria-checked', String(!!st.animations));

  drawAll();
}

/* ---------------------------------------------------------------- start */

(async () => {
  const info = await boot();
  if (info.mock) $('stage-caption').textContent = 'Preview mode: nothing on this computer changes.';
  try {
    render(await look.state());
  } catch (e) {
    document.querySelector('.wrap').replaceChildren(el('div', { class: 'group' },
      el('h2', { text: 'Appearance couldn\'t read the desktop\'s settings' }),
      el('p', { class: 'muted', text: e.message })));
  }
})();
