import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as merge from '../../sync/lib/settings-merge.mjs';
import { applyPlan, planPart } from '../../sync/lib/install.mjs';
import { git, headCommit } from '../../sync/lib/repo.mjs';
import { applyRollback, catalogAt, planRollback, planUndo } from '../../sync/lib/rollback.mjs';
import { emptyState, finishRun, findCrashedRun, load, newRun, runDirOf, save } from '../../sync/lib/state.mjs';
import { walk } from '../../sync/lib/fsx.mjs';

let root;
let cfg;
let repo;
let state;
let c1;
let c2;
let c3;
const HOME = 'C:\\Users\\some.one';
const saved = { ...process.env };

const raw = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const write = (rel, text, base = repo) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const entry = (id, extra) => ({
  id, title: id, group: 'tools', level: 'optional', summary: 's', needs: [], files: [], settings: [], rules: [], mcp: [], plugins: [], values: [],
  user_steps: [], machine_steps: [], verify: [], tokens_always_on: { value: null, how: 'not measured yet' }, quality: 'tried', risk: 'r', ask_alone: false, license: null, ...extra,
});
const putEntry = (e) => write(`catalog/${e.id}.json`, JSON.stringify(e, null, 2));
const commit = (msg, tag) => {
  git(['add', '-A'], repo);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], repo);
  git(['tag', tag], repo);
  return headCommit(repo);
};
const snap = (dir = cfg) => {
  const out = {};
  for (const rel of walk(dir)) if (!rel.startsWith('state/claude-manners/') && !rel.startsWith('backups/')) out[rel] = raw(path.join(dir, rel));
  return out;
};
const trackedCopy = (s) => JSON.parse(JSON.stringify({ repo: s.repo, parts: s.parts, answers: s.answers, files: s.files, settings: s.settings }));

const alpha = (v) => entry('alpha', {
  files: [
    { src: 'payload/hooks/alpha.js', dest: 'hooks/alpha.js', mode: 'rendered' },
    { src: 'payload/hooks/plain.sh', dest: 'hooks/plain.sh', mode: 'managed' },
    { src: 'payload/skills/s1', dest: 'skills/s1', mode: 'managed' },
    { src: 'payload/seed/seed.json', dest: 'tools/seed.json', mode: 'seed' },
    ...(v >= 2 ? [{ src: 'payload/hooks/new.js', dest: 'hooks/new.js', mode: 'managed' }] : []),
  ],
  rules: ['payload/rules/alpha.md', ...(v >= 2 ? ['payload/rules/extra.md'] : [])],
  settings: ['payload/settings/frag.json', ...(v >= 2 ? ['payload/settings/hook.json'] : [])],
  values: [
    { key: 'LABELS', file: 'hooks/alpha.js', ask: 'labels', default: '{}' },
    { key: 'who', file: 'rules/alpha.md', ask: 'who', default: 'World' },
  ],
});
const beta = entry('beta', {
  files: [{ src: 'payload/agents/ag.md', dest: 'agents/ag.md', mode: 'rendered' }],
  values: [{ key: 'agent_model', file: 'agents/ag.md', frontmatter: 'model', ask: 'model', default: 'fable' }],
});

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-roll-'));
  cfg = path.join(root, 'config');
  repo = path.join(root, 'repo');
  fs.mkdirSync(cfg);
  fs.mkdirSync(repo);
  Object.assign(process.env, {
    CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, CLAUDE_CONFIG_DIR: cfg,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  });
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'core.autocrlf', 'false'], repo);
  write('payload/hooks/alpha.js', 'const LABELS = {};\nmodule.exports = { LABELS };\n');
  write('payload/hooks/plain.sh', 'echo plain v1\n');
  write('payload/skills/s1/SKILL.md', 'skill v1\n');
  write('payload/skills/s1/ref/a.md', 'ref v1\n');
  write('payload/seed/seed.json', '{"seed":1}\n');
  write('payload/rules/alpha.md', 'Hello {{who}} v1\n');
  write('payload/settings/frag.json', JSON.stringify({ env: { A_KEY: '1', B_KEY: 'x' } }));
  write('payload/agents/ag.md', '---\nname: ag\nmodel: opus\n---\nbody v1\n');
  putEntry(alpha(1));
  putEntry(beta);
  c1 = commit('v1', 'v1');

  write('payload/hooks/plain.sh', 'echo plain v2\n');
  write('payload/hooks/new.js', "console.log('new v2');\n");
  write('payload/rules/extra.md', 'Extra rule\n');
  write('payload/settings/frag.json', JSON.stringify({ env: { A_KEY: '1', B_KEY: 'x', C_KEY: '3' } }));
  write('payload/settings/hook.json', JSON.stringify({ hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'node x.js' }] }] } }));
  putEntry(alpha(2));
  c2 = commit('v2', 'v2');

  write('payload/settings/frag.json', JSON.stringify({ env: { A_KEY: '2', B_KEY: 'x', C_KEY: '3' } }));
  c3 = commit('v3', 'v3');

  write('notes/user.txt', 'user notes\r\n', cfg);
  write('hooks/new.js', 'user original\r\nline2\r\n', cfg);
  write('hooks/user-hook.js', 'mine\n', cfg);
  write('skills/mine/SKILL.md', 'my skill\n', cfg);
  write('settings.json', JSON.stringify({ theme: 'dark', env: { USER_KEY: '1' } }, null, 2) + '\n', cfg);
  state = emptyState();
  state.values = { LABELS: '{"web":"WEB"}', who: 'Alex', agent_model: 'opus' };
});

