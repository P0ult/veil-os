'use strict';
/* Small helpers both pages use. No framework: the pages are small. */

/**
 * Build an element. `props` sets attributes, except `class`, `text`, `on*`
 * handlers and `style` objects, which are handled the way they read.
 */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** replaceChildren, skipping the null and false left by conditionals. */
function fillWith(node, ...children) {
  node.replaceChildren(...children.flat().filter(c => c != null && c !== false));
  return node;
}

let toastTimer = null;
function toast(message, { error = false } = {}) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 6000 : 3200);
}

function setAccent(colour) {
  if (!/^#[0-9a-f]{6}$/i.test(colour || '')) return;
  document.documentElement.style.setProperty('--accent', colour);
  // Dark text on light accents, light text on dark ones.
  const n = parseInt(colour.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  document.documentElement.style.setProperty('--on-accent', lum > 0.55 ? '#0b0e13' : '#ffffff');
}

function setScheme(dark) {
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
}

/** A local file as the pages may load it. */
function localUrl(p) {
  if (!p) return '';
  return 'veil-local://f' + String(p).split('/').map(encodeURIComponent).join('/');
}

function iconUrl(name) {
  return 'veil-icon://i/' + encodeURIComponent(name || '?');
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function boot() {
  try {
    const info = await window.veil.info();
    setScheme(info.dark);
    setAccent(info.accent);
    document.documentElement.dataset.mock = info.mock ? '1' : '0';
    window.veil.onTheme(t => setScheme(t.dark));
    return info;
  } catch {
    return { mode: 'store', mock: false, dark: true, accent: '#7dd3a0' };
  }
}
