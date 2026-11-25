import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as merge from '../../sync/lib/settings-merge.mjs';
import { applyPlan, destKey, expandFiles, planPart, render, setConstLine, setFrontmatter } from '../../sync/lib/install.mjs';
import { git, headCommit } from '../../sync/lib/repo.mjs';
import { catalogAt } from '../../sync/lib/rollback.mjs';
import { finishRun, newRun, runDirOf, save } from '../../sync/lib/state.mjs';
import { emptyState } from '../../sync/lib/state.mjs';
import { readJournal } from '../../sync/lib/fsx.mjs';

let root;
let cfg;
let repo;
let c1;
let state;
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
const commit = (msg) => {
  git(['add', '-A'], repo);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], repo);
  return headCommit(repo);
};

const ALPHA = entry('alpha', {
  files: [
    { src: 'payload/hooks/alpha.js', dest: 'hooks/alpha.js', mode: 'rendered' },
    { src: 'payload/hooks/plain.sh', dest: 'hooks/plain.sh', mode: 'managed' },
    { src: 'payload/skills/s1', dest: 'skills/s1', mode: 'managed' },
    { src: 'payload/seed/seed.json', dest: 'tools/seed.json', mode: 'seed' },
  ],
  rules: ['payload/rules/alpha.md'],
  settings: ['payload/settings/frag.json', 'payload/settings/skills.json'],
  mcp: [{ name: 'srv', config: { command: 'x' } }],
  machine_steps: ['do a thing outside the config dir'],
  user_steps: ['log in'],
  values: [
    { key: 'LABELS', file: 'hooks/alpha.js', ask: 'labels', default: '{}' },
    { key: 'who', file: 'rules/alpha.md', ask: 'who', default: 'World' },
  ],
});
const BETA = entry('beta', {
  files: [{ src: 'payload/agents/ag.md', dest: 'agents/ag.md', mode: 'rendered' }],
  values: [{ key: 'agent_model', file: 'agents/ag.md', frontmatter: 'model', ask: 'model', default: 'fable' }],
});

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-inst-'));
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
  write('payload/hooks/alpha.js', "const LABELS = {};\nconst ROOT = 1;\nmodule.exports = { LABELS, ROOT };\n");
  write('payload/hooks/plain.sh', 'echo plain v1\n');
  write('payload/skills/s1/SKILL.md', 'skill v1\n');
  write('payload/skills/s1/ref/a.md', 'ref v1\n');
  write('payload/seed/seed.json', '{"seed":1}\n');
  write('payload/rules/alpha.md', 'Hello {{who}} v1\n');
  write('payload/settings/frag.json', JSON.stringify({ env: { A_KEY: '1', B_KEY: 'x' } }));
  write('payload/settings/skills.json', JSON.stringify({ skillOverrides: { s1: 'off', ghost: 'off' } }));
  write('payload/agents/ag.md', '---\nname: ag\nmodel: opus\n---\nbody v1\n');
  putEntry(ALPHA);
  putEntry(BETA);
  c1 = commit('v1');

  write('notes/user.txt', 'user notes\r\n', cfg);
  write('hooks/plain.sh', 'user plain\r\nsecond line\r\n', cfg);
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

const ctxFor = (run, extra = {}) => ({ repo, commit: c1, configDir: cfg, state, values: state.values, runDir: runDirOf(run, cfg), home: HOME, merge, ...extra });
function applyAll(extra = {}, ids = ['alpha', 'beta']) {
  const run = newRun(state, 'apply', state.repo.commit, c1, cfg);
  save(state, cfg);
  const cat = catalogAt(repo, c1);
  const out = ids.map((id) => {
    const ctx = ctxFor(run, extra);
    const plan = planPart(cat.get(id), ctx);
    return { plan, result: applyPlan(plan, ctx) };
  });
  state.repo = { path: repo, commit: c1, tag: null };
  finishRun(state, run);
  save(state, cfg);
  return { run, out };
}

