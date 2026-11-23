#!/usr/bin/env node
// Read-only report of what a Claude Code session may have left behind.
// Usage: node claude-tidy.mjs --scratchpad <path> [--since <ISO date>] [--cwd <path>]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const configDirs = (home) => { let extra = []; try { extra = fs.readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('.claude-')).map((e) => path.join(home, e.name)); } catch {} return [path.join(home, '.claude'), ...extra]; };

const MAX_LINES = 40;
const MAX_REPOS = 30;
const BIG = 50 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', '.git', 'AppData']);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const home = process.env.USERPROFILE || os.homedir();
const cwdArg = arg('--cwd') || process.cwd();
const scratchArg = arg('--scratchpad');
const sinceArg = arg('--since');

const pad = (n) => String(n).padStart(2, '0');
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtSize(b) {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GB';
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}
function norm(p) {
  return path.resolve(p).toLowerCase();
}
function git(repo, args, timeout = 5000) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}
function section(title, fn) {
  console.log('');
  console.log(`== ${title} ==`);
  try {
    const lines = fn();
    if (!lines || lines.length === 0) {
      console.log('(none)');
      return;
    }
    for (const l of lines.slice(0, MAX_LINES)) console.log(l);
    if (lines.length > MAX_LINES) console.log(`... ${lines.length - MAX_LINES} more`);
  } catch (e) {
    console.log(`note: section failed (${String(e && e.message || e).split('\n')[0]})`);
  }
}
function entryLine(p, st) {
  const size = st.isDirectory() ? 'dir' : fmtSize(st.size);
  return `${p}  ${size}  created ${fmtDate(st.birthtimeMs)}`;
}

// ---- session id and start time ----
let scratch = scratchArg;
let sessionDir = null;
let sessionId = 'unknown';
if (scratch) {
  try {
    scratch = fs.realpathSync.native(scratch);
  } catch {
    // keep as given
  }
  sessionDir = path.dirname(scratch);
  sessionId = path.basename(sessionDir);
}

let start = null;
let source = '';
if (sinceArg) {
  const t = Date.parse(sinceArg);
  if (!Number.isNaN(t)) {
    start = t;
    source = '--since override';
  }
}
if (start === null && sessionId !== 'unknown') {
  for (const dir of configDirs(home).map((d) => path.join(d, 'sessions'))) {
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j && j.sessionId === sessionId && Number.isFinite(j.startedAt)) {
          start = j.startedAt;
          source = `startedAt from ${path.join(dir, f)}`;
          break;
        }
      } catch {
        // skip unparsable
      }
    }
    if (start !== null) break;
  }
}
if (start === null && sessionDir) {
  try {
    start = fs.statSync(sessionDir).birthtimeMs;
    source = 'session folder birthtime';
  } catch {
    // fall through
  }
}
if (start === null) {
  start = Date.now() - 12 * 3600 * 1000;
  source = 'fallback: now minus 12 h';
}

console.log(
  `Tidy report for session ${sessionId} since ${fmtDate(start)} (${source}). Items may come from parallel sessions: delete only what this session created.`
);

// ---- 1. created since start in top-level folders ----
section('1. Created since start (top level)', () => {
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = [
    home,
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Documents'),
    path.join(local, 'Temp'),
    path.join(home, '.claude'),
    path.join(home, '.claude', 'tools'),
    ...configDirs(home).slice(1),
  ];
  const out = [];
  for (const d of dirs) {
    let names;
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (d.toLowerCase().endsWith(path.join('local', 'temp')) && n.toLowerCase() === 'claude') continue;
      const p = path.join(d, n);
      try {
        const st = fs.lstatSync(p);
        if (st.birthtimeMs >= start) out.push(entryLine(p, st));
      } catch {
        // ignore
      }
    }
  }
  return out;
});

