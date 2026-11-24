import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { git, previousTag } from './tag-release.mjs';
import { destsFor } from './estimate-tokens.mjs';
import { listFiles, scanFiles } from './dash-scan.mjs';

const GROUPS = ['rules', 'settings', 'workflow', 'hooks', 'agents', 'skills', 'plugins', 'tools', 'integrations', 'lessons'];
const START = '<!-- catalog:start -->';
const END = '<!-- catalog:end -->';

const asList = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
function errorsOf(r) {
  if (Array.isArray(r)) return r.map(String);
  if (r && Array.isArray(r.errors)) return r.errors.map(String);
  if (typeof r === 'string') return [r];
  if (r === false) return ['invalid'];
  return [];
}

async function loadLib(repoDir, file) {
  return import(pathToFileURL(path.join(repoDir, 'sync', 'lib', file)).href);
}

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export function readCatalog(repoDir) {
  const dir = path.join(repoDir, 'catalog');
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
}

export function generateTable(entries) {
  const rank = (g) => { const i = GROUPS.indexOf(g); return i < 0 ? GROUPS.length : i; };
  const sorted = [...entries].sort((a, b) => rank(a.group) - rank(b.group) || a.title.localeCompare(b.title));
  const groups = (list, item) => {
    const out = [];
    for (const g of [...new Set(list.map((e) => e.group))]) {
      const parts = list.filter((e) => e.group === g);
      const label = String(g).charAt(0).toUpperCase() + String(g).slice(1);
      out.push('<details>', `<summary><b>${label}</b> · ${parts.length} ${parts.length === 1 ? 'part' : 'parts'}</summary>`, '',
        ...parts.map(item), '', '</details>', '');
    }
    return out;
  };
  const line = (e) => `- **${e.title}** \`${e.level}\`<br>${e.summary}`;
  return [
    '### Works on its own', '', 'Once installed, these work in every session without you doing anything.', '',
    ...groups(sorted.filter((e) => e.use !== 'you'), line),
    '### You start these', '', 'These do nothing until you use them; the line in italics says how.', '',
    ...groups(sorted.filter((e) => e.use === 'you'), (e) => `${line(e)}<br>_${e.trigger}_`),
  ].join('\n').trim();
}

export function checkReadme(repoDir, entries, fix) {
  const p = path.join(repoDir, 'README.md');
  if (!fs.existsSync(p)) return { ok: false, details: ['README.md not found'] };
  const text = fs.readFileSync(p, 'utf8');
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < a) return { ok: false, details: [`README.md needs ${START} and ${END} markers`] };
  const table = generateTable(entries);
  const current = text.slice(a + START.length, b).trim();
  if (current === table) return { ok: true, details: [] };
  if (!fix) return { ok: false, details: ['README catalog table is out of date (run: node owner/check.mjs --fix-readme)'] };
  fs.writeFileSync(p, `${text.slice(0, a + START.length)}\n${table}\n${text.slice(b)}`);
  return { ok: true, details: ['README catalog table regenerated'] };
}

export function missingSrc(entries, repoDir) {
  const out = [];
  for (const e of entries) {
    const srcs = [...(e.files ?? []).map((f) => f.src), ...(e.settings ?? []), ...(e.rules ?? [])];
    for (const s of srcs) if (!fs.existsSync(path.join(repoDir, s))) out.push(`${e.id}: missing ${s}`);
  }
  return out;
}

export function untouchedPayload(repoDir, prev, entries, touches) {
  const changed = new Set([
    ...lines(git(repoDir, ['diff', '--name-only', prev])),
    ...lines(git(repoDir, ['ls-files', '--others', '--exclude-standard'])),
  ]);
  const covers = (t, x) => t === x || x.startsWith(t.endsWith('/') ? t : `${t}/`);
  const pointers = touches.some((t) => t.startsWith('/'));
  const covered = (f) => [f, ...destsFor(entries, f)].some((x) =>
    touches.some((t) => covers(t.replace(/\/\*{1,2}$/, '/'), x)) || (x === 'settings.json' && pointers));
  return [...changed].filter((f) => f.startsWith('payload/') && !covered(f)).sort();
}

async function steps(repoDir, fixReadme) {
  const results = [];
  const run = async (name, fn) => {
    try {
      const details = await fn();
      results.push({ name, ok: !details.length, details });
    } catch (e) {
      results.push({ name, ok: false, details: [String(e.message || e)] });
    }
  };
  let entries = [];
  const catalogErrors = [];
  await run('catalog entries valid', async () => {
    entries = readCatalog(repoDir);
    const { loadCatalog, validateEntry } = await loadLib(repoDir, 'catalog.mjs');
    const loaded = asList(await loadCatalog(repoDir));
    const ids = loaded.map((e) => e.id);
    for (const e of loaded) for (const m of errorsOf(validateEntry(e, ids))) catalogErrors.push(`${e.id}: ${m}`);
    return catalogErrors;
  });
  await run('proposals valid', async () => {
    const { loadProposals, validateProposal } = await loadLib(repoDir, 'proposals.mjs');
    const ids = entries.map((e) => e.id);
    const out = [];
    for (const p of asList(await loadProposals(repoDir))) for (const m of errorsOf(validateProposal(p, ids))) out.push(`${p.id ?? p.file ?? '?'}: ${m}`);
    return out;
  });
  await run('catalog src paths exist', () => missingSrc(entries, repoDir));
  await run('changed payload files listed in proposals', async () => {
    const prev = previousTag(repoDir);
    if (!prev) return [];
    const { loadProposals } = await loadLib(repoDir, 'proposals.mjs');
    const touches = asList(await loadProposals(repoDir)).flatMap((p) => p.meta?.touches ?? []);
    return untouchedPayload(repoDir, prev, entries, touches).map((f) => `${f}: not in any proposal's touches (changed since ${prev})`);
  });
  const readme = checkReadme(repoDir, entries, fixReadme);
  results.push({ name: 'README catalog up to date', ok: readme.ok, details: readme.details });
  await run('no em or en dash', () => scanFiles(repoDir, listFiles(repoDir)).map((h) => `${h.file}:${h.line}: ${h.char}`));
  await run('privacy scan', () => {
    const script = path.join(repoDir, 'owner', 'privacy-scan.mjs');
    if (!fs.existsSync(script)) return ['owner/privacy-scan.mjs not found'];
    const r = spawnSync(process.execPath, [script, '--all'], { cwd: repoDir, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status === 0) return [];
    return [`exit ${r.status}`, ...lines(`${r.stdout}\n${r.stderr}`)];
  });
  return results;
}

async function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let fixReadme = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoDir = path.resolve(argv[++i]);
    else if (argv[i] === '--fix-readme') fixReadme = true;
    else { console.error('usage: check.mjs [--fix-readme] [--repo dir]'); return 2; }
  }
  const results = await steps(repoDir, fixReadme);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
    const shown = r.ok ? r.details : r.details.slice(0, 20);
    for (const d of shown) console.log(`  ${d}`);
    if (!r.ok && r.details.length > 20) console.log(`  ... ${r.details.length - 20} more`);
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