after(() => {
  for (const k of ['CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT', 'CLAUDE_CONFIG_DIR', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function applyAt(st, dir, commitSha, extra = {}) {
  const run = newRun(st, 'apply', st.repo.commit, commitSha, dir);
  save(st, dir);
  const cat = catalogAt(repo, commitSha);
  for (const e of cat.values()) {
    const ctx = { repo, commit: commitSha, configDir: dir, state: st, values: st.values, runDir: runDirOf(run, dir), home: HOME, merge, ...extra };
    applyPlan(planPart(e, ctx), ctx);
  }
  st.repo = { path: repo, commit: commitSha, tag: null };
  finishRun(st, run);
  save(st, dir);
  return run;
}
const rctx = (extra = {}) => ({ repo, configDir: cfg, state, home: HOME, merge, ...extra });

let snap0;
let snap1;
let snap2;
let tracked2;

test('install v1 into a config with user files, then update to v2 (existed_before backup)', () => {
  snap0 = snap();
  applyAt(state, cfg, c1);
  snap1 = snap();
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/new.js'), 'utf8'), 'user original\r\nline2\r\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/plain.sh'), 'utf8'), 'echo plain v1\n');

  applyAt(state, cfg, c2);
  snap2 = snap();
  tracked2 = trackedCopy(state);
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/new.js'), 'utf8'), "console.log('new v2');\n");
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/plain.sh'), 'utf8'), 'echo plain v2\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'rules/extra.md'), 'utf8'), 'Extra rule\n');
  const f = state.files['hooks/new.js'];
  assert.equal(f.existed_before, true);
  assert.equal(raw(path.join(cfg, ...f.backup.split('/'))), crypto.createHash('sha256').update('user original\r\nline2\r\n').digest('hex'));
  const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.equal(s.env.C_KEY, '3');
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, 'node x.js');
  assert.equal(s.theme, 'dark');
});

test('updating again to v2 is a no-op', () => {
  const cat = catalogAt(repo, c2);
  const run = newRun(state, 'apply', c2, c2, cfg);
  for (const e of cat.values()) {
    const ctx = { repo, commit: c2, configDir: cfg, state, values: state.values, runDir: runDirOf(run, cfg), home: HOME, merge };
    const plan = planPart(e, ctx);
    assert.deepEqual(plan.ops, []);
    assert.deepEqual(plan.conflicts, []);
  }
  state.runs.pop();
  fs.rmSync(runDirOf(run, cfg), { recursive: true, force: true });
});