// ---- repos ----
const repos = [];
const repoSet = new Set();
function addRepo(p) {
  const k = norm(p);
  if (!repoSet.has(k) && repos.length < MAX_REPOS) {
    repoSet.add(k);
    repos.push(p);
  }
}
try {
  const top = git(cwdArg, ['rev-parse', '--show-toplevel']).trim();
  if (top) addRepo(path.resolve(top));
} catch {
  // cwd not in a repo
}
if (norm(cwdArg) !== norm(home)) {
  const walk = (dir, depth) => {
    if (repos.length >= MAX_REPOS || depth > 3) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (ents.some((e) => e.name === '.git')) addRepo(dir);
    for (const e of ents) {
      if (SKIP_DIRS.has(e.name) || e.isSymbolicLink() || !e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      try {
        if (fs.lstatSync(p).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      walk(p, depth + 1);
    }
  };
  walk(path.resolve(cwdArg), 0);
}

// ---- 2. untracked files ----
section(`2. Untracked files created since start (${repos.length} repos checked)`, () => {
  const out = [];
  for (const r of repos) {
    try {
      const raw = git(r, ['status', '--porcelain', '--untracked-files=all', '-z']);
      const toks = raw.split('\0');
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (!t) continue;
        const code = t.slice(0, 2);
        if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') {
          i++;
          continue;
        }
        if (code !== '??') continue;
        const p = path.join(r, t.slice(3));
        try {
          const st = fs.lstatSync(p);
          if (st.birthtimeMs >= start) out.push(entryLine(p, st));
        } catch {
          // ignore
        }
      }
    } catch (e) {
      out.push(`${r}: git status skipped (${String(e && e.message || e).split('\n')[0]})`);
    }
  }
  return out;
});

// ---- 3. worktrees ----
section('3. Worktrees', () => {
  const out = [];
  const seen = new Set();
  for (const r of repos) {
    let raw;
    try {
      raw = git(r, ['worktree', 'list', '--porcelain']);
    } catch (e) {
      continue;
    }
    const blocks = raw.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
    blocks.forEach((b, idx) => {
      if (idx === 0) {
        seen.add(norm(b.split(/\r?\n/)[0].replace(/^worktree /, '')));
        return;
      }
      const lines = b.split(/\r?\n/);
      const wt = (lines.find((l) => l.startsWith('worktree ')) || '').slice(9);
      if (!wt || seen.has(norm(wt))) return;
      seen.add(norm(wt));
      const branchLine = lines.find((l) => l.startsWith('branch '));
      const branch = branchLine ? branchLine.slice(7).replace('refs/heads/', '') : lines.includes('detached') ? '(detached)' : '(none)';
      const prunable = lines.some((l) => l.startsWith('prunable'));
      let state = 'n/a';
      let last = 'n/a';
      if (!prunable && fs.existsSync(wt)) {
        try {
          const n = git(wt, ['status', '--porcelain']).split(/\r?\n/).filter(Boolean).length;
          state = n === 0 ? 'clean' : `dirty (${n})`;
        } catch {
          state = 'status failed';
        }
        try {
          last = git(wt, ['log', '-1', '--format=%cs']).trim() || 'n/a';
        } catch {
          // keep n/a
        }
      }
      out.push(`${wt}  branch ${branch}  prunable ${prunable ? 'yes' : 'no'}  ${state}  last commit ${last}  (repo ${r})`);
    });
  }
  return out;
});

// ---- 4. big files in own session folder ----
section('4. Files over 50 MB in the session folder', () => {
  if (!sessionDir) return ['skipped (no --scratchpad)'];
  const out = [];
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      let st;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size >= BIG) out.push(entryLine(p, st));
    }
  };
  walk(sessionDir);
  return out;
});

// ---- 5. containers ----
section('5. Containers created since start', () => {
  let raw;
  try {
    raw = execFileSync('podman', ['ps', '-a', '--format', 'json'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const reason = e && e.code === 'ENOENT' ? 'podman not found' : e && e.killed ? 'timeout' : String(e && e.message || e).split('\n')[0];
    return [`podman: skipped (${reason})`];
  }
  let list;
  try {
    list = JSON.parse(raw || '[]');
  } catch {
    return ['podman: skipped (unparsable output)'];
  }
  const out = [];
  for (const c of list || []) {
    let created = c.Created;
    if (typeof created === 'string') created = Date.parse(created) / 1000;
    if (!Number.isFinite(created) || created * 1000 < start) continue;
    const name = Array.isArray(c.Names) ? c.Names.join(',') : c.Names || c.Id;
    out.push(`${name}  image ${c.Image}  state ${c.State}  created ${fmtDate(created * 1000)}`);
  }
  return out;
});
