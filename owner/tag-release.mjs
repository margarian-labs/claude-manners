import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFrontmatter } from './estimate-tokens.mjs';

export function git(repoDir, args, input) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim();
}

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export function versionTags(repoDir) {
  const key = (t) => t.slice(1).split('.').map(Number);
  return lines(git(repoDir, ['tag', '--list', 'v*']))
    .filter((t) => /^v\d+(\.\d+)*$/.test(t))
    .sort((a, b) => {
      const x = key(a), y = key(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    });
}

export function previousTag(repoDir) {
  const tags = versionTags(repoDir);
  return tags.length ? tags[tags.length - 1] : null;
}

export function headTag(repoDir) {
  const t = lines(git(repoDir, ['tag', '--points-at', 'HEAD', '--list', 'v*']));
  return t[0] ?? null;
}

export function nextTag(repoDir, now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const n = versionTags(repoDir).filter((t) => t.startsWith(`v${d}.`)).length;
  return `v${d}.${n + 1}`;
}

export function changedProposals(repoDir, prev) {
  const raw = prev
    ? git(repoDir, ['diff', '--name-only', '--diff-filter=AM', prev, 'HEAD', '--', 'proposals'])
    : git(repoDir, ['ls-tree', '-r', '--name-only', 'HEAD', 'proposals']);
  return lines(raw).filter((f) => /^proposals\/[^/]+\.md$/.test(f) && !/\/(TEMPLATE|README)\.md$/.test(f)).sort();
}

export function buildMessage(repoDir, prev) {
  const items = changedProposals(repoDir, prev).map((f) => {
    const fm = parseFrontmatter(git(repoDir, ['show', `HEAD:${f}`]), { comments: true });
    const id = fm.id || path.basename(f, '.md');
    return `- ${id}: ${fm.title || ''}`.trimEnd();
  });
  return ['Proposals in this version:', ...(items.length ? items : ['(none)'])].join('\n');
}

export function release(repoDir, { dryRun = false, now = new Date() } = {}) {
  const existing = headTag(repoDir);
  if (existing) return { tag: existing, created: false, message: null };
  const tag = nextTag(repoDir, now);
  const message = buildMessage(repoDir, previousTag(repoDir));
  if (!dryRun) git(repoDir, ['tag', '-a', tag, '-F', '-'], message + '\n');
  return { tag, created: !dryRun, message };
}

function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoDir = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') dryRun = true;
    else { console.error('usage: tag-release.mjs [--dry-run] [--repo dir]'); return 2; }
  }
  try {
    const r = release(repoDir, { dryRun });
    if (!r.message) console.log(`HEAD already tagged ${r.tag}`);
    else console.log(`${r.created ? 'Created' : 'Would create'} tag ${r.tag}\n${r.message}`);
    return 0;
  } catch (e) {
    console.error((e.stderr || e.message).toString().trim());
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