test('helpers: destKey, render, setFrontmatter, setConstLine', () => {
  assert.equal(destKey('hooks\\a.js'), 'hooks/a.js');
  assert.equal(destKey('{memory_dir}/note.md', HOME), 'projects/C--Users-some-one/memory/note.md');
  for (const bad of ['../x', '/abs', 'C:/x', 'settings.json', 'backups/x', 'state/claude-manners/state.json', 'state/claude-setup/state.json', 'a/../../x']) assert.throws(() => destKey(bad), /bad or reserved/, bad);
  assert.equal(render('a {{k}} b {{k}}', { k: 1 }), 'a 1 b 1');
  assert.equal(render('{{ not a key }} {{9}}', {}), '{{ not a key }} {{9}}');
  assert.throws(() => render('{{missing}}', {}), /no value for/);
  assert.equal(setFrontmatter('---\nmodel: a\nx: 1\n---\nbody\n', 'model', 'b'), '---\nmodel: b\nx: 1\n---\nbody\n');
  assert.equal(setFrontmatter('---\r\nx: 1\r\n---\r\nbody', 'model', 'b'), '---\r\nx: 1\nmodel: b\r\n---\r\nbody');
  assert.throws(() => setFrontmatter('no frontmatter', 'model', 'b'), /no frontmatter/);
  assert.equal(setConstLine('a\nconst K = [];\nb\n', 'K', '["x"]', 'f.js'), 'a\nconst K = ["x"];\nb\n');
  assert.equal(setConstLine('const K = [];\r\n', 'K', '', 'f.js'), 'const K = [];\r\n');
  assert.equal(setConstLine('const K = 1;\n', 'K', 'plain', 'f.js'), 'const K = "plain";\n');
  assert.throws(() => setConstLine('const Other = 1;\n', 'K', 'x', 'f.js'), /not found/);
});

test('expandFiles expands folders per file and rules flat', () => {
  const items = expandFiles(ALPHA, repo, c1, { home: HOME });
  assert.deepEqual(items.map((i) => i.dest), ['hooks/alpha.js', 'hooks/plain.sh', 'skills/s1/SKILL.md', 'skills/s1/ref/a.md', 'tools/seed.json', 'rules/alpha.md']);
  assert.throws(() => expandFiles(entry('x', { files: [{ src: 'payload/none', dest: 'n', mode: 'managed' }] }), repo, c1), /does not exist/);
});

test('plan for a first install: writes, existing user file, mcp and machine steps only listed', () => {
  const run = newRun(state, 'apply', null, c1, cfg);
  const plan = planPart(ALPHA, ctxFor(run));
  assert.deepEqual(plan.conflicts, []);
  const by = Object.fromEntries(plan.ops.map((o) => [o.dest, o]));
  assert.equal(by['hooks/plain.sh'].why, 'replaces-user-file');
  assert.equal(by['hooks/alpha.js'].why, 'new');
  assert.equal(by['tools/seed.json'].why, 'seed');
  assert.deepEqual(plan.mcp, [{ name: 'srv', config: { command: 'x' }, part: 'alpha', action: 'add' }]);
  assert.deepEqual(plan.machine_steps, ['do a thing outside the config dir']);
  assert.ok(plan.settingsConflicts.length === 0);
  assert.doesNotThrow(() => JSON.stringify(plan));
  assert.equal('bytes' in JSON.parse(JSON.stringify(plan)).ops[0], false);
  state.runs.pop();
  fs.rmSync(runDirOf(run, cfg), { recursive: true, force: true });
});

