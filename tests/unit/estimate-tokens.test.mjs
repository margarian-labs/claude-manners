import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimate, parseFrontmatter } from '../../owner/estimate-tokens.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../owner/estimate-tokens.mjs');

function write(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estimate-'));
  write(dir, 'payload/rules/r.md', 'a'.repeat(101));
  write(dir, 'payload/skills/s/SKILL.md', `---\nname: s\ndescription: ${'b'.repeat(40)}\n---\n${'body '.repeat(500)}\n`);
  write(dir, 'payload/skills/q/SKILL.md', `---\nname: q\ndescription: "${'c'.repeat(8)}"\n---\nbody\n`);
  write(dir, 'payload/agents/ag.md', `---\nname: ag\ndescription: >-\n  ${'d'.repeat(20)}\n  ${'e'.repeat(19)}\nmodel: x\n---\nbody ${'z'.repeat(1000)}\n`);
  write(dir, 'payload/hooks/h.js', 'x'.repeat(5000));
  const entry = {
    id: 'demo', title: 'Demo', group: 'tools', level: 'optional', summary: 's',
    needs: [],
    files: [
      { src: 'payload/skills/s', dest: 'skills/s', mode: 'managed' },
      { src: 'payload/skills/q', dest: 'skills/q', mode: 'managed' },
      { src: 'payload/agents/ag.md', dest: 'agents/ag.md', mode: 'managed' },
      { src: 'payload/hooks/h.js', dest: 'hooks/h.js', mode: 'managed' },
    ],
    settings: [], rules: ['payload/rules/r.md'],
    tokens_always_on: { value: null, how: 'not measured yet' },
    quality: 'tried',
  };
  write(dir, 'catalog/demo.json', JSON.stringify(entry, null, 2) + '\n');
  write(dir, 'catalog/plain.json', JSON.stringify({ id: 'plain', title: 'P', files: [], rules: [], tokens_always_on: { value: null, how: 'x' } }, null, 2) + '\n');
  return dir;
}

test('parseFrontmatter handles scalars, quotes, folded text and lists', () => {
  const fm = parseFrontmatter('---\na: one\nb: "two words"\nc: [x, y]\nd:\n  - p\n  - q\ne: >\n  folded\n  text\n---\nbody');
  assert.deepEqual(fm, { a: 'one', b: 'two words', c: ['x', 'y'], d: ['p', 'q'], e: 'folded text' });
});

test('estimate sums rules, skill descriptions and agent descriptions', () => {
  const dir = makeRepo();
  const r = estimate(dir, 'demo');
  assert.equal(r.how, 'estimated chars/4');
  assert.deepEqual(r.breakdown.map((b) => [b.kind, b.tokens]), [
    ['rule', 26],
    ['skill', 10 + 10],
    ['skill', 2 + 10],
    ['agent', 10 + 10],
  ]);
  assert.equal(r.tokens, 26 + 20 + 12 + 20);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('estimate throws on a missing source', () => {
  const dir = makeRepo();
  fs.rmSync(path.join(dir, 'payload/rules/r.md'));
  assert.throws(() => estimate(dir, 'demo'), /missing file/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--write changes only tokens_always_on and keeps key order and format', () => {
  const dir = makeRepo();
  const before = fs.readFileSync(path.join(dir, 'catalog/demo.json'), 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, 'demo', '--write', '--repo', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).tokens, 78);
  const after = fs.readFileSync(path.join(dir, 'catalog/demo.json'), 'utf8');
  assert.equal(after, before.replace('"value": null,\n    "how": "not measured yet"', '"value": 78,\n    "how": "estimated chars/4"'));
  assert.deepEqual(Object.keys(JSON.parse(after)), Object.keys(JSON.parse(before)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--all prints every part and --write updates each file', () => {
  const dir = makeRepo();
  const r = spawnSync(process.execPath, [SCRIPT, '--all', '--write', '--repo', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).map((x) => [x.id, x.tokens]), [['demo', 78], ['plain', 0]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'catalog/plain.json'), 'utf8')).tokens_always_on, { value: 0, how: 'estimated chars/4' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('usage error exits 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});
