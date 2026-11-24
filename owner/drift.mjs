import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allIds, readEntry } from './estimate-tokens.mjs';

const USAGE = 'usage: drift.mjs [--all] [--json] [--repo dir] [--config-dir dir]';
const norm = (p) => p.replace(/\\/g, '/');
const text = (p) => fs.readFileSync(p, 'latin1').replace(/\r\n/g, '\n');
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

// Installed dependencies and caches inside a live skill folder are not shipped files.
const SKIP_DIRS = new Set(['.venv', 'venv', 'node_modules', '__pycache__', '.git']);

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...walk(dir, r)); }
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

function compare(srcAbs, liveAbs, rendered) {
  if (!isFile(liveAbs)) return 'missing-live';
  if (text(srcAbs) === text(liveAbs)) return 'same';
  return rendered ? 'differs (rendered, check by hand)' : 'differs';
}

export function drift(repoDir, configDir) {
  const parts = [];
  const rules = [];
  for (const id of allIds(repoDir)) {
    const entry = readEntry(repoDir, id);
    const files = [];
    for (const f of entry.files ?? []) {
      if (f.mode !== 'managed' && f.mode !== 'rendered') continue;
      const rendered = f.mode === 'rendered';
      const src = norm(f.src), dest = norm(f.dest);
      const srcAbs = path.join(repoDir, src);
      if (!fs.existsSync(srcAbs)) throw new Error(`${id}: missing src ${src}`);
      if (isDir(srcAbs)) {
        const liveDir = path.join(configDir, dest);
        const repoFiles = walk(srcAbs);
        for (const rel of repoFiles) {
          files.push({ dest: `${dest}/${rel}`, src: `${src}/${rel}`, status: compare(path.join(srcAbs, rel), path.join(liveDir, rel), rendered) });
        }
        if (isDir(liveDir)) {
          const known = new Set(repoFiles);
          for (const rel of walk(liveDir)) if (!known.has(rel)) files.push({ dest: `${dest}/${rel}`, src: null, status: 'live-only' });
        }
      } else {
        files.push({ dest, src, status: compare(srcAbs, path.join(configDir, dest), rendered) });
      }
    }
    for (const r of entry.rules ?? []) rules.push({ id, src: norm(r), dest: `rules/${path.posix.basename(norm(r))}` });
    parts.push({ id, files });
  }
  const count = (fn) => parts.reduce((n, p) => n + p.files.filter((f) => fn(f.status)).length, 0);
  const summary = {
    differ: count((s) => s.startsWith('differs')),
    missingLive: count((s) => s === 'missing-live'),
    liveOnly: count((s) => s === 'live-only'),
    same: count((s) => s === 'same'),
    rules: rules.length,
  };
  return { parts, rules, summary };
}

export function format(result, all) {
  const out = [];
  for (const p of result.parts) {
    const shown = p.files.filter((f) => all || f.status !== 'same');
    if (!shown.length) continue;
    out.push(`${p.id}`);
    for (const f of shown) out.push(`  ${f.status}  ${f.dest}`);
  }
  if (result.rules.length) {
    out.push('rules');
    for (const r of result.rules) out.push(`  generalized, compare by hand: ${r.src} -> ${r.dest}`);
  }
  const s = result.summary;
  out.push(`drift: ${s.differ} differ, ${s.missingLive} missing-live, ${s.liveOnly} live-only, ${s.same} same; ${s.rules} rule files to compare by hand`);
  return out;
}

export function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let all = false, json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') all = true;
    else if (a === '--json') json = true;
    else if (a === '--repo' || a === '--config-dir') {
      if (i + 1 >= argv.length) { console.error(USAGE); return 2; }
      const v = path.resolve(argv[++i]);
      if (a === '--repo') repoDir = v; else configDir = v;
    } else { console.error(USAGE); return 2; }
  }
  try {
    const result = drift(repoDir, configDir);
    if (json) {
      const parts = result.parts.map((p) => ({ id: p.id, files: p.files.filter((f) => all || f.status !== 'same') }));
      console.log(JSON.stringify({ parts, rules: result.rules, summary: result.summary }, null, 2));
    } else {
      for (const l of format(result, all)) console.log(l);
    }
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
