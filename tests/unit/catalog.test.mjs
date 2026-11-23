import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, validateEntry } from '../../sync/lib/catalog.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = () => JSON.parse(fs.readFileSync(path.join(repo, 'catalog', 'plugin-figma.json'), 'utf8'));
const ids = new Set(['plugin-figma', 'status-line', 'other']);
const has = (errs, text) => errs.some((e) => e.includes(text));

test('all real catalog entries load and validate', () => {
  const cat = loadCatalog(repo);
  assert.equal(cat.size, fs.readdirSync(path.join(repo, 'catalog')).filter((f) => f.endsWith('.json')).length);
  const all = new Set(cat.keys());
  for (const [id, e] of cat) assert.deepEqual(validateEntry(e, all), [], id);
});

test('base entry is valid', () => {
  assert.deepEqual(validateEntry(base(), ids), []);
});

test('keys: missing, extra, order', () => {
  const e = base();
  delete e.risk;
  assert.ok(has(validateEntry(e, ids), 'missing keys: risk'));
  assert.ok(has(validateEntry({ ...base(), extra: 1 }, ids), 'unknown keys: extra'));
  const { id, title, ...rest } = base();
  assert.ok(has(validateEntry({ title, id, ...rest }, ids), 'out of order'));
});

test('enums and summary length', () => {
  assert.ok(has(validateEntry({ ...base(), group: 'x' }, ids), 'group'));
  assert.ok(has(validateEntry({ ...base(), level: 'x' }, ids), 'level'));
  assert.ok(has(validateEntry({ ...base(), quality: 'x' }, ids), 'quality'));
  assert.deepEqual(validateEntry({ ...base(), summary: 'a'.repeat(140) }, ids), []);
  assert.ok(has(validateEntry({ ...base(), summary: 'a'.repeat(141) }, ids), 'max 140'));
});

test('needs forms', () => {
  const good = ['windows', 'second-profile', 'memohopper-connected', 'fable-access', 'haiku-access', 'part:status-line', 'plugin:figma', 'cmd:node', 'cmd:node.exe', 'claude>=2.1.0'];
  assert.deepEqual(validateEntry({ ...base(), needs: good }, ids), []);
  for (const bad of ['linux', 'part:', 'cmd:Node', 'claude>=', 'claude>2', 'part:UP']) {
    assert.ok(has(validateEntry({ ...base(), needs: [bad] }, ids), 'not an allowed form'), bad);
  }
  assert.ok(has(validateEntry({ ...base(), needs: ['part:missing'] }, ids), 'does not exist'));
  assert.ok(has(validateEntry({ ...base(), needs: ['part:plugin-figma'] }, ids), 'itself'));
});

test('files: keys, mode, dest', () => {
  const f = (o) => ({ ...base(), files: [{ src: 'payload/a.js', dest: 'hooks/a.js', mode: 'managed', ...o }] });
  assert.deepEqual(validateEntry(f({}), ids), []);
  assert.deepEqual(validateEntry(f({ dest: '{memory_dir}/x.md', mode: 'seed' }), ids), []);
  assert.ok(has(validateEntry(f({ mode: 'copy' }), ids), 'mode'));
  assert.ok(has(validateEntry(f({ dest: '../x' }), ids), 'dest'));
  assert.ok(has(validateEntry(f({ dest: 'C:/x' }), ids), 'dest'));
  assert.ok(has(validateEntry({ ...base(), files: [{ src: 'a', dest: 'b' }] }, ids), 'keys must be src, dest, mode'));
});

test('plugins, mcp, values, tokens, misc types', () => {
  assert.ok(has(validateEntry({ ...base(), plugins: [{ name: 'a', marketplace: 'nope' }] }, ids), 'marketplace'));
  assert.ok(has(validateEntry({ ...base(), mcp: [{ name: 'a' }] }, ids), 'mcp[0]'));
  assert.deepEqual(validateEntry({ ...base(), mcp: [{ name: 'a', config: { command: 'x' } }] }, ids), []);
  assert.ok(has(validateEntry({ ...base(), values: [{ key: 'K', ask: 'a', default: '' }] }, ids), 'values[0]'));
  assert.deepEqual(validateEntry({ ...base(), values: [{ key: 'K', file: 'a.md', frontmatter: 'model', ask: 'a', default: '' }] }, ids), []);
  assert.ok(has(validateEntry({ ...base(), tokens_always_on: { value: 'x', how: 'not measured yet' } }, ids), 'tokens_always_on.value'));
  assert.ok(has(validateEntry({ ...base(), tokens_always_on: { value: 1, how: 'guess' } }, ids), 'tokens_always_on.how'));
  assert.ok(has(validateEntry({ ...base(), ask_alone: 'no' }, ids), 'ask_alone'));
  assert.ok(has(validateEntry({ ...base(), license: 5 }, ids), 'license'));
  assert.ok(has(validateEntry({ ...base(), verify: 'x' }, ids), 'verify'));
});

test('em and en dash rejected', () => {
  const d = String.fromCharCode(0x2014);
  const n = String.fromCharCode(0x2013);
  assert.ok(has(validateEntry({ ...base(), risk: `a ${d} b` }, ids), 'dash'));
  assert.ok(has(validateEntry({ ...base(), title: `a${n}b` }, ids), 'dash'));
});

test('loadCatalog: id must equal file name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cat-'));
  try {
    fs.mkdirSync(path.join(dir, 'catalog'));
    fs.writeFileSync(path.join(dir, 'catalog', 'SCHEMA.md'), '# x');
    fs.writeFileSync(path.join(dir, 'catalog', 'a.json'), JSON.stringify({ ...base(), id: 'b' }));
    assert.throws(() => loadCatalog(dir), /id must equal the file name/);
    fs.writeFileSync(path.join(dir, 'catalog', 'a.json'), JSON.stringify({ ...base(), id: 'a' }));
    assert.deepEqual([...loadCatalog(dir).keys()], ['a']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