test('first install: exact files, existed_before backup, tracking, settings, user data untouched', () => {
  const userNotes = raw(path.join(cfg, 'notes', 'user.txt'));
  const userPlain = fs.readFileSync(path.join(cfg, 'hooks', 'plain.sh'));
  const { run, out } = applyAll();

  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/alpha.js'), 'utf8'), 'const LABELS = {"web":"WEB"};\nconst ROOT = 1;\nmodule.exports = { LABELS, ROOT };\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'rules/alpha.md'), 'utf8'), 'Hello Alex v1\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'agents/ag.md'), 'utf8'), '---\nname: ag\nmodel: opus\n---\nbody v1\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'hooks/plain.sh'), 'utf8'), 'echo plain v1\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'skills/s1/ref/a.md'), 'utf8'), 'ref v1\n');
  assert.equal(fs.readFileSync(path.join(cfg, 'tools/seed.json'), 'utf8'), '{"seed":1}\n');

  const f = state.files;
  assert.equal(f['hooks/plain.sh'].existed_before, true);
  assert.ok(f['hooks/plain.sh'].backup.startsWith('state/claude-manners/backups/'));
  assert.deepEqual(fs.readFileSync(path.join(cfg, ...f['hooks/plain.sh'].backup.split('/'))), userPlain);
  for (const k of ['hooks/alpha.js', 'rules/alpha.md', 'skills/s1/SKILL.md', 'skills/s1/ref/a.md', 'agents/ag.md']) {
    assert.equal(f[k].existed_before, false, k);
    assert.equal(f[k].backup, null, k);
    assert.equal(f[k].commit, c1);
  }
  assert.equal(f['tools/seed.json'].mode, 'seed');
  assert.equal(f['hooks/alpha.js'].mode, 'rendered');
  assert.equal(f['rules/alpha.md'].mode, 'managed');
  assert.equal(f['agents/ag.md'].part, 'beta');

  assert.equal(raw(path.join(cfg, 'notes', 'user.txt')), userNotes);
  const settings = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.deepEqual(settings, { theme: 'dark', env: { USER_KEY: '1', A_KEY: '1', B_KEY: 'x' }, skillOverrides: { s1: 'off' } });
  assert.deepEqual(state.settings['/env/A_KEY'], { part: 'alpha', pointer: '/env/A_KEY', value: '1', prev: { $absent: true }, run: run.id });
  assert.ok(state.settings['/env/B_KEY']);
  assert.ok(state.settings['/skillOverrides/s1']);
  assert.equal(state.settings['/skillOverrides/ghost'], undefined);
  assert.deepEqual(state.parts.alpha, { installed: true, at_commit: c1 });
  assert.deepEqual(out[0].result.mcp.map((m) => m.name), ['srv']);
  assert.equal(state.mcp.srv, undefined);

  const events = readJournal(runDirOf(run, cfg));
  assert.ok(events.some((e) => e.ev === 'file' && e.dest === 'hooks/plain.sh' && e.existed === true && e.backup));
  assert.ok(events.some((e) => e.ev === 'settings-begin') && events.some((e) => e.ev === 'settings-end'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'state', 'claude-manners', 'state.json'), 'utf8')).parts.alpha.installed, true);
});

test('second install is a no-op', () => {
  const before = JSON.stringify(state.files);
  const run = newRun(state, 'apply', c1, c1, cfg);
  for (const e of [ALPHA, BETA]) {
    const plan = planPart(e, ctxFor(run));
    assert.deepEqual(plan.ops, []);
    assert.deepEqual(plan.conflicts, []);
    assert.ok(plan.unchanged > 0);
    assert.ok(plan.settings.every((s) => s.ops.every((o) => o.op === 'keep')));
    const r = applyPlan(plan, ctxFor(run));
    assert.deepEqual([r.written, r.adopted, r.tracked, r.held, r.settings.written], [[], [], [], [], []]);
  }
  assert.equal(JSON.stringify(state.files), before);
  finishRun(state, run);
});

test('seed files are never rewritten or reported', () => {
  fs.writeFileSync(path.join(cfg, 'tools/seed.json'), '{"mine":true}\n');
  const run = newRun(state, 'apply', c1, c1, cfg);
  const plan = planPart(ALPHA, ctxFor(run));
  assert.ok(!plan.ops.some((o) => o.dest === 'tools/seed.json'));
  assert.deepEqual(plan.conflicts, []);
  fs.rmSync(path.join(cfg, 'tools/seed.json'));
  assert.ok(!planPart(ALPHA, ctxFor(run)).ops.some((o) => o.dest === 'tools/seed.json'));
  finishRun(state, run);
});