test('v3 changes a setting value: accepted conflict keeps history; rollback to v2 restores the v2 value', () => {
  const cat = catalogAt(repo, c3);
  const run0 = newRun(state, 'apply', c2, c3, cfg);
  const ctx0 = { repo, commit: c3, configDir: cfg, state, values: state.values, runDir: runDirOf(run0, cfg), home: HOME, merge };
  const p = planPart(cat.get('alpha'), ctx0);
  assert.deepEqual(p.settingsConflicts.map((c) => c.pointer), ['/env/A_KEY']);
  state.runs.pop();
  fs.rmSync(runDirOf(run0, cfg), { recursive: true, force: true });

  applyAt(state, cfg, c3, { acceptSettings: ['/env/A_KEY'] });
  const e = state.settings['/env/A_KEY'];
  assert.equal(e.value, '2');
  assert.deepEqual(e.prev, { $absent: true });
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].value, '1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8')).env.A_KEY, '2');

  const plan = planRollback(state, c2, rctx());
  assert.deepEqual(plan.ops, []);
  assert.deepEqual(plan.asks, []);
  assert.equal(plan.settings.entries.length, 1);
  const res = applyRollback(plan, rctx());
  assert.deepEqual(res.settings.conflicts, []);
  assert.deepEqual(snap(), snap2);
  assert.equal(state.settings['/env/A_KEY'].value, '1');
  assert.equal(state.repo.commit, c2);
  assert.equal(state.repo.tag, 'v2');
  assert.deepEqual(trackedCopy(state).files, tracked2.files);
});

test('rollback --to v1: exact bytes, v2 additions removed, user original restored, user data untouched', () => {
  state.answers = {
    p0: { answer: 'accept', at: 'x', commit: c1, run: 'r' },
    p1: { answer: 'accept', at: 'x', commit: c2, run: 'r' },
    p2: { answer: 'skip', at: 'x', commit: c3, run: 'r' },
  };
  save(state, cfg);
  tracked2 = trackedCopy(state);

  const plan = planRollback(state, c1, rctx());
  assert.deepEqual(plan.asks, []);
  const ops = Object.fromEntries(plan.ops.map((o) => [o.dest, o.why]));
  assert.equal(ops['hooks/plain.sh'], 'target-content');
  assert.equal(ops['hooks/new.js'], 'restore-original');
  assert.equal(ops['rules/extra.md'], 'not-in-target');
  assert.ok(!('hooks/alpha.js' in ops) && !('rules/alpha.md' in ops) && !('skills/s1/SKILL.md' in ops));
  assert.doesNotThrow(() => JSON.stringify(plan));

  const res = applyRollback(plan, rctx());
  assert.deepEqual(snap(), snap1);
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/new.js'), 'utf8'), 'user original\r\nline2\r\n');
  assert.equal(fs.existsSync(path.join(cfg, 'rules/extra.md')), false);
  assert.equal(state.files['hooks/new.js'], undefined);
  assert.equal(state.files['rules/extra.md'], undefined);
  assert.equal(state.settings['/env/C_KEY'], undefined);
  assert.equal(state.repo.commit, c1);
  assert.equal(state.repo.tag, 'v1');
  assert.deepEqual(state.parts.alpha, { installed: true, at_commit: c1 });
  assert.equal(state.answers.p0.answer, 'accept');
  assert.equal(state.answers.p1.answer, 'rolled-back');
  assert.equal(state.answers.p2.answer, 'rolled-back');
  const last = state.runs.at(-1);
  assert.equal(last.kind, 'rollback');
  assert.equal(last.status, 'done');
  assert.equal(last.id, res.run);
  assert.deepEqual(state.runs.filter((r) => r.status === 'rolled-back').map((r) => r.to).sort(), [c2, c3].sort());
  for (const keepUser of ['notes/user.txt', 'hooks/user-hook.js', 'skills/mine/SKILL.md']) assert.equal(raw(path.join(cfg, keepUser)), snap0[keepUser]);
  const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.equal(s.env.USER_KEY, '1');
  assert.equal(s.theme, 'dark');
  assert.equal(s.hooks, undefined);
});

test('rollback of the rollback returns to the v2 state exactly', () => {
  const plan = planUndo(state, rctx(), { runs: 1 });
  assert.deepEqual(plan.asks, []);
  assert.deepEqual(plan.problems, []);
  applyRollback(plan, rctx());
  assert.deepEqual(snap(), snap2);
  const now = trackedCopy(state);
  assert.deepEqual(now.files, tracked2.files);
  assert.deepEqual(now.settings, tracked2.settings);
  assert.deepEqual(now.parts, tracked2.parts);
  assert.deepEqual(now.repo, tracked2.repo);
  assert.deepEqual(now.answers, tracked2.answers);
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/new.js'), 'utf8'), "console.log('new v2');\n");
  const statuses = Object.fromEntries(state.runs.map((r) => [r.id, r.status]));
  assert.equal(state.runs.filter((r) => r.status === 'rolled-back').length, 2);
  assert.equal(statuses[state.runs.at(-1).id], 'done');
});

