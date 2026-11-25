import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCatalog, validateEntry } from '../../sync/lib/catalog.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = () => JSON.parse(fs.readFileSync(path.join(repo, 'catalog', 'plugin-playwright.json'), 'utf8'));
const ids = new Set(['plugin-playwright', 'status-line', 'other']);
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
  assert.ok(has(validateEntry({ ...base(), needs: ['part:plugin-playwright'] }, ids), 'itself'));
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

test('workflow part text matches its rule: no wake-up timer, no setup-change notices', () => {
  const e = loadCatalog(repo).get('workflow');
  const rule = fs.readFileSync(path.join(repo, e.rules[0]), 'utf8');
  assert.doesNotMatch(rule, /wake-up|timer/i);
  for (const t of [e.summary, e.details]) assert.doesNotMatch(t, /wake-up|timer|setup-change notice|other active sessions/i);
});

test('verify commands check the installed copies, not payload files', () => {
  for (const [id, e] of loadCatalog(repo)) {
    for (const v of e.verify) {
      const rest = v.replace(/\$\{?CLAUDE_SETUP_REPO\}?\/payload\/[^\s"']+/g, '');
      assert.doesNotMatch(rest, /payload\//, `${id}: ${v}`);
      assert.doesNotMatch(v, /~\/\.claude/, `${id}: ${v}`);
    }
  }
});

test('status-line verify leaves no temp folder behind', { skip: spawnSync('bash', ['-c', 'exit 0']).status !== 0 }, () => {
  const e = loadCatalog(repo).get('status-line');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sl-'));
  try {
    const cfgDir = path.join(tmp, 'cfg');
    const tdir = path.join(tmp, 't');
    fs.mkdirSync(cfgDir);
    fs.mkdirSync(tdir);
    fs.writeFileSync(path.join(cfgDir, 'statusline.sh'), 'cat > /dev/null\nexit 0\n');
    const r = spawnSync('bash', ['-c', e.verify[0]], { cwd: cfgDir, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir, CLAUDE_SETUP_REPO: repo, TMPDIR: tdir } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(fs.readdirSync(tdir), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('benefit: optional, right after summary, short; every part but the sync engine has one', () => {
  const { benefit: _, ...b0 } = base();
  const withBenefit = (text) => Object.fromEntries(Object.entries(b0).flatMap(([k, v]) => (k === 'summary' ? [[k, v], ['benefit', text]] : [[k, v]])));
  assert.deepEqual(validateEntry(withBenefit('You can test web pages from Claude.'), ids), []);
  assert.deepEqual(validateEntry(b0, ids), []);
  assert.ok(has(validateEntry(withBenefit(''), ids), 'benefit'));
  assert.ok(has(validateEntry(withBenefit('x'.repeat(101)), ids), 'benefit'));
  assert.ok(has(validateEntry({ ...b0, benefit: 'At the end.' }, ids), 'out of order'));
  for (const [id, e] of loadCatalog(repo)) {
    if (id === 'sync-engine') assert.ok(!('benefit' in e), 'older sync tools reject unknown keys and must still read the sync-engine entry');
    else assert.ok(typeof e.benefit === 'string' && e.benefit.length > 0, `${id} has no benefit`);
  }
});

test('solves, use_cases, tokens_on_use and cost_note: optional, in order, bounded; every part but the sync engine has the first three', () => {
  const NEW = ['solves', 'use_cases', 'tokens_on_use', 'cost_note'];
  const b0 = Object.fromEntries(Object.entries(base()).filter(([k]) => !NEW.includes(k)));
  const put = (e, after, key, value) => Object.fromEntries(Object.entries(e).flatMap(([k, v]) => (k === after ? [[k, v], [key, value]] : [[k, v]])));
  assert.deepEqual(validateEntry(b0, ids), []);

  assert.deepEqual(validateEntry(put(b0, 'benefit', 'solves', 'Pages break and nobody sees it.'), ids), []);
  assert.ok(has(validateEntry(put(b0, 'benefit', 'solves', 'x'.repeat(121)), ids), 'solves'));
  assert.ok(has(validateEntry(put(b0, 'benefit', 'solves', ''), ids), 'solves'));
  assert.ok(has(validateEntry({ ...b0, solves: 'At the end.' }, ids), 'out of order'));

  const cases = (v) => validateEntry(put(b0, 'benefit', 'use_cases', v), ids);
  assert.deepEqual(cases(['One.']), []);
  assert.deepEqual(cases(['1', '2', '3', '4', '5']), []);
  assert.ok(!has(cases(Array(10).fill('U.')), 'use_cases'));
  for (const bad of [[], Array(11).fill('U.'), 'text', ['x'.repeat(121)], ['']]) assert.ok(has(cases(bad), 'use_cases'), JSON.stringify(bad));
  assert.deepEqual(validateEntry(put(put(b0, 'benefit', 'solves', 'S.'), 'solves', 'use_cases', ['U.']), ids), []);
  assert.ok(has(validateEntry(put(put(b0, 'benefit', 'use_cases', ['U.']), 'use_cases', 'solves', 'S.'), ids), 'out of order'));

  const used = (v) => validateEntry(put(b0, 'tokens_always_on', 'tokens_on_use', v), ids);
  assert.deepEqual(used({ value: 1200, how: 'estimated chars/2.6' }), []);
  assert.deepEqual(used({ value: null, how: 'not measured yet' }), []);
  assert.ok(has(used({ value: 1, how: 'guess' }), 'tokens_on_use.how'));
  assert.ok(has(used(5), 'tokens_on_use'));

  assert.deepEqual(validateEntry(put(b0, 'tokens_always_on', 'cost_note', 'About $1.80 per page.'), ids), []);
  assert.deepEqual(validateEntry(put(put(b0, 'tokens_always_on', 'tokens_on_use', { value: 0, how: 'estimated chars/2.6' }), 'tokens_on_use', 'cost_note', 'A note.'), ids), []);
  assert.ok(has(validateEntry(put(b0, 'tokens_always_on', 'cost_note', 'x'.repeat(121)), ids), 'cost_note'));

  for (const [id, e] of loadCatalog(repo)) {
    if (id === 'sync-engine') {
      for (const k of NEW) assert.ok(!(k in e), `sync-engine must not have ${k}: older sync tools reject unknown keys and must still read this entry`);
      continue;
    }
    assert.ok(typeof e.solves === 'string' && e.solves.length > 0, `${id} has no solves`);
    assert.ok(Array.isArray(e.use_cases) && e.use_cases.length > 0, `${id} has no use_cases`);
    assert.ok(e.tokens_on_use && 'value' in e.tokens_on_use, `${id} has no tokens_on_use`);
  }
});
