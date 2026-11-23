import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOW = 'estimated chars/4';
const tok = (s) => Math.ceil(s.length / 4);

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  if (v.length >= 2 && v[0] === "'" && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function stripComment(v) {
  const q = /^("(?:[^"\\]|\\.)*"|'[^']*')/.exec(v);
  return q ? q[1] : v.replace(/(^|\s)#.*$/, '').trim();
}

export function parseFrontmatter(text, { comments = false } = {}) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const km = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!km) continue;
    const key = km[1];
    const rest = comments ? stripComment(km[2]) : km[2];
    const block = [];
    while (i + 1 < lines.length && /^(\s+\S|-\s|\s*$)/.test(lines[i + 1])) block.push(lines[++i]);
    const items = block.map((l) => l.trim()).filter(Boolean);
    if (rest.startsWith('[')) {
      out[key] = rest.replace(/^\[|\]\s*$/g, '').split(',').map(unquote).filter(Boolean);
    } else if (/^[>|][+-]?$/.test(rest)) {
      out[key] = items.join(rest[0] === '>' ? ' ' : '\n');
    } else if (rest === '' && items.length && items.every((l) => l.startsWith('- '))) {
      out[key] = items.map((l) => unquote(l.slice(2)));
    } else {
      out[key] = [unquote(rest), ...items].filter((s) => s !== '').join(' ');
    }
  }
  return out;
}

function readText(repoDir, rel) {
  const p = path.join(repoDir, rel);
  if (!fs.existsSync(p)) throw new Error(`missing file: ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

function descTokens(text, rel) {
  const d = parseFrontmatter(text).description;
  if (typeof d !== 'string' || !d) throw new Error(`no description in frontmatter: ${rel}`);
  return tok(d) + 10;
}

export function readEntry(repoDir, id) {
  const p = path.join(repoDir, 'catalog', `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`no catalog entry: ${id}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function estimate(repoDir, id) {
  const entry = readEntry(repoDir, id);
  const breakdown = [];
  for (const rel of entry.rules ?? []) {
    breakdown.push({ kind: 'rule', path: rel, tokens: tok(readText(repoDir, rel)) });
  }
  for (const f of entry.files ?? []) {
    const abs = path.join(repoDir, f.src);
    if (!fs.existsSync(abs)) throw new Error(`missing src: ${f.src}`);
    const dest = f.dest.replace(/\\/g, '/');
    const isDir = fs.statSync(abs).isDirectory();
    if (isDir && dest.startsWith('skills/')) {
      const rel = `${f.src}/SKILL.md`;
      if (fs.existsSync(path.join(repoDir, rel))) {
        breakdown.push({ kind: 'skill', path: rel, tokens: descTokens(readText(repoDir, rel), rel) });
      }
    } else if (isDir && dest.startsWith('agents/')) {
      for (const n of fs.readdirSync(abs).filter((n) => n.endsWith('.md')).sort()) {
        const rel = `${f.src}/${n}`;
        breakdown.push({ kind: 'agent', path: rel, tokens: descTokens(readText(repoDir, rel), rel) });
      }
    } else if (!isDir && dest.startsWith('agents/') && dest.endsWith('.md')) {
      breakdown.push({ kind: 'agent', path: f.src, tokens: descTokens(readText(repoDir, f.src), f.src) });
    }
  }
  const tokens = breakdown.reduce((a, b) => a + b.tokens, 0);
  return { id, tokens, how: HOW, breakdown };
}

export function writeEstimate(repoDir, id, tokens) {
  const p = path.join(repoDir, 'catalog', `${id}.json`);
  const raw = fs.readFileSync(p, 'utf8');
  const obj = JSON.parse(raw);
  obj.tokens_always_on = { value: tokens, how: HOW };
  const nl = raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + nl);
}

const norm = (p) => p.replace(/\\/g, '/');

export function destsFor(entries, file) {
  const f = norm(file);
  const out = new Set();
  for (const e of entries) {
    for (const x of e.files ?? []) {
      const src = norm(x.src), dest = norm(x.dest);
      if (f === src) out.add(dest);
      else if (f.startsWith(`${src}/`)) out.add(`${dest}/${f.slice(src.length + 1)}`);
    }
    if ((e.rules ?? []).some((r) => norm(r) === f)) out.add(`rules/${path.posix.basename(f)}`);
    if ((e.settings ?? []).some((s) => norm(s) === f)) out.add('settings.json');
  }
  return [...out];
}

export function allIds(repoDir) {
  return fs.readdirSync(path.join(repoDir, 'catalog')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
}

function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let all = false, write = false;
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoDir = path.resolve(argv[++i]);
    else if (argv[i] === '--all') all = true;
    else if (argv[i] === '--write') write = true;
    else if (argv[i].startsWith('--')) { console.error(`unknown option ${argv[i]}`); return 2; }
    else ids.push(argv[i]);
  }
  if (!all && ids.length !== 1) { console.error('usage: estimate-tokens.mjs <part-id> | --all [--write] [--repo dir]'); return 2; }
  try {
    const results = (all ? allIds(repoDir) : ids).map((id) => estimate(repoDir, id));
    if (write) for (const r of results) writeEstimate(repoDir, r.id, r.tokens);
    console.log(JSON.stringify(all ? results : results[0], null, 2));
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
