import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, unifiedDiff, riskyPointers } from '../../sync/lib/display.mjs';

const CFG = 'C:/Users/test/.claude';
const prop = (over = {}) => ({
  id: 'p1',
  meta: {
    id: 'p1', title: 'Better hook', kind: 'change', level: 'optional', part: 'away-mode', touches: ['hooks/a.js'],
    tokens_always_on: '+240', tokens_how: 'estimated chars/2.6', quality: 'tried', risk: 'Runs on every prompt; no network.', undo: 'u', ...over,
  },
  body: '## What changes\nThe hook gets smarter.\n\n## Why\nIt misses cases.\n\n## Undo\nRoll back.\n',
});
const file = (dest, bytes, action) => ({ kind: 'file', dest, bytes, action });
const set = (op, pointer, value, prev) => ({ kind: 'settings', op, pointer, value, prev });
const run = (p, plan, installed = {}) => card(p, plan, installed, { configDir: CFG });
const warnings = (text) => (text.split('Warnings\n')[1] || '').split('\n').filter(Boolean);

test('diff snapshot', () => {
  const oldT = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\n';
  const newT = 'l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\n';
  const d = unifiedDiff(oldT, newT, 'hooks/a.js');
  assert.equal(d.text, [
    '--- a/hooks/a.js',
    '+++ b/hooks/a.js',
    '@@ -1,5 +1,5 @@',
    ' l1',
    '-l2',
    '+L2',
    ' l3',
    ' l4',
    ' l5',
    '@@ -10,3 +10,4 @@',
    ' l10',
    ' l11',
    ' l12',
    '+l13',
  ].join('\n'));
  assert.deepEqual(d.added, ['L2', 'l13']);
});

test('diff: new file, removed file, no change, CRLF ignored, cap', () => {
  assert.equal(unifiedDiff('', 'a\nb\n', 'x', { oldMissing: true }).text, '--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b');
  assert.equal(unifiedDiff('a\nb\n', '', 'x', { newMissing: true }).text, '--- a/x\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b');
  assert.equal(unifiedDiff('a\r\nb\r\n', 'a\nb\n', 'x').changed, false);
  const big = Array.from({ length: 300 }, (_, i) => 'n' + i).join('\n');
  const t = unifiedDiff('', big, 'x', { oldMissing: true }).text.split('\n');
  assert.equal(t.length, 2 + 200 + 1);
  assert.equal(t[t.length - 1], '... 101 more lines');
});

test('card layout: sections, diff against installed, settings lines', () => {
  const text = run(prop(), {
    ops: [
      file('hooks/a.js', 'one\ntwo\n'),
      set('add', '/env/X', 'v'),
      set('change', '/model', 'new', 'old'),
      set('conflict', '/x', 2, 1),
      set('keep', '/y', 3, 3),
    ],
  }, { 'hooks/a.js': 'one\nOLD\n' });
  for (const part of [
    'Better hook\n', 'Level: optional | Kind: change | Part: away-mode', 'What changes\nThe hook gets smarter.', 'Why\nIt misses cases.',
    'Tokens always on: +240 (how: estimated chars/2.6)', 'Quality: tried', 'Changes: Runs on every prompt; no network.', 'Files and settings\n',
    '* hooks/a.js (changed)', '-OLD', '+two', '  + /env/X = "v"', '  ~ /model: "old" -> "new"', '  ~ conflict /x: 1 -> 2', '  = /y (already set)',
  ]) assert.ok(text.includes(part), part + '\n' + text);
  assert.ok(!text.includes('How it'));
  assert.ok(text.indexOf('Why\n') < text.indexOf('What changes\n'), 'the advantage comes first');
  assert.doesNotMatch(text, /risk/i);
  assert.ok(!/\u001b/.test(text));
});

test('card: new and removed files', () => {
  const text = run(prop({ touches: ['hooks/a.js', 'hooks/b.js'] }), { ops: [file('hooks/a.js', 'x\n'), file('hooks/b.js', null, 'remove')] }, { 'hooks/b.js': 'gone\n' });
  assert.ok(text.includes('* hooks/a.js (new file)') && text.includes('--- /dev/null'));
  assert.ok(text.includes('* hooks/b.js (removed)') && text.includes('-gone'));
  assert.ok(!text.includes('Warnings'));
});

