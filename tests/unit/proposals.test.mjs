import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, loadProposals, validateProposal, pending } from '../../sync/lib/proposals.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fm = (lines, body = '') => `---\n${lines.join('\n')}\n---\n${body}`;
const meta = (lines) => parseFrontmatter(fm(lines)).meta;

test('parser: scalars, lists, comments, quotes', () => {
  const m = meta([
    '# a comment line',
    'a: plain text   # trailing comment',
    'b: "quoted # not a comment"',
    "c: 'it''s'",
    'd: [x, y, "z, w"]  # list',
    'e: []',
    'f:',
    '  - one',
    '  - two # c',
    '  - "three"',
    'g: true',
    'h: 42',
    'tokens_always_on: 240',
    "i: don't",
  ]);
  assert.deepEqual(m, {
    a: 'plain text', b: 'quoted # not a comment', c: "it's", d: ['x', 'y', 'z, w'], e: [], f: ['one', 'two', 'three'],
    g: true, h: '42', tokens_always_on: 240, i: "don't",
  });
  assert.equal(meta(['tokens_always_on: "+240"']).tokens_always_on, '+240');
  assert.equal(meta(['tokens_always_on: +240']).tokens_always_on, '+240');
  assert.equal(meta(['tokens_always_on: -80']).tokens_always_on, -80);
});

test('parser: body and CRLF', () => {
  const r = parseFrontmatter('---\r\nid: a\r\n---\r\n\r\n## Why\r\nx\r\n');
  assert.deepEqual(r.meta, { id: 'a' });
  assert.equal(r.body, '## Why\nx\n');
});

test('parser: errors', () => {
  const bad = (text, re) => assert.throws(() => parseFrontmatter(text), re);
  bad('id: a', /start with ---/);
  bad('---\nid: a\n', /not closed/);
  bad('---\nmap:\n  inner: 1\n---\n', /nested maps/);
  bad('---\n  stray: 1\n---\n', /nested maps/);
  bad('---\na: 1\na: 2\n---\n', /duplicate key/);
  bad('---\na: {x: 1}\n---\n', /inline maps/);
  bad('---\na: [x, [y]]\n---\n', /nested structures/);
  bad('---\na: [x, y\n---\n', /unterminated list/);
  bad('---\na: "x\n---\n', /unterminated|bad double/);
  bad('---\na: |\n---\n', /unsupported/);
  bad('---\njust text\n---\n', /expected "key: value"/);
  bad('---\nA: 1\n---\n', /bad key/);
  bad('---\na:b\n---\n', /expected "key: value"/);
  bad('---\nl:\n  - [x]\n---\n', /nested structures/);
});

const catalogIds = new Set(['away-mode', 'status-line']);
const goodMeta = () => ({
  id: 'p1', title: 'T', kind: 'change', level: 'optional', part: 'away-mode', touches: ['hooks/a.js'],
  tokens_always_on: '+240', quality: 'tried', risk: 'r', undo: 'u',
});
const prop = (m = goodMeta(), body = '## What changes\nx\n\n## Why\ny\n') => ({ id: m.id, file: `${m.id}.md`, meta: m, body });
const has = (errs, text) => errs.some((e) => e.includes(text));

test('validateProposal: good and bad', () => {
  assert.deepEqual(validateProposal(prop(), catalogIds), []);
  assert.deepEqual(validateProposal(prop({ ...goodMeta(), part: 'new:cool-thing', needs: ['windows', 'part:x'], after: ['p0'], settings: ['/env/X'], runs_code: true, ask_alone: false, tokens_how: 'h', tokens_always_on: 12 }), catalogIds), []);
  const bad = (patch, text) => assert.ok(has(validateProposal(prop({ ...goodMeta(), ...patch }), catalogIds), text), text + ' for ' + JSON.stringify(patch));
  bad({ kind: 'x' }, 'kind');
  bad({ level: 'x' }, 'level');
  bad({ part: 'nope' }, 'not a catalog id');
  bad({ part: 'new:Bad' }, 'new:<id>');
  bad({ touches: [] }, 'touches');
  bad({ touches: 'a' }, 'touches');
  bad({ tokens_always_on: '240' }, 'tokens_always_on');
  bad({ quality: 'x' }, 'quality');
  bad({ needs: ['linux'] }, 'needs[0]');
  bad({ after: ['Bad Id'] }, 'after[0]');
  bad({ runs_code: 'yes' }, 'runs_code');
  bad({ extra: 1 }, 'unknown field');
  assert.ok(has(validateProposal({ ...prop(), file: 'other.md' }, catalogIds), 'must equal the file name'));
  const m = goodMeta();
  delete m.undo;
  assert.ok(has(validateProposal(prop(m), catalogIds), 'missing field: undo'));
  assert.ok(has(validateProposal(prop(goodMeta(), '## Why\ny'), catalogIds), 'What changes'));
  assert.ok(has(validateProposal(prop(goodMeta(), `## What changes\na${String.fromCharCode(0x2014)}b\n## Why\ny`), catalogIds), 'dash'));
});

