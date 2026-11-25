import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nextTag, release, versionTags, previousTag } from '../../owner/tag-release.mjs';
import { untouchedPayload } from '../../owner/check.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../owner/tag-release.mjs');
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-release-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  return dir;
}

function commit(dir, files, msg = 'c') {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}

const prop = (id, title) => `---\nid: ${id}   # kebab-case\ntitle: ${title}\n---\nbody\n`;

test('first tag of the day is .1 and uses the UTC date', () => {
  const dir = makeRepo();
  commit(dir, { 'a.txt': '1' });
  assert.equal(nextTag(dir), `v${today}.1`);
  assert.equal(nextTag(dir, new Date('2030-01-02T23:59:00Z')), 'v2030.01.02.1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release tags HEAD with all proposals when no tag exists', () => {
  const dir = makeRepo();
  commit(dir, {
    'proposals/TEMPLATE.md': prop('x', 'template'),
    'proposals/2026-11-23-a.md': prop('2026-11-23-a', 'Alpha change'),
    'proposals/2026-11-23-b.md': prop('2026-11-23-b', 'Beta change'),
  });
  const dry = release(dir, { dryRun: true });
  assert.equal(dry.tag, `v${today}.1`);
  assert.equal(dry.created, false);
  assert.equal(git(dir, 'tag', '--list'), '');
  const r = release(dir);
  assert.equal(r.created, true);
  assert.equal(git(dir, 'tag', '--list'), `v${today}.1`);
  const msg = git(dir, 'tag', '-l', '--format=%(contents)', r.tag);
  assert.equal(msg, 'Proposals in this version:\n- 2026-11-23-a: Alpha change\n- 2026-11-23-b: Beta change');
  assert.equal(git(dir, 'cat-file', '-t', r.tag), 'tag');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('second tag lists only proposals added or changed since the previous tag', () => {
  const dir = makeRepo();
  commit(dir, { 'proposals/2026-11-23-a.md': prop('2026-11-23-a', 'Alpha'), 'proposals/2026-11-23-b.md': prop('2026-11-23-b', 'Beta') });
  release(dir);
  commit(dir, { 'proposals/2026-11-23-b.md': prop('2026-11-23-b', 'Beta v2'), 'proposals/2026-11-24-c.md': prop('2026-11-24-c', 'Gamma') });
  const r = release(dir);
  assert.equal(r.tag, `v${today}.2`);
  assert.equal(r.message, 'Proposals in this version:\n- 2026-11-23-b: Beta v2\n- 2026-11-24-c: Gamma');
  assert.deepEqual(versionTags(dir), [`v${today}.1`, `v${today}.2`]);
  assert.equal(previousTag(dir), `v${today}.2`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('HEAD that already has a v* tag gets no new tag', () => {
  const dir = makeRepo();
  commit(dir, { 'a.txt': '1' });
  git(dir, 'tag', '-a', 'v2026.01.01.1', '-m', 'old');
  const r = release(dir);
  assert.equal(r.created, false);
  assert.equal(r.tag, 'v2026.01.01.1');
  assert.equal(git(dir, 'tag', '--list'), 'v2026.01.01.1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('payload check: only files a part ships need a proposal; a file deleted from a part that still exists does', () => {
  const dir = makeRepo();
  const alpha = { id: 'alpha', files: [{ src: 'payload/skills/alpha', dest: 'skills/alpha' }], settings: [], rules: [] };
  commit(dir, {
    'catalog/alpha.json': JSON.stringify({ ...alpha, rules: ['payload/rules/alpha.md'] }),
    'catalog/gone.json': JSON.stringify({ id: 'gone', files: [{ src: 'payload/skills/gone', dest: 'skills/gone' }], settings: [], rules: [] }),
    'payload/skills/alpha/SKILL.md': 'a',
    'payload/rules/alpha.md': 'r',
    'payload/skills/gone/SKILL.md': 'g',
    'payload/NOTICES.md': 'n',
  });
  git(dir, 'tag', '-a', 'v2026.01.01.1', '-m', 'one');
  fs.rmSync(path.join(dir, 'catalog', 'gone.json'));
  fs.rmSync(path.join(dir, 'payload', 'skills', 'gone'), { recursive: true });
  fs.rmSync(path.join(dir, 'payload', 'rules', 'alpha.md'));
  fs.writeFileSync(path.join(dir, 'payload', 'NOTICES.md'), 'n2');
  fs.writeFileSync(path.join(dir, 'payload', 'skills', 'alpha', 'SKILL.md'), 'a2');
  assert.deepEqual(untouchedPayload(dir, 'v2026.01.01.1', [alpha], []), ['payload/rules/alpha.md', 'payload/skills/alpha/SKILL.md']);
  assert.deepEqual(untouchedPayload(dir, 'v2026.01.01.1', [alpha], ['skills/alpha', 'rules/alpha.md']), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI --dry-run prints the tag and creates nothing', () => {
  const dir = makeRepo();
  commit(dir, { 'proposals/2026-11-23-a.md': prop('2026-11-23-a', 'Alpha') });
  const r = spawnSync(process.execPath, [SCRIPT, '--repo', dir, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Would create tag v${today}\\.1`));
  assert.match(r.stdout, /- 2026-11-23-a: Alpha/);
  assert.equal(git(dir, 'tag', '--list'), '');
  const r2 = spawnSync(process.execPath, [SCRIPT, '--repo', dir], { encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(git(dir, 'tag', '--list'), `v${today}.1`);
  fs.rmSync(dir, { recursive: true, force: true });
});