test('local edit: asks keep or revert; no answer refuses; keep holds; undo; revert backs up the edit', () => {
  const p = path.join(cfg, 'hooks/plain.sh');
  fs.writeFileSync(p, 'my own edit\n');
  const snapEdited = snap();

  const plan = planRollback(state, c1, rctx());
  assert.deepEqual(plan.asks.map((a) => [a.dest, a.reason, a.options]), [['hooks/plain.sh', 'local-edit', ['keep', 'revert']]]);
  assert.throws(() => applyRollback(plan, rctx()), /no answer for: hooks\/plain\.sh/);
  assert.deepEqual(snap(), snapEdited);

  const res = applyRollback(plan, rctx(), { 'hooks/plain.sh': 'keep' });
  assert.deepEqual(res.kept, ['hooks/plain.sh']);
  assert.equal(fs.readFileSync(p, 'utf8'), 'my own edit\n');
  assert.equal(state.files['hooks/plain.sh'].held, true);
  assert.equal(fs.existsSync(path.join(cfg, 'rules/extra.md')), false);

  applyRollback(planUndo(state, rctx(), { runs: 1 }), rctx());
  assert.deepEqual(snap(), snapEdited);
  assert.equal(state.repo.commit, c2);

  const plan2 = planRollback(state, c1, rctx());
  const res2 = applyRollback(plan2, rctx(), { 'hooks/plain.sh': 'revert' });
  assert.deepEqual(res2.kept, []);
  assert.equal(fs.readFileSync(p, 'utf8'), 'echo plain v1\n');
  const run = state.runs.find((r) => r.id === res2.run);
  assert.equal(fs.readFileSync(path.join(runDirOf(run, cfg), 'files/hooks/plain.sh'), 'utf8'), 'my own edit\n');
  assert.equal(state.files['hooks/plain.sh'].held, false);
});

test('rollback to before everything restores the original user config exactly', () => {
  const plan = planRollback(state, null, rctx());
  assert.deepEqual(plan.asks, []);
  applyRollback(plan, rctx());
  const now = snap();
  assert.equal(raw(path.join(cfg, 'tools/seed.json')), now['tools/seed.json']);
  delete now['tools/seed.json'];
  assert.deepEqual(now, snap0);
  assert.deepEqual(Object.keys(state.files), ['tools/seed.json']);
  assert.equal(state.files['tools/seed.json'].mode, 'seed');
  assert.deepEqual(state.settings, {});
  assert.deepEqual(state.parts, {});
  assert.equal(state.repo.commit, null);
  assert.equal(fs.existsSync(path.join(cfg, 'skills/s1')), false);
});

test('a crash mid-run leaves a started run that can be found and undone exactly', () => {
  const cfg2 = path.join(root, 'config2');
  write('notes/user.txt', 'other user\n', cfg2);
  write('hooks/plain.sh', 'user plain\r\n', cfg2);
  write('settings.json', JSON.stringify({ theme: 'light' }, null, 2) + '\n', cfg2);
  const before2 = snap(cfg2);
  const st = emptyState();
  st.values = { LABELS: '{}', who: 'W', agent_model: 'opus' };
  const boom = { ...merge, applyOps() { throw new Error('boom'); } };
  assert.throws(() => applyAt(st, cfg2, c1, { merge: boom }), /boom/);

  assert.notDeepEqual(snap(cfg2), before2);
  const onDisk = load(cfg2);
  const crashed = findCrashedRun(onDisk);
  assert.ok(crashed);
  assert.equal(crashed.status, 'started');
  assert.equal(crashed.kind, 'apply');
  assert.ok(Object.keys(onDisk.files).length > 0);

  const ctx = { repo, configDir: cfg2, state: onDisk, home: HOME, merge };
  const plan = planUndo(onDisk, ctx, { runs: 1 });
  assert.deepEqual(plan.asks, []);
  applyRollback(plan, ctx);
  assert.deepEqual(snap(cfg2), before2);
  assert.deepEqual(onDisk.files, {});
  assert.deepEqual(onDisk.settings, {});
  assert.equal(findCrashedRun(onDisk), null);
});

test('test-mode guard: rollback refuses a config dir outside the test root', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-out-'));
  try {
    const plan = { kind: 'rollback', target: null, from: null, ops: [], asks: [], settings: null, mcp: [], problems: [], parts: { remove: [], update: [] }, answers: [], runs: [], suffix: [] };
    assert.throws(() => applyRollback(plan, rctx({ configDir: outside })), /refusing/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
