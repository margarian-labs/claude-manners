import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, headTag } from './tag-release.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, stdio: 'inherit' });

if (execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()) {
  console.error('release: commit or stash your changes first.');
  process.exit(1);
}
run(process.execPath, ['owner/check.mjs']);
run(process.execPath, ['owner/privacy-scan.mjs', '--all']);
const existing = headTag(repo);
const r = existing ? { tag: existing, created: false } : release(repo, { dryRun });
console.log(existing ? `HEAD already tagged ${existing}` : `${dryRun ? 'would tag' : 'tagged'} ${r.tag}`);
if (dryRun) process.exit(0);
run('git', ['push', '--follow-tags', 'origin', 'HEAD']);