test('local edit is a conflict; apply refuses; keep marks held; overwrite backs up and writes', () => {
  const p = path.join(cfg, 'hooks/alpha.js');
  const mine = fs.readFileSync(p, 'utf8') + '// my edit\n';
  fs.writeFileSync(p, mine);
  const run = newRun(state, 'apply', c1, c1, cfg);

  let plan = planPart(ALPHA, ctxFor(run));
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].dest, 'hooks/alpha.js');
  assert.equal(plan.conflicts[0].reason, 'local-edit');
  assert.throws(() => applyPlan(plan, ctxFor(run)), /unresolved local edits/);
  assert.equal(fs.readFileSync(p, 'utf8'), mine);

  const keepCtx = ctxFor(run, { keep: ['hooks/alpha.js'] });
  plan = planPart(ALPHA, keepCtx);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.ops.map((o) => o.kind), ['hold']);
  const res = applyPlan(plan, keepCtx);
  assert.deepEqual(res.held, ['hooks/alpha.js']);
  assert.equal(state.files['hooks/alpha.js'].held, true);
  assert.equal(fs.readFileSync(p, 'utf8'), mine);

  plan = planPart(ALPHA, ctxFor(run));
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.held, ['hooks/alpha.js']);
  assert.deepEqual(plan.ops, []);

  const owCtx = ctxFor(run, { overwrite: ['hooks/alpha.js'] });
  plan = planPart(ALPHA, owCtx);
  assert.equal(plan.ops[0].why, 'overwrite-local-edit');
  applyPlan(plan, owCtx);
  assert.equal(fs.readFileSync(p, 'utf8'), 'const LABELS = {"web":"WEB"};\nconst ROOT = 1;\nmodule.exports = { LABELS, ROOT };\n');
  assert.equal(state.files['hooks/alpha.js'].held, false);
  assert.equal(fs.readFileSync(path.join(runDirOf(run, cfg), 'files/hooks/alpha.js'), 'utf8'), mine);
  assert.equal(state.files['hooks/alpha.js'].existed_before, false);
  finishRun(state, run);
});

test('a changed value rewrites the rendered file; a deleted managed file is restored', () => {
  state.values.who = 'Bob';
  const run = newRun(state, 'apply', c1, c1, cfg);
  let ctx = ctxFor(run);
  let plan = planPart(ALPHA, ctx);
  assert.deepEqual(plan.ops.map((o) => [o.dest, o.why]), [['rules/alpha.md', 'update']]);
  applyPlan(plan, ctx);
  assert.equal(fs.readFileSync(path.join(cfg, 'rules/alpha.md'), 'utf8'), 'Hello Bob v1\n');
  fs.rmSync(path.join(cfg, 'skills/s1/SKILL.md'));
  ctx = ctxFor(run);
  plan = planPart(ALPHA, ctx);
  assert.deepEqual(plan.ops.map((o) => [o.dest, o.why]), [['skills/s1/SKILL.md', 'restore-missing']]);
  applyPlan(plan, ctx);
  assert.equal(fs.readFileSync(path.join(cfg, 'skills/s1/SKILL.md'), 'utf8'), 'skill v1\n');
  finishRun(state, run);
});

test('a plan that went stale (file changed after planning) is refused', () => {
  const run = newRun(state, 'apply', c1, c1, cfg);
  state.values.who = 'Carol';
  const ctx = ctxFor(run);
  const plan = planPart(ALPHA, ctx);
  fs.writeFileSync(path.join(cfg, 'rules/alpha.md'), 'edited meanwhile\n');
  assert.throws(() => applyPlan(plan, ctx), /changed after the plan/);
  fs.writeFileSync(path.join(cfg, 'rules/alpha.md'), 'Hello Bob v1\n');
  state.values.who = 'Bob';
  finishRun(state, run);
});

test('settings conflicts are reported and left alone unless accepted', () => {
  const run = newRun(state, 'apply', c1, c1, cfg);
  const sp = path.join(cfg, 'settings.json');
  const doc = JSON.parse(fs.readFileSync(sp, 'utf8'));
  doc.env.A_KEY = 'mine';
  fs.writeFileSync(sp, JSON.stringify(doc, null, 2) + '\n');
  const ctx = ctxFor(run);
  const plan = planPart(ALPHA, ctx);
  assert.deepEqual(plan.settingsConflicts.map((c) => c.pointer), ['/env/A_KEY']);
  const res = applyPlan(plan, ctx);
  assert.deepEqual(res.settings.skipped, ['/env/A_KEY']);
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).env.A_KEY, 'mine');
  assert.equal(state.settings['/env/A_KEY'].value, '1');
  finishRun(state, run);
});

test('test-mode guard: applyPlan refuses a config dir outside the test root and writes nothing', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-out-'));
  try {
    const run = newRun(state, 'apply', c1, c1, cfg);
    const ctx = ctxFor(run, { configDir: outside });
    const plan = planPart(BETA, ctx);
    assert.throws(() => applyPlan(plan, ctx), /refusing/);
    assert.deepEqual(fs.readdirSync(outside), []);
    finishRun(state, run);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
