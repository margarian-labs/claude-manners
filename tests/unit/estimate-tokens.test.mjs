import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimate, estimateOnUse, parseFrontmatter } from '../../owner/estimate-tokens.mjs';

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
  assert.equal(r.how, 'estimated chars/2.6');
  assert.deepEqual(r.breakdown.map((b) => [b.kind, b.tokens]), [
    ['rule', 39],
    ['skill', 16 + 10],
    ['skill', 4 + 10],
    ['agent', 16 + 10],
  ]);
  assert.equal(r.tokens, 39 + 26 + 14 + 26);
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
  assert.equal(JSON.parse(r.stdout).tokens, 105);
  const after = fs.readFileSync(path.join(dir, 'catalog/demo.json'), 'utf8');
  assert.equal(after, before.replace('"value": null,\n    "how": "not measured yet"', '"value": 105,\n    "how": "estimated chars/2.6"'));
  assert.deepEqual(Object.keys(JSON.parse(after)), Object.keys(JSON.parse(before)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--all prints every part and --write updates each file', () => {
  const dir = makeRepo();
  const r = spawnSync(process.execPath, [SCRIPT, '--all', '--write', '--repo', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).map((x) => [x.id, x.tokens]), [['demo', 105], ['plain', 0]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'catalog/plain.json'), 'utf8')).tokens_always_on, { value: 0, how: 'estimated chars/2.6' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('usage error exits 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('estimateOnUse: full skill and agent text; 0 for text-only parts; unknown for hook, plugin and MCP parts', () => {
  const dir = makeRepo();
  const r = estimateOnUse(dir, 'demo');
  const len = (rel) => Math.ceil(fs.readFileSync(path.join(dir, rel), 'utf8').length / 2.6);
  assert.deepEqual(r.breakdown.map((b) => [b.kind, b.tokens]), [
    ['skill', len('payload/skills/s/SKILL.md')],
    ['skill', len('payload/skills/q/SKILL.md')],
    ['agent', len('payload/agents/ag.md')],
  ]);
  assert.equal(r.tokens, r.breakdown.reduce((a, b) => a + b.tokens, 0));
  assert.equal(r.how, 'estimated chars/2.6');
  assert.deepEqual(estimateOnUse(dir, 'plain'), { tokens: 0, how: 'estimated chars/2.6', breakdown: [] });

  const put = (id, extra) => write(dir, `catalog/${id}.json`, JSON.stringify({ id, files: [], rules: [], settings: [], ...extra }));
  write(dir, 'payload/settings/h.json', JSON.stringify({ hooks: { Stop: [] } }));
  write(dir, 'payload/settings/s.json', JSON.stringify({ model: 'x' }));
  put('hooked', { settings: ['payload/settings/h.json'] });
  put('plain-setting', { settings: ['payload/settings/s.json'] });
  put('plug', { plugins: [{ name: 'p', marketplace: 'a/b' }] });
  put('server', { mcp: [{ name: 'm', config: {} }] });
  for (const id of ['hooked', 'plug', 'server']) assert.deepEqual(estimateOnUse(dir, id), { tokens: null, how: 'not measured yet', breakdown: [] }, id);
  assert.equal(estimateOnUse(dir, 'plain-setting').tokens, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--write fills tokens_on_use only where the entry has the key, and keeps a value set to unknown by hand', () => {
  const dir = makeRepo();
  const p = path.join(dir, 'catalog/demo.json');
  const withKey = (value) => {
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out = Object.fromEntries(Object.entries(e).flatMap(([k, v]) => (k === 'tokens_always_on' ? [[k, v], ['tokens_on_use', value]] : [[k, v]])));
    fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
  };
  withKey({ value: 0, how: 'estimated chars/2.6' });
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--all', '--write', '--repo', dir], { encoding: 'utf8' }).status, 0);
  const demo = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(demo.tokens_on_use.value, estimateOnUse(dir, 'demo').tokens);
  assert.deepEqual(Object.keys(demo).slice(-3), ['tokens_always_on', 'tokens_on_use', 'quality']);
  assert.ok(!('tokens_on_use' in JSON.parse(fs.readFileSync(path.join(dir, 'catalog/plain.json'), 'utf8'))));

  const q = path.join(dir, 'catalog/plain.json');
  fs.writeFileSync(q, JSON.stringify({ ...JSON.parse(fs.readFileSync(q, 'utf8')), tokens_on_use: { value: null, how: 'not measured yet' } }, null, 2) + '\n');
  assert.equal(spawnSync(process.execPath, [SCRIPT, 'plain', '--write', '--repo', dir], { encoding: 'utf8' }).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(q, 'utf8')).tokens_on_use, { value: null, how: 'not measured yet' });
  fs.rmSync(dir, { recursive: true, force: true });
});
