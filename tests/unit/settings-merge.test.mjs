import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMerge, applyOps, revert, pruneSkillOverrides } from '../../sync/lib/settings-merge.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fragDir = path.join(repo, 'payload', 'settings', 'fragments');
const snippetFile = path.join(repo, 'payload', 'two-accounts', 'settings-snippet.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const fragments = [
  ...fs.readdirSync(fragDir).filter((f) => f.endsWith('.json')).sort().map((f) => [f, readJson(path.join(fragDir, f))]),
  ['settings-snippet.json', readJson(snippetFile)],
];
const fragment = (name) => fragments.find(([n]) => n === name)[1];

let root;
let saved;
before(() => {
  saved = ['CLAUDE_CONFIG_DIR', 'CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT'].map((k) => [k, process.env[k]]);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-merge-'));
  process.env.CLAUDE_CONFIG_DIR = root;
  process.env.CLAUDE_SETUP_TEST = '1';
  process.env.CLAUDE_SETUP_TEST_ROOT = root;
});
after(() => {
  for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(root, { recursive: true, force: true });
});

let n = 0;
const newFile = (obj) => {
  const dir = path.join(root, `t${++n}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'settings.json');
  if (obj !== undefined) fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  return file;
};
const read = (f) => readJson(f);
const run = (file, frag, { acceptAll = false } = {}) => {
  const settings = fs.existsSync(file) ? read(file) : {};
  const ops = planMerge(settings, frag);
  const accept = acceptAll ? ops.filter((o) => o.op === 'conflict').map((o) => o.pointer) : [];
  return { ops, ...applyOps(file, ops, { accept }) };
};
const kinds = (ops) => ops.map((o) => o.op);
const base = () => ({
  model: 'sonnet',
  theme: 'dark',
  tui: 'default',
  cleanupPeriodDays: 30,
  env: { FOO: '1', MY_DIR: 'C:\\Users\\bob\\.claude', PYTHONUTF8: '0' },
  permissions: { allow: ['Bash(git status)', 'Read(C:\\Users\\bob\\**)'], deny: ['Bash(rm -rf *)'], defaultMode: 'default' },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'C:\\tools\\guard.cmd' }] }],
    UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'node C:\\tools\\prompt.js', timeout: 3 }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
  },
  skillOverrides: { foo: 'off' },
  statusLine: { type: 'command', command: 'powershell -File C:\\x.ps1' },
  modelSettings: { 'claude-opus-5-5': { effortLevel: 'low' } },
});

test('add into a missing file', () => {
  const file = newFile();
  const frag = fragment('env-basics.json');
  const { ops, written, skipped } = run(file, frag);
  assert.deepEqual(kinds(ops), ['add', 'add']);
  assert.deepEqual(read(file), frag);
  assert.equal(written.length, 2);
  assert.deepEqual(written[0], { pointer: '/env/PYTHONUTF8', value: '1', prev: { $absent: true }, created: ['/env'] });
  assert.deepEqual(written[1], { pointer: '/env/CLAUDE_CODE_DISABLE_CRON', value: '1', prev: { $absent: true } });
  assert.deepEqual(skipped, []);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.includes('\n  "env": {\n    "PYTHONUTF8"'));
});

test('keep on equal, nothing written', () => {
  const file = newFile({ tui: 'fullscreen', other: 1 });
  const before = fs.readFileSync(file, 'utf8');
  const { ops, written } = run(file, fragment('fullscreen.json'));
  assert.deepEqual(kinds(ops), ['keep']);
  assert.deepEqual(written, []);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('conflict is skipped unless accepted, prev recorded', () => {
  const file = newFile({ tui: 'default' });
  const first = run(file, fragment('fullscreen.json'));
  assert.deepEqual(kinds(first.ops), ['conflict']);
  assert.deepEqual(first.ops[0], { op: 'conflict', pointer: '/tui', value: 'fullscreen', prev: 'default' });
  assert.deepEqual(first.skipped, ['/tui']);
  assert.deepEqual(first.written, []);
  assert.equal(read(file).tui, 'default');
  const second = run(file, fragment('fullscreen.json'), { acceptAll: true });
  assert.deepEqual(second.written, [{ pointer: '/tui', value: 'fullscreen', prev: 'default' }]);
  assert.equal(read(file).tui, 'fullscreen');
});

test('nested env merge keeps user keys and mixes add, keep, conflict', () => {
  const file = newFile({ env: { FOO: '1', PYTHONUTF8: '1', CLAUDE_CODE_DISABLE_CRON: '0' } });
  const { ops, written, skipped } = run(file, { env: { PYTHONUTF8: '1', CLAUDE_CODE_DISABLE_CRON: '1', NEW: 'x' } });
  assert.deepEqual(kinds(ops), ['keep', 'conflict', 'add']);
  assert.deepEqual(skipped, ['/env/CLAUDE_CODE_DISABLE_CRON']);
  assert.deepEqual(written.map((w) => w.pointer), ['/env/NEW']);
  assert.deepEqual(read(file).env, { FOO: '1', PYTHONUTF8: '1', CLAUDE_CODE_DISABLE_CRON: '0', NEW: 'x' });
});

test('type mismatch is a conflict, not a crash', () => {
  const file = newFile({ env: 'oops' });
  const { ops, skipped } = run(file, { env: { A: '1' } });
  assert.deepEqual(kinds(ops), ['conflict']);
  assert.equal(ops[0].pointer, '/env');
  assert.deepEqual(skipped, ['/env']);
});

test('hooks: add to an existing matcher group without duplicating a command', () => {
  const file = newFile(base());
  const frag = { hooks: { UserPromptSubmit: [{ matcher: '', hooks: [
    { type: 'command', command: 'node C:\\tools\\prompt.js' },
    { type: 'command', command: '~/.claude/hooks/away-mode.sh', timeout: 10 },
  ] }] } };
  const { ops, written } = run(file, frag);
  assert.deepEqual(kinds(ops), ['keep', 'add']);
  assert.equal(ops[1].pointer, '/hooks/UserPromptSubmit/0/hooks/-');
  assert.deepEqual(ops[1].match, { matcher: '', command: '~/.claude/hooks/away-mode.sh' });
  assert.deepEqual(written, [{
    pointer: '/hooks/UserPromptSubmit/0/hooks/1',
    value: { type: 'command', command: '~/.claude/hooks/away-mode.sh', timeout: 10 },
    prev: { $absent: true },
    match: { matcher: '', command: '~/.claude/hooks/away-mode.sh' },
  }]);
  const groups = read(file).hooks.UserPromptSubmit;
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].hooks.map((h) => h.command), ['node C:\\tools\\prompt.js', '~/.claude/hooks/away-mode.sh']);
});

test('hooks: a group without matcher matches matcher ""', () => {
  const file = newFile(base());
  const { ops } = run(file, fragment('hooks-away.json'));
  const stop = ops.find((o) => o.pointer.startsWith('/hooks/Stop'));
  assert.equal(stop.op, 'add');
  assert.equal(stop.pointer, '/hooks/Stop/0/hooks/-');
  assert.equal(read(file).hooks.Stop.length, 1);
  assert.equal(read(file).hooks.Stop[0].hooks.length, 2);
});

test('hooks: new group for a new matcher, new event, existing no-matcher group reused', () => {
  const file = newFile(base());
  const { ops, written } = run(file, fragment('hooks-telegram.json'));
  assert.deepEqual(kinds(ops), ['add', 'add', 'add']);
  assert.equal(ops[2].pointer, '/hooks/PreToolUse/-');
  assert.deepEqual(ops[2].match, { matcher: 'AskUserQuestion' });
  const s = read(file);
  assert.equal(s.hooks.Stop.length, 1);
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.equal(s.hooks.PreToolUse[1].matcher, 'AskUserQuestion');
  assert.equal(s.hooks.Notification.length, 1);
  assert.deepEqual(written.map((w) => w.pointer), ['/hooks/Notification/0/hooks/0', '/hooks/Stop/0/hooks/1', '/hooks/PreToolUse/1/hooks/0']);
});

test('hooks: same command under another matcher is not a duplicate', () => {
  const file = newFile({ hooks: { Stop: [{ matcher: 'x', hooks: [{ type: 'command', command: 'a.sh' }] }] } });
  const { ops } = run(file, { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'a.sh' }] }] } });
  assert.deepEqual(kinds(ops), ['add']);
  assert.equal(read(file).hooks.Stop.length, 2);
});

test('second apply of every fragment is all keep and writes nothing', () => {
  for (const [name, frag] of fragments) {
    const file = newFile(base());
    run(file, frag, { acceptAll: true });
    const text = fs.readFileSync(file, 'utf8');
    const again = run(file, frag);
    assert.ok(again.ops.every((o) => o.op === 'keep'), name);
    assert.deepEqual(again.written, [], name);
    assert.equal(fs.readFileSync(file, 'utf8'), text, name);
  }
});

test('revert after apply returns the exact original, for every fragment', () => {
  for (const [name, frag] of fragments) {
    for (const start of [base(), {}]) {
      const file = newFile(start);
      const { written } = run(file, frag, { acceptAll: true });
      assert.ok(written.length > 0, name);
      const entries = JSON.parse(JSON.stringify(written));
      const result = revert(file, entries);
      assert.deepEqual(result.conflicts, [], name);
      assert.deepEqual(result.reverted, [...written.map((w) => w.pointer)].reverse(), name);
      assert.deepEqual(read(file), start, name);
    }
  }
});

const dropEmpty = (v) => {
  if (Array.isArray(v)) return v.map(dropEmpty);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dropEmpty(x)]).filter(([, x]) => !(x && typeof x === 'object' && !Object.keys(x).length)));
};

test('all fragments applied: reverse revert is exact; same-order revert never loses data', () => {
  const start = base();
  const file = newFile(start);
  const perFragment = fragments.map(([, frag]) => run(file, frag, { acceptAll: true }).written);
  assert.notDeepEqual(read(file), start);
  const snapshot = fs.readFileSync(file, 'utf8');
  for (const entries of [...perFragment].reverse()) assert.deepEqual(revert(file, entries).conflicts, []);
  assert.deepEqual(read(file), start);

  fs.writeFileSync(file, snapshot);
  for (const entries of perFragment) assert.deepEqual(revert(file, entries).conflicts, []);
  // a container created by one entry but shared with later ones is only pruned by the entry that owns it
  assert.deepEqual(dropEmpty(read(file)), start);
  assert.deepEqual(read(file).hooks.SessionStart, []);
});

test('revert prunes only containers sync created: env, hook group, hook event, hooks', () => {
  const env = { env: { X: '1' } };
  const stopFrag = { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'a.sh' }] }] } };
  const cases = [
    ['env empty before', { env: {} }, env, undefined],
    ['env absent before', { z: 1 }, env, ['/env']],
    ['hooks present but empty', { hooks: {} }, stopFrag, ['/hooks/Stop', '/hooks/Stop/0']],
    ['hooks absent', { z: 1 }, stopFrag, ['/hooks', '/hooks/Stop', '/hooks/Stop/0']],
    ['event array empty before', { hooks: { Stop: [] } }, stopFrag, ['/hooks/Stop/0']],
    ['event absent, hooks has others', { hooks: { Notification: [] } }, stopFrag, ['/hooks/Stop', '/hooks/Stop/0']],
    ['group exists with empty hooks', { hooks: { Stop: [{ matcher: '', hooks: [] }] } }, stopFrag, undefined],
  ];
  for (const [name, start, frag, created] of cases) {
    const file = newFile(start);
    const { written } = run(file, frag);
    assert.equal(written.length, 1, name);
    assert.deepEqual(written[0].created, created, name);
    const result = revert(file, JSON.parse(JSON.stringify(written)));
    assert.deepEqual(result.conflicts, [], name);
    assert.deepEqual(read(file), start, name);
  }
});

test('entries without created never prune', () => {
  const stopFrag = { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'a.sh' }] }] } };
  const cases = [[{ env: { X: '1' } }, { env: {} }], [stopFrag, { hooks: { Stop: [{ matcher: '', hooks: [] }] } }]];
  for (const [frag, left] of cases) {
    const file = newFile({});
    const { written } = run(file, frag);
    assert.ok(written[0].created);
    const old = written.map(({ created, ...rest }) => rest);
    assert.deepEqual(revert(file, old).conflicts, []);
    assert.deepEqual(read(file), left);
  }
});

test('a created container the user filled meanwhile is not pruned', () => {
  const file = newFile({});
  const { written } = run(file, { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'a.sh' }] }] } });
  const s = read(file);
  s.hooks.Stop[0].hooks.push({ type: 'command', command: 'mine.sh' });
  fs.writeFileSync(file, JSON.stringify(s));
  assert.deepEqual(revert(file, written).conflicts, []);
  assert.deepEqual(read(file), { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'mine.sh' }] }] } });
});

test('revert with a changed value is a conflict and leaves it untouched', () => {
  const file = newFile({ other: true });
  const { written } = run(file, fragment('env-basics.json'));
  const s = read(file);
  s.env.PYTHONUTF8 = '0';
  fs.writeFileSync(file, JSON.stringify(s));
  const result = revert(file, written);
  assert.deepEqual(result.conflicts, [{ pointer: '/env/PYTHONUTF8', expected: '1', actual: '0' }]);
  assert.deepEqual(result.reverted, ['/env/CLAUDE_CODE_DISABLE_CRON']);
  assert.deepEqual(read(file), { other: true, env: { PYTHONUTF8: '0' } });
});

test('revert of a changed hook is a conflict and leaves it untouched', () => {
  const file = newFile({});
  const { written } = run(file, fragment('hooks-session-namer.json'));
  const s = read(file);
  s.hooks.UserPromptSubmit[0].hooks[0].timeout = 99;
  fs.writeFileSync(file, JSON.stringify(s));
  const result = revert(file, written);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].actual.timeout, 99);
  assert.equal(read(file).hooks.UserPromptSubmit[0].hooks[0].timeout, 99);
});

test('revert keeps an unrelated key the user added later', () => {
  const file = newFile({ a: 1 });
  const { written } = run(file, fragment('env-basics.json'));
  const s = read(file);
  s.env.MINE = 'keep';
  s.extra = { x: 1 };
  fs.writeFileSync(file, JSON.stringify(s));
  const result = revert(file, written);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(read(file), { a: 1, env: { MINE: 'keep' }, extra: { x: 1 } });
});

test('revert of a hook finds it by match even when indexes shifted', () => {
  const file = newFile(base());
  const { written } = run(file, fragment('hooks-telegram.json'));
  const s = read(file);
  s.hooks.Stop.unshift({ matcher: 'zzz', hooks: [{ type: 'command', command: 'z.sh' }] });
  s.hooks.PreToolUse.unshift({ matcher: 'new', hooks: [{ type: 'command', command: 'n.sh' }] });
  fs.writeFileSync(file, JSON.stringify(s));
  const result = revert(file, written);
  assert.deepEqual(result.conflicts, []);
  const expected = base();
  expected.hooks.Stop.unshift({ matcher: 'zzz', hooks: [{ type: 'command', command: 'z.sh' }] });
  expected.hooks.PreToolUse.unshift({ matcher: 'new', hooks: [{ type: 'command', command: 'n.sh' }] });
  assert.deepEqual(read(file), expected);
});

test('revert twice is harmless', () => {
  const start = base();
  const file = newFile(start);
  const { written } = run(file, fragment('hooks-away.json'), { acceptAll: true });
  assert.deepEqual(revert(file, written).conflicts, []);
  const again = revert(file, written);
  assert.deepEqual(again.conflicts, []);
  assert.deepEqual(read(file), start);
});

test('revert on a missing file does not create it', () => {
  const file = newFile();
  const result = revert(file, [{ pointer: '/tui', value: 'fullscreen', prev: 'default' }]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(fs.existsSync(file), false);
});

test('Windows path strings survive apply and revert', () => {
  const winPath = 'C:\\Users\\bob smith\\.claude\\hooks\\a.cmd';
  const frag = { env: { CFG: winPath }, hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: `"${winPath}" --x` }] }] } };
  const file = newFile({ env: { OLD: 'D:\\data\\x' } });
  const { written } = run(file, frag);
  const s = read(file);
  assert.equal(s.env.CFG, winPath);
  assert.equal(s.hooks.Stop[0].hooks[0].command, `"${winPath}" --x`);
  assert.equal(s.env.OLD, 'D:\\data\\x');
  revert(file, written);
  assert.deepEqual(read(file), { env: { OLD: 'D:\\data\\x' } });
});

test('pointers escape / and ~ in keys', () => {
  const file = newFile({});
  const { ops, written } = run(file, { env: { 'A/B': '1', 'C~D': '2' } });
  assert.deepEqual(ops.map((o) => o.pointer), ['/env/A~1B', '/env/C~0D']);
  assert.deepEqual(read(file), { env: { 'A/B': '1', 'C~D': '2' } });
  assert.deepEqual(revert(file, written).conflicts, []);
  assert.deepEqual(read(file), {});
});

test('atomic write leaves no temp file, also after revert', () => {
  const file = newFile({ a: 1 });
  const dir = path.dirname(file);
  const { written } = run(file, fragment('hooks-away.json'));
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  revert(file, written);
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('invalid JSON throws and the file is untouched', () => {
  const file = newFile();
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => applyOps(file, planMerge({}, fragment('fullscreen.json'))), /invalid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('a UTF-8 BOM in the settings file is tolerated', () => {
  const file = newFile();
  fs.writeFileSync(file, '\uFEFF{"a":1}');
  applyOps(file, planMerge({ a: 1 }, fragment('fullscreen.json')));
  assert.equal(fs.readFileSync(file, 'utf8').charCodeAt(0), 0x7b);
  assert.deepEqual(read(file), { a: 1, tui: 'fullscreen' });
});

test('plan does not mutate its inputs, ops do not alias the fragment', () => {
  const settings = base();
  const frag = fragment('hooks-away.json');
  const s0 = JSON.stringify(settings);
  const f0 = JSON.stringify(frag);
  const ops = planMerge(settings, frag);
  ops.find((o) => o.op === 'add' && o.pointer === '/env/CLAUDE_CODE_RETRY_WATCHDOG').value = 'changed';
  ops.find((o) => o.match && o.op === 'add').value.command = 'changed';
  assert.equal(JSON.stringify(settings), s0);
  assert.equal(JSON.stringify(frag), f0);
});

test('pruneSkillOverrides keeps only installed skills', () => {
  const frag = fragment('skill-overrides.json');
  const before = Object.keys(frag.skillOverrides).length;
  const out = pruneSkillOverrides(frag, new Set(['architecture', 'sprint-planning', 'not-in-fragment']));
  assert.deepEqual(out, { skillOverrides: { architecture: 'off', 'sprint-planning': 'off' } });
  assert.equal(Object.keys(frag.skillOverrides).length, before);
  assert.deepEqual(pruneSkillOverrides(frag, new Set()), {});
  assert.deepEqual(pruneSkillOverrides({ tui: 'x' }, new Set()), { tui: 'x' });
});