test('loadProposals: sorted, skips TEMPLATE.md, errors name the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-prop-'));
  try {
    assert.deepEqual(loadProposals(dir), []);
    fs.mkdirSync(path.join(dir, 'proposals'));
    const w = (f, t) => fs.writeFileSync(path.join(dir, 'proposals', f), t);
    w('TEMPLATE.md', '---\nid: tpl\n---\n');
    w('b.md', fm(['id: b']));
    w('a.md', fm(['id: a'], 'body'));
    const l = loadProposals(dir);
    assert.deepEqual(l.map((p) => [p.id, p.file, p.body]), [['a', 'a.md', 'body'], ['b', 'b.md', '']]);
    w('c.md', 'no frontmatter');
    assert.throws(() => loadProposals(dir), /proposals\/c\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real TEMPLATE.md parses and validates', () => {
  const t = parseFrontmatter(fs.readFileSync(path.join(repo, 'proposals', 'TEMPLATE.md'), 'utf8'));
  assert.deepEqual(validateProposal({ file: 'example-change.md', meta: t.meta, body: t.body }, new Set(['away-mode'])), []);
  for (const h of ['What changes', 'Why', 'How it affects the agent', 'Undo']) assert.ok(t.body.includes(`## ${h}`), h);
});

const mk = (id, extra = {}) => ({ id, meta: { ...extra } });
const ctxOf = (map) => ({ check: (n) => (n in map ? map[n] : true) });

test('pending: answers', () => {
  const props = [mk('a'), mk('b'), mk('c'), mk('d'), mk('e'), mk('f')];
  const state = { answers: { a: { answer: 'accept' }, b: { answer: 'skip' }, c: { answer: 'later' }, d: { answer: 'rolled-back' }, e: { answer: 'baseline' } }, parts: {} };
  const r = pending(state, props, ctxOf({}));
  assert.deepEqual(r.pending.map((p) => p.id), ['c', 'd', 'f']);
  assert.deepEqual(r.hidden, { answered: 3, needs: 0, after: 0 });
});

test('pending: needs hide, unknown passes and is flagged', () => {
  const props = [mk('a', { needs: ['windows', 'cmd:x'] }), mk('b', { needs: ['fable-access'] }), mk('c', { needs: ['plugin:z'] })];
  const r = pending({ answers: {}, parts: {} }, props, ctxOf({ 'cmd:x': false, 'fable-access': 'unknown' }));
  assert.deepEqual(r.pending.map((p) => p.id), ['b', 'c']);
  assert.equal(r.hidden.needs, 1);
  assert.deepEqual(r.unknown, { b: ['fable-access'] });
});

test('pending: after needs accepted proposal or installed part', () => {
  const props = [mk('a', { after: ['p1'] }), mk('b', { after: ['p2'] }), mk('c', { after: ['p1', 'part-x'] }), mk('d', { after: ['p3'] })];
  const state = { answers: { p1: { answer: 'accept' }, p2: { answer: 'skip' } }, parts: { 'part-x': { installed: true } } };
  const r = pending(state, props, ctxOf({}));
  assert.deepEqual(r.pending.map((p) => p.id), ['a', 'c']);
  assert.equal(r.hidden.after, 2);
});
