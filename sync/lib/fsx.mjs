import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const lower = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...[...rest].reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

export function inside(parent, child) {
  const rel = path.relative(lower(realish(parent)), lower(realish(child)));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

export function assertAllowed(p) {
  if (process.env.CLAUDE_SETUP_TEST !== '1') return p;
  const root = process.env.CLAUDE_SETUP_TEST_ROOT;
  if (!root || !inside(root, p)) throw new Error(`test mode: refusing path outside CLAUDE_SETUP_TEST_ROOT: ${p}`);
  return p;
}

export function configDir() {
  return assertAllowed(path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
}

export function hashBuffer(buf) {
  let b = buf;
  if (b.includes(13) && !b.includes(0)) {
    const out = Buffer.allocUnsafe(b.length);
    let n = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === 13 && b[i + 1] === 10) continue;
      out[n++] = b[i];
    }
    b = out.subarray(0, n);
  }
  return crypto.createHash('sha256').update(b).digest('hex');
}

export function walk(dir) {
  const out = [];
  const rec = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) rec(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  rec(dir, '');
  return out.sort();
}

export function hashTree(dir) {
  const lines = walk(dir).map((r) => `${r}\0${hashFile(path.join(dir, r))}`);
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function hashFile(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return st.isDirectory() ? hashTree(p) : hashBuffer(fs.readFileSync(p));
}

export function readJson(p, fallback = null) {
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`invalid JSON in ${p}: ${e.message}`);
  }
}

function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        fs.rmSync(from, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
    }
  }
}

export function writeFileAtomic(dest, bytes, { exec = false } = {}) {
  assertAllowed(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  if (exec) fs.chmodSync(tmp, 0o755);
  renameRetry(tmp, dest);
}

export function writeJsonAtomic(p, obj) {
  writeFileAtomic(p, JSON.stringify(obj, null, 2) + '\n');
}

export function copyAtomic(src, dest, opts) {
  writeFileAtomic(dest, fs.readFileSync(src), opts);
}

export function relInside(cfg, abs) {
  const rel = path.relative(cfg, abs);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`path is outside the config dir: ${abs}`);
  return rel.split(path.sep).join('/');
}

export function backupFile(runDir, absPath, cfg = configDir()) {
  const rel = relInside(cfg, absPath);
  if (!fs.existsSync(absPath)) return null;
  const dest = path.join(runDir, 'files', ...rel.split('/'));
  if (!fs.existsSync(dest)) copyAtomic(absPath, dest);
  return dest;
}

export function removeFile(absPath, cfg = configDir()) {
  assertAllowed(absPath);
  fs.rmSync(absPath, { force: true });
  let d = path.dirname(absPath);
  for (;;) {
    const rel = path.relative(cfg, d);
    if (!rel || rel.startsWith('..') || !rel.includes(path.sep)) break;
    try {
      if (!fs.lstatSync(d).isDirectory() || fs.readdirSync(d).length) break;
      fs.rmdirSync(d);
    } catch {
      break;
    }
    d = path.dirname(d);
  }
}

export function journal(runDir, event) {
  const file = path.join(runDir, 'journal.jsonl');
  assertAllowed(file);
  fs.mkdirSync(runDir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n');
}

export function readJournal(runDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(runDir, 'journal.jsonl'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      break;
    }
  }
  return out;
}
