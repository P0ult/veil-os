'use strict';

/**
 * GNOME settings, through the `gsettings` program.
 *
 * Values are GVariant text on the way in and on the way out, the same form
 * dconf files and desktop/layouts.json use. Helpers convert the common
 * shapes; anything else is passed through as written.
 */
class GSettings {
  /** @param {Function} runner  run(cmd, args) -> {code, stdout, stderr} */
  constructor(runner) {
    this.runner = runner;
  }

  async get(schema, key) {
    const r = await this.runner('gsettings', ['get', schema, key]);
    if (r.code !== 0) throw new Error(`gsettings get ${schema} ${key}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  }

  async set(schema, key, value) {
    const r = await this.runner('gsettings', ['set', schema, key, String(value)]);
    if (r.code !== 0) throw new Error(`gsettings set ${schema} ${key}: ${r.stderr.trim()}`);
  }

  async reset(schema, key) {
    await this.runner('gsettings', ['reset', schema, key]);
  }

  /** The value read as a JavaScript value where that is unambiguous. */
  async read(schema, key) {
    return parse(await this.get(schema, key));
  }

  /** Is this schema installed at all? An extension that is missing has none. */
  async has(schema) {
    const r = await this.runner('gsettings', ['list-keys', schema]);
    return r.code === 0;
  }
}

/* ---------------------------------------------------------- GVariant text */

function str(value) {
  // GVariant strings take single quotes; escape the two characters that
  // would end or break one.
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function strv(list) {
  return '[' + list.map(str).join(', ') + ']';
}

function bool(value) {
  return value ? 'true' : 'false';
}

function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('not a number: ' + value);
  return String(n);
}

/** A double: GVariant needs the decimal point to know it is not an int. */
function dbl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('not a number: ' + value);
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/** The subset of GVariant text gsettings prints for the keys used here. */
function parse(text) {
  const t = String(text).trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^(uint32|int32|double|uint64|int64) /.test(t)) return Number(t.split(' ')[1]);
  if (/^'.*'$/s.test(t)) return unquote(t);
  if (t.startsWith('@as []') || t === '[]') return [];
  if (/^\[.*\]$/s.test(t) && (t[1] === "'" || t[1] === ']')) {
    const out = [];
    const re = /'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(t)) !== null) out.push(m[1].replace(/\\(.)/g, '$1'));
    return out;
  }
  return t;
}

function unquote(t) {
  return t.slice(1, -1).replace(/\\(.)/g, '$1');
}

module.exports = { GSettings, gv: { str, strv, bool, num, dbl, parse } };
