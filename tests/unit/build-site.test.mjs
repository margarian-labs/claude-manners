import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { footprint, validateStory, model, render, partsHtml, startsHtml, flagsHtml, momentsHtml } from '../../owner/build-site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-site-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const part = (over = {}) => ({
  id: 'p1', title: 'A <b> & "c"', group: 'rules', level: 'recommended', use: 'you', trigger: 'Say <go> & "now"',
  summary: 'sum', solves: 'x < y', benefit: 'b & c', use_cases: ['case "1" <i>'], affects: 'aff', cost: 'cost', needs: '',
  tokens_always_on: 12, tokens_on_use: null, ...over,
});

test('generated html escapes <, & and "', () => {
  const parts = partsHtml([part()]);
  assert.ok(parts.includes('A &lt;b&gt; &amp; &quot;c&quot;'));
  assert.ok(parts.includes('Say &lt;go&gt; &amp; &quot;now&quot;'));
  assert.ok(parts.includes('case &quot;1&quot; &lt;i&gt;'));
  assert.ok(!parts.includes('<b>') && !parts.includes('<go>'));
  const starts = startsHtml([part()]);
  assert.ok(starts.includes('A &lt;b&gt; &amp; &quot;c&quot;') && starts.includes('Say &lt;go&gt;') && !starts.includes('<i>'));
  const flags = flagsHtml([{ flag: '-x"', does: 'a <b> & c' }]);
  assert.ok(flags.includes('data-flag="-x&quot;"') && flags.includes('a &lt;b&gt; &amp; c'));
  const moments = momentsHtml([{ id: 'm', event: null, title: '<t>', what: '& "w"', actor: 'you', parts: [{ id: 'p1', title: 'T & <>', does: '"d"' }] }]);
  assert.ok(moments.includes('&lt;t&gt;') && moments.includes('&amp; &quot;w&quot;') && moments.includes('T &amp; &lt;&gt;') && moments.includes('&quot;d&quot;'));
  assert.ok(moments.includes('data-event=""'));
});

test('a part without a trigger has no start line and unmeasured tokens say so', () => {
  const html = partsHtml([part({ use: 'auto', trigger: '', tokens_always_on: null })]);
  assert.ok(!html.includes('You start it by'));
  assert.ok(html.includes('not measured'));
  assert.ok(partsHtml([part()]).includes('<dt>You start it by</dt>'));
  assert.ok(partsHtml([part()]).includes('12 tokens'));
});

test('footprint counts files, settings keys and skill references', () => {
  const dir = makeRepo({
    'src/folder/a.md': 'a', 'src/folder/sub/b.md': 'b', 'src/one.txt': '1',
    'src/skill/SKILL.md': 's', 'src/skill/extra.md': 'e', 'src/bare/SKILL.md': 's',
    'set/x.json': JSON.stringify({ hooks: {}, statusLine: {} }), 'set/y.json': JSON.stringify({ hooks: {}, env: {} }),
  });
  const byId = new Map();
  assert.equal(footprint(dir, { files: [{ src: 'src/folder', dest: 'tools/f' }] }, byId).files, 2);
  assert.equal(footprint(dir, { files: [{ src: 'src/one.txt', dest: 'tools/one.txt' }] }, byId).files, 1);
  assert.deepEqual(footprint(dir, { settings: ['set/x.json', 'set/y.json'] }, byId).settings, ['hooks', 'statusLine', 'env']);
  assert.equal(footprint(dir, { files: [{ src: 'src/skill', dest: 'skills/s' }] }, byId).references, true);
  assert.equal(footprint(dir, { files: [{ src: 'src/bare', dest: 'skills/b' }] }, byId).references, false);
  assert.equal(footprint(dir, { files: [{ src: 'src/folder', dest: 'tools/f' }] }, byId).references, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

const MOMENTS = [['every-session', null], ['session-start', 'SessionStart'], ['prompt', 'UserPromptSubmit'], ['skill-fits', null],
  ['tool-call', 'PreToolUse'], ['permission', 'PermissionRequest'], ['notification', 'Notification'], ['compaction', 'PreCompact'], ['stop', 'Stop']];
const PARTS = { 'every-session': ['c'], 'skill-fits': ['c'], 'session-start': ['a'], stop: ['a', 'b'] };
const goodStory = () => ({ moments: MOMENTS.map(([id, event]) => ({ id, event, title: 'T', what: 'W', actor: 'setup', parts: (PARTS[id] ?? []).map((p) => ({ id: p, does: 'D' })) })) });

test('validateStory accepts a correct story and names each mistake', () => {
  const dir = makeRepo({
    's/a.json': JSON.stringify({ hooks: { SessionStart: [], Stop: [] } }),
    's/b.json': JSON.stringify({ hooks: { Stop: [] } }),
  });
  const entries = [{ id: 'a', settings: ['s/a.json'] }, { id: 'b', settings: ['s/b.json'] }, { id: 'c' }];
  const check = (change) => { const s = goodStory(); change(s.moments); return validateStory(dir, s, entries); };
  const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), errs.join('\n'));
  assert.deepEqual(validateStory(dir, goodStory(), entries), []);
  has(check((m) => { m[8].parts.pop(); }), /stop: missing parts with a Stop hook: b/);
  has(check((m) => { m[1].parts.push({ id: 'b', does: 'D' }); }), /session-start: parts without a SessionStart hook: b/);
  has(check((m) => { [m[0], m[1]] = [m[1], m[0]]; }), /in that order/);
  has(check((m) => { m[0].parts[0].does = 'x'.repeat(111); }), /every-session: c does must be/);
  has(check((m) => { m[3].parts.push({ id: 'zzz', does: 'D' }); }), /skill-fits: unknown part zzz/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('model on the real repo: one part per catalog file, unique ids, consistent stats', async () => {
  const ids = fs.readdirSync(path.join(ROOT, 'catalog')).filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', n), 'utf8')).id).filter((id) => id !== 'sync-engine');
  const m = await model(ROOT);
  assert.deepEqual(m.parts.map((p) => p.id).sort(), ids.sort());
  assert.equal(new Set(m.parts.map((p) => p.id)).size, m.parts.length);
  assert.ok(m.flags.length >= 8);
  assert.equal(m.stats.parts, m.parts.length);
  assert.equal(m.stats.auto + m.stats.you, m.stats.parts);
  const html = partsHtml(m.parts);
  for (const p of m.parts) assert.equal(html.split(`id="part-${p.id}"`).length, 2, p.id);
});

test('render on the real repo is deterministic and has no carriage returns', async () => {
  const a = await render(ROOT);
  assert.equal(await render(ROOT), a);
  assert.ok(!a.includes('\r'));
});
