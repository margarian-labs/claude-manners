import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../../owner/estimate-tokens.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../owner/new-proposal.mjs');
const today = new Date().toISOString().slice(0, 10);

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function write(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

const TEMPLATE = `---
# Copy this file.
id: example-change   # kebab-case
title: TODO short title
kind: change
part: TODO          # a catalog id
touches:            # files written
  - TODO
tokens_always_on: "+240"   # a number
tokens_how: guess
---

## What changes
Plain words.
`;

function makeRepo({ template = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-proposal-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (template) write(dir, 'proposals/TEMPLATE.md', TEMPLATE);
  write(dir, 'payload/rules/r.md', 'a'.repeat(40));
  write(dir, 'catalog/demo.json', JSON.stringify({ id: 'demo', files: [], rules: ['payload/rules/r.md'], tokens_always_on: { value: null, how: 'x' } }, null, 2) + '\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, '--repo', dir, ...args], { encoding: 'utf8' });

test('creates a proposal from the template with id, date, part, touches and tokens', () => {
  const dir = makeRepo();
  write(dir, 'payload/rules/r.md', 'b'.repeat(80));
  write(dir, 'payload/new.txt', 'new');
  const r = run(dir, 'my-change', '--part', 'demo');
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(dir, 'proposals', `${today}-my-change.md`);
  const text = fs.readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text, { comments: true });
  assert.equal(fm.id, `${today}-my-change`);
  assert.equal(fm.date, undefined);
  assert.equal(fm.part, 'demo');
  assert.deepEqual(fm.touches, ['payload/new.txt', 'rules/r.md']);
  assert.equal(fm.tokens_always_on, '31');
  assert.equal(fm.tokens_how, 'estimated chars/2.6');
  assert.equal(fm.kind, 'change');
  assert.equal(fm.title, 'TODO short title');
  assert.match(text, /## What changes\nPlain words\./);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without --part the part and tokens lines stay as in the template', () => {
  const dir = makeRepo();
  const r = run(dir, 'no-part');
  assert.equal(r.status, 0, r.stderr);
  const fm = parseFrontmatter(fs.readFileSync(path.join(dir, 'proposals', `${today}-no-part.md`), 'utf8'), { comments: true });
  assert.equal(fm.part, 'TODO');
  assert.equal(fm.tokens_always_on, '+240');
  assert.deepEqual(fm.touches, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stops with an error when TEMPLATE.md is missing', () => {
  const dir = makeRepo({ template: false });
  const r = run(dir, 'x');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /TEMPLATE\.md not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses an existing file, a bad slug and an unknown part', () => {
  const dir = makeRepo();
  assert.equal(run(dir, 'dup').status, 0);
  assert.match(run(dir, 'dup').stderr, /already exists/);
  assert.equal(run(dir, 'Bad Slug').status, 1);
  assert.match(run(dir, 'p', '--part', 'nope').stderr, /no catalog entry/);
  assert.equal(run(dir).status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
