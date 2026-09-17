'use strict';
const { spawn } = require('node:child_process');

/**
 * Run a program and collect what it says.
 *
 * Never through a shell: every argument is passed as-is, so a package name or
 * a wallpaper path with a space or a quote in it is just a string, not a
 * command. That matters in a program whose whole job is to run other programs
 * with values that came from a web API or a file picker.
 */
function run(cmd, args = [], { timeout = 120000, env, input } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;

    let child;
    try {
      child = spawn(cmd, args, {
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e.message || e) });
      return;
    }

    const timer = setTimeout(() => {
      if (!done) {
        try { child.kill('SIGTERM'); } catch {}
      }
    }, timeout);

    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e.message || e) });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });

    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Run a program and hand each line of its output to `onLine` as it arrives.
 * Used for installs, where the progress is the point.
 */
function stream(cmd, args = [], onLine, { env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      onLine(String(e.message || e));
      resolve({ code: -1, tail: String(e.message || e) });
      return;
    }

    const tail = [];
    const feed = (buffer) => {
      // flatpak redraws its progress line with carriage returns rather than
      // newlines, so both end a line here.
      for (const line of String(buffer).split(/[\r\n]+/)) {
        const clean = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
        if (!clean) continue;
        tail.push(clean);
        if (tail.length > 20) tail.shift();
        try { onLine(clean); } catch {}
      }
    };

    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => {
      tail.push(String(e.message || e));
      resolve({ code: -1, tail: tail.join('\n') });
    });
    child.on('close', (code) => resolve({ code: code == null ? -1 : code, tail: tail.join('\n') }));
  });
}

module.exports = { run, stream };