test('warning a: changed files not in touches', () => {
  const w = warnings(run(prop(), { ops: [file('hooks/a.js', 'x'), file('hooks/zzz.js', 'y'), set('add', '/model', 'm')] }));
  assert.deepEqual(w, [
    '! Plan changes hooks/zzz.js, which "touches" does not list.',
    '! Plan changes setting /model, which "touches" does not list.',
  ]);
  const ok = run(prop({ touches: ['hooks/', 'settings.json'] }), { ops: [file('hooks/zzz.js', 'y'), set('add', '/model', 'm')] });
  assert.ok(!ok.includes('Warnings'));
  assert.ok(!run(prop({ touches: ['/env'] }), { ops: [set('add', '/env/A', 1)] }).includes('does not list'));
});

test('warning b: risky settings pointers need typed confirmation', () => {
  const plan = { ops: [set('add', '/env/A', 1), set('add', '/permissions/allow', []), set('add', '/hooks/Stop', []), set('add', '/apiKeyHelper', 'x'), set('add', '/mcpServers/m', {}), set('add', '/model', 'x'), set('keep', '/env/K', 1)] };
  const p = prop({ touches: ['settings.json'] });
  const w = warnings(run(p, plan));
  assert.deepEqual(w, ['/env/A', '/permissions/allow', '/hooks/Stop', '/apiKeyHelper', '/mcpServers/m'].map((x) => `! ${x}: needs typed confirmation.`));
  assert.deepEqual(riskyPointers(plan), ['/env/A', '/permissions/allow', '/hooks/Stop', '/apiKeyHelper', '/mcpServers/m']);
  assert.deepEqual(riskyPointers({ ops: [{ kind: 'mcp', name: 'srv' }] }), ['/mcpServers/srv']);
});

test('warning c: code patterns not covered by risk text', () => {
  const code = [
    'const u = "https://example.com/x";',
    'import { spawn } from "node:child_process";',
    'curl -s foo',
    'schtasks /create',
    'const p = "C:/Other/thing";',
  ].join('\n');
  const w = warnings(run(prop({ risk: 'Runs on every prompt.' }), { ops: [file('hooks/a.js', code)] }));
  assert.deepEqual(w, [
    '! hooks/a.js does network access, which the Changes line does not mention.',
    '! hooks/a.js does process launching, which the Changes line does not mention.',
    '! hooks/a.js does downloading, which the Changes line does not mention.',
    '! hooks/a.js does a scheduled task, which the Changes line does not mention.',
    '! hooks/a.js uses a path outside the config folder (C:/Other/thing), which the Changes line does not mention.',
  ]);
});

test('warning c: silent when risk mentions it, inside config dir, shebang, unchanged lines, other extensions', () => {
  const risk = 'Sends data over the network, starts a child process, creates a scheduled task, writes outside the config folder.';
  const code = 'const u = "https://example.com";\nspawn("x");\nschtasks /create\nconst p = "C:/Other/x";';
  assert.ok(!run(prop({ risk }), { ops: [file('hooks/a.js', code)] }).includes('Warnings'));
  assert.ok(!run(prop(), { ops: [file('hooks/a.js', 'const p = "C:/Users/test/.claude/hooks";\n')] }).includes('Warnings'));
  assert.ok(!run(prop(), { ops: [file('hooks/a.js', '#!/usr/bin/env bash\necho hi\n')] }).includes('Warnings'));
  assert.ok(!run(prop(), { ops: [file('hooks/a.js', 'https://old.example\nnew\n')] }, { 'hooks/a.js': 'https://old.example\n' }).includes('Warnings'));
  assert.ok(!run(prop(), { ops: [file('hooks/a.js', 'x')] }, { 'hooks/a.js': 'x' }).includes('Warnings'));
  assert.ok(!run(prop({ touches: ['rules/a.md'] }), { ops: [file('rules/a.md', 'see https://example.com\n')] }).includes('Warnings'));
  for (const ext of ['sh', 'ps1', 'vbs', 'py', 'mjs']) {
    assert.ok(run(prop({ touches: [`t/a.${ext}`], risk: 'x' }), { ops: [file(`t/a.${ext}`, 'wget http://x\n')] }).includes('does network access'), ext);
  }
});

test('warning d: carried skipped proposals', () => {
  const w = warnings(run(prop(), { ops: [file('hooks/a.js', 'x')], carried: ['older-one', 'other'] }));
  assert.deepEqual(w, ['! This also brings skipped change older-one.', '! This also brings skipped change other.']);
});

test('card ends with one newline and never uses em or en dash', () => {
  const text = run(prop(), { ops: [file('hooks/a.js', 'x')] });
  assert.ok(text.endsWith('x\n') && !text.endsWith('\n\n'));
  assert.ok(!new RegExp('[' + String.fromCharCode(0x2014) + String.fromCharCode(0x2013) + ']').test(text));
});
