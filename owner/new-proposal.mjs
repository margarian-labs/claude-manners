import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { estimate, allIds, readEntry, destsFor } from './estimate-tokens.mjs';
import { git } from './tag-release.mjs';

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export function changedFiles(repoDir) {
  let base = 'HEAD';
  try { git(repoDir, ['rev-parse', '--verify', '-q', 'origin/main']); base = 'origin/main'; } catch {}
  const tracked = lines(git(repoDir, ['diff', '--name-only', base]));
  const fresh = lines(git(repoDir, ['ls-files', '--others', '--exclude-standard']));
  return [...new Set([...tracked, ...fresh])].filter((f) => !f.startsWith('proposals/')).sort();
}

function setKey(fm, key, newLines) {
  const start = fm.findIndex((l) => l.startsWith(`${key}:`));
  if (start < 0) { fm.push(...newLines); return; }
  let end = start + 1;
  while (end < fm.length && /^(\s+\S|-\s)/.test(fm[end])) end++;
  fm.splice(start, end - start, ...newLines);
}

export function touchesFor(repoDir) {
  const entries = allIds(repoDir).map((id) => readEntry(repoDir, id));
  const out = new Set();
  for (const f of changedFiles(repoDir)) {
    if (!f.startsWith('payload/')) continue;
    const dests = destsFor(entries, f);
    for (const d of dests.length ? dests : [f]) out.add(d);
  }
  return [...out].sort();
}

export function fillTemplate(template, { id, date, part, touches, tokens }) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(template);
  if (!m) throw new Error('TEMPLATE.md has no frontmatter');
  const fm = m[2].split(/\r?\n/);
  setKey(fm, 'id', [`id: ${id}`]);
  if (fm.some((l) => l.startsWith('date:'))) setKey(fm, 'date', [`date: ${date}`]);
  if (part) setKey(fm, 'part', [`part: ${part}`]);
  setKey(fm, 'touches', touches.length ? ['touches:', ...touches.map((t) => `  - ${t}`)] : ['touches: []']);
  if (tokens !== null) {
    setKey(fm, 'tokens_always_on', [`tokens_always_on: ${tokens}`]);
    if (fm.some((l) => l.startsWith('tokens_how:'))) setKey(fm, 'tokens_how', ['tokens_how: estimated chars/2.6']);
  }
  return m[1] + fm.join('\n') + m[3] + template.slice(m[0].length);
}

export function createProposal(repoDir, slug, { part = null, now = new Date() } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('slug must be lowercase letters, digits and hyphens');
  const tpl = path.join(repoDir, 'proposals', 'TEMPLATE.md');
  if (!fs.existsSync(tpl)) throw new Error('proposals/TEMPLATE.md not found');
  const date = now.toISOString().slice(0, 10);
  const id = `${date}-${slug}`;
  const out = path.join(repoDir, 'proposals', `${id}.md`);
  if (fs.existsSync(out)) throw new Error(`already exists: proposals/${id}.md`);
  const tokens = part ? estimate(repoDir, part).tokens : null;
  const text = fillTemplate(fs.readFileSync(tpl, 'utf8'), { id, date, part, touches: touchesFor(repoDir), tokens });
  fs.writeFileSync(out, text);
  return out;
}

function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let part = null;
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoDir = path.resolve(argv[++i]);
    else if (argv[i] === '--part') part = argv[++i];
    else if (argv[i].startsWith('--')) pos.push(null);
    else pos.push(argv[i]);
  }
  if (pos.length !== 1 || !pos[0] || part === undefined) { console.error('usage: new-proposal.mjs <slug> [--part id] [--repo dir]'); return 2; }
  try {
    console.log(`Created ${path.relative(repoDir, createProposal(repoDir, pos[0], { part }))}`);
    return 0;
  } catch (e) {
    console.error((e.stderr || e.message).toString().trim());
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
