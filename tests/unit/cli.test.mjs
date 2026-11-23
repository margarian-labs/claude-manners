import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as merge from '../../sync/lib/settings-merge.mjs';
import { planPart } from '../../sync/lib/install.mjs';
import { walk, journal, hashFile } from '../../sync/lib/fsx.mjs';
import { load, newRun, runDirOf, save } from '../../sync/lib/state.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAVED = { ...process.env };
const ENV_KEYS = ['CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

let root;
let cfg;
let origin;
let owner;
let user;
let fake;
let engineCli;
let c1;
let c2;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const write = (rel, text, base) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const read = (rel, base = cfg) => fs.readFileSync(path.join(base, rel), 'utf8');
const exists = (rel, base = cfg) => fs.existsSync(path.join(base, rel));
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const entry = (id, extra) => ({
  id, title: id, group: 'tools', level: 'optional', summary: `The ${id} part.`, details: `The ${id} part does one small thing for the tests, and changes only the files it lists.`, needs: [], files: [], settings: [], rules: [], mcp: [], plugins: [], values: [],
  user_steps: [], machine_steps: [], verify: [], tokens_always_on: { value: null, how: 'not measured yet' }, quality: 'tried', risk: 'Test part, no code runs.', ask_alone: false, license: null, ...extra,
});
const putEntry = (e) => write(`catalog/${e.id}.json`, JSON.stringify(e, null, 2), owner);
const proposal = (id, meta, what = 'Something changes.') => write(`proposals/${id}.md`, [
  '---',
  `id: ${id}`,
  `title: ${meta.title}`,
  `kind: ${meta.kind}`,
  'level: recommended',
  `part: ${meta.part}`,
  'touches:',
  ...meta.touches.map((t) => `  - ${t}`),
  'tokens_always_on: "+10"',
  'quality: tried',
  `risk: ${meta.risk || 'Test change, no code runs.'}`,
  'undo: Roll back to the previous version.',
  '---',
  '',
  '## What changes',
  '',
  what,
  '',
  '## Why',
  '',
  'Because the test needs it.',
  '',
].join('\n'), owner);
const release = (msg, tag) => {
  git(['add', '-A'], owner);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], owner);
  git(['tag', '-a', tag, '-m', msg], owner);
  git(['push', '-q', 'origin', 'main', '--tags'], owner);
  return git(['rev-parse', 'HEAD'], owner);
};

function cli(args, { dir = cfg, exe = engineCli, input } = {}) {
  const r = spawnSync(process.execPath, [exe, ...args, '--json'], {
    encoding: 'utf8',
    input,
    env: { ...process.env, CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, CLAUDE_SETUP_TEST_HOME: path.join(root, 'home'), CLAUDE_SETUP_TEST_FAKE: fake, CLAUDE_CONFIG_DIR: dir },
  });
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    throw new Error(`not JSON (exit ${r.status}): ${r.stdout}\n${r.stderr}`);
  }
  return { code: r.status, json, stderr: r.stderr };
}
const ok = (r) => {
  assert.equal(r.code, 0, JSON.stringify(r.json, null, 1));
  return r.json;
};
const needsAnswer = (r) => {
  assert.equal(r.code, 2, JSON.stringify(r.json, null, 1));
  assert.equal(r.json.status, 'needs-answer');
  return r.json.questions;
};
const fakeSet = (o) => fs.writeFileSync(fake, JSON.stringify({ ...JSON.parse(fs.readFileSync(fake, 'utf8')), ...o }));
const fakeGet = () => JSON.parse(fs.readFileSync(fake, 'utf8'));
const calls = (...prefix) => (fakeGet().calls || []).filter((c) => prefix.every((p, i) => c[i + 1] === p));
const stateOf = (dir = cfg) => JSON.parse(fs.readFileSync(path.join(dir, 'state', 'claude-setup', 'state.json'), 'utf8'));
const snap = (dir = cfg) => {
  const out = {};
  for (const rel of walk(dir)) if (!rel.startsWith('state/claude-setup/')) out[rel] = sha(fs.readFileSync(path.join(dir, rel)));
  return out;
};

const alpha = (v) => entry('alpha', {
  group: 'hooks', level: 'recommended',
  files: [
    { src: 'payload/hooks/alpha.js', dest: 'hooks/alpha.js', mode: 'rendered' },
    { src: 'payload/hooks/plain.sh', dest: 'hooks/plain.sh', mode: 'managed' },
  ],
  rules: ['payload/rules/claude-setup--alpha.md'],
  settings: ['payload/settings/alpha.json'],
  values: [
    { key: 'LABELS', file: 'hooks/alpha.js', ask: 'Labels as JSON', default: '{}' },
    { key: 'who', file: 'rules/claude-setup--alpha.md', ask: 'Your name', default: 'World' },
  ],
  verify: ['node -e "process.exit(0)"'],
  risk: v >= 2 ? 'Runs a hook at session start.' : 'Test part.',
});
const beta = entry('beta', {
  group: 'agents', level: 'recommended',
  files: [{ src: 'payload/agents/b.md', dest: 'agents/b.md', mode: 'rendered' }],
  rules: ['payload/rules/claude-setup--beta.md'],
  values: [
    { key: 'planner_agent_model', file: 'agents/b.md', frontmatter: 'model', ask: 'Model for the planner', default: 'fable' },
    { key: 'planner_model', file: 'rules/claude-setup--beta.md', ask: 'Planner name', default: 'Fable 5.2' },
  ],
});
const gamma = entry('gamma', {
  group: 'integrations',
  files: [{ src: 'payload/tools/gamma.txt', dest: 'tools/gamma.txt', mode: 'rendered' }],
  mcp: [{ name: 'gamma-mcp', config: { command: 'node', args: ['g.js'] } }],
  values: [{ key: 'gname', file: 'tools/gamma.txt', ask: 'Gamma name', default: 'gee' }],
  user_steps: ['Make a gamma account.'],
  machine_steps: ['Set up {{gname}} on this PC.'],
  verify: ['node -e "process.exit(0)"'],
});
const engine = entry('sync-engine', {
  group: 'tools', level: 'recommended', needs: ['cmd:node', 'cmd:git'],
  files: [
    { src: 'sync', dest: 'tools/claude-setup/sync', mode: 'managed' },
    { src: 'sync/skill', dest: 'skills/claude-setup-sync', mode: 'managed' },
  ],
});

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cli-'));
  Object.assign(process.env, { CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  cfg = path.join(root, 'config');
  origin = path.join(root, 'origin.git');
  owner = path.join(root, 'owner');
  user = path.join(root, 'user');
  fake = path.join(root, 'fake-claude.json');
  fs.writeFileSync(fake, JSON.stringify({ version: '2.1.100 (Claude Code)', fable: false, mcp: {}, calls: [] }));
  fs.mkdirSync(owner, { recursive: true });
  git(['init', '-q', '--bare', '-b', 'main', origin], root);
  git(['init', '-q', '-b', 'main'], owner);
  git(['config', 'core.autocrlf', 'false'], owner);
  git(['remote', 'add', 'origin', origin], owner);

  fs.cpSync(path.join(PROJECT, 'sync'), path.join(owner, 'sync'), { recursive: true });
  write('payload/hooks/alpha.js', 'const LABELS = {};\nmodule.exports = { LABELS };\n', owner);
  write('payload/hooks/plain.sh', 'echo plain v1\n', owner);
  write('payload/rules/claude-setup--alpha.md', 'Hello {{who}} v1\n', owner);
  write('payload/rules/claude-setup--core.md', 'Core rule\n', owner);
  write('payload/settings/alpha.json', JSON.stringify({ env: { ALPHA_KEY: '1' } }), owner);
  write('payload/agents/b.md', '---\nname: b\nmodel: fable\n---\nagent body v1\n', owner);
  write('payload/rules/claude-setup--beta.md', 'Planner is {{planner_model}}.\n', owner);
  write('payload/settings/bypass.json', JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }), owner);
  write('payload/settings/skill-overrides.json', JSON.stringify({ skillOverrides: { 'fewer-permission-prompts': 'off', 'plugin-authoring': 'off', init: 'user-invocable-only', 'security-review': 'user-invocable-only', simplify: 'user-invocable-only', schedule: 'user-invocable-only', 'keybindings-help': 'user-invocable-only', architecture: 'off', 'not-installed-skill': 'off' } }), owner);
  write('payload/skills/architecture/SKILL.md', 'architecture skill\n', owner);
  putEntry(engine);
  putEntry(alpha(1));
  putEntry(beta);
  putEntry(entry('bypass', { group: 'settings', level: 'recommended', settings: ['payload/settings/bypass.json'], ask_alone: true, risk: 'Runs every command without asking.' }));
  putEntry(entry('delta', { group: 'tools', needs: ['cmd:no-such-command-xyz'] }));
  putEntry(entry('epsilon', { group: 'tools', needs: ['part:alpha'] }));
  for (let i = 1; i <= 12; i++) write(`payload/zeta/doc${String(i).padStart(2, '0')}.md`, `doc ${i}\n${'a long documentation line that fills the card with text\n'.repeat(50)}`, owner);
  write('payload/zeta/run.js', "console.log('zeta');\n", owner);
  putEntry(entry('zeta', { group: 'skills', files: [{ src: 'payload/zeta', dest: 'skills/zeta', mode: 'managed' }] }));
  putEntry(entry('core-rules', { group: 'rules', level: 'recommended', rules: ['payload/rules/claude-setup--core.md'] }));
  putEntry(entry('skill-overrides', { group: 'settings', level: 'recommended', settings: ['payload/settings/skill-overrides.json'] }));
  putEntry(entry('skill-architecture', { group: 'skills', files: [{ src: 'payload/skills/architecture', dest: 'skills/architecture', mode: 'managed' }] }));
  proposal('p-v1-note', { title: 'An old note', kind: 'change', part: 'alpha', touches: ['hooks/plain.sh'] });
  c1 = release('Version one', 'v1');

  write('payload/hooks/plain.sh', 'echo plain v2\n', owner);
  write('payload/settings/alpha.json', JSON.stringify({ env: { ALPHA_KEY: '1', NEW_KEY: '2' } }), owner);
  write('payload/agents/b.md', '---\nname: b\nmodel: fable\n---\nagent body v2\n', owner);
  write('payload/tools/gamma.txt', 'gamma is {{gname}}\n', owner);
  putEntry(alpha(2));
  putEntry(gamma);
  proposal('p-alpha-hook', { title: 'Better hook', kind: 'change', part: 'alpha', touches: ['hooks/plain.sh', '/env/NEW_KEY'], risk: 'Runs a hook at session start.' });
  proposal('p-beta-agent', { title: 'Sharper agent', kind: 'change', part: 'beta', touches: ['agents/b.md'] });
  proposal('p-gamma-add', { title: 'Add gamma', kind: 'add', part: 'new:gamma', touches: ['tools/gamma.txt', '/mcpServers/gamma-mcp'], risk: 'Adds an MCP server.' });
  proposal('p-delta-change', { title: 'Change delta', kind: 'change', part: 'delta', touches: ['tools/delta.txt'] });
  c2 = release('Version two', 'v2');

  git(['clone', '-q', '-c', 'core.autocrlf=false', '--branch', 'main', origin, user], root);
  git(['reset', '-q', '--hard', c1], user);
  git(['config', 'core.autocrlf', 'false'], user);
  write('notes/user.txt', 'user notes\r\n', cfg);
  write('hooks/plain.sh', 'user original\r\n', cfg);
  write('skills/mine/SKILL.md', 'my skill\n', cfg);
  write('settings.json', JSON.stringify({ theme: 'dark', env: { USER_KEY: '1' } }, null, 2) + '\n', cfg);
  engineCli = path.join(cfg, 'tools', 'claude-setup', 'sync', 'sync.mjs');
});

after(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

let snapStart;
let snapInstalled;
let snapPre;
let snapV2;

test('test mode refuses a config dir outside the test root', () => {
  const outside = path.join(os.tmpdir(), `cs-outside-${process.pid}`);
  const r = cli(['status'], { dir: outside, exe: path.join(PROJECT, 'sync', 'sync.mjs') });
  assert.equal(r.code, 1);
  assert.match(r.json.error, /outside CLAUDE_SETUP_TEST_ROOT/);
  assert.equal(fs.existsSync(outside), false);
});

test('bootstrap: installs only the engine and the skill, records the clone', () => {
  snapStart = snap();
  const first = cli(['bootstrap', '--repo', user], { exe: path.join(user, 'sync', 'sync.mjs') });
  const j = ok(first);
  assert.equal(j.command, 'bootstrap');
  assert.ok(exists('tools/claude-setup/sync/sync.mjs'));
  assert.ok(exists('tools/claude-setup/sync/lib/state.mjs'));
  assert.ok(exists('skills/claude-setup-sync/SKILL.md'));
  assert.equal(read('hooks/plain.sh'), 'user original\r\n');
  const s = stateOf();
  assert.equal(path.resolve(s.repo.path), path.resolve(user));
  assert.equal(s.repo.commit, null);
  assert.deepEqual(Object.keys(s.parts), ['sync-engine']);
  assert.ok(s.engine.sha256);
  assert.equal(s.runs.at(-1).status, 'done');
  const now = snap();
  const added = Object.keys(now).filter((k) => !(k in snapStart));
  assert.ok(added.every((k) => k.startsWith('tools/claude-setup/sync/') || k.startsWith('skills/claude-setup-sync/')), added.join(', '));
  for (const k of Object.keys(snapStart)) assert.equal(now[k], snapStart[k]);
  const again = ok(cli(['bootstrap', '--repo', user]));
  assert.equal(again.result.written.length, 0);
});

test('catalog --json: groups, ticked recommended, hidden parts, ask_alone, first run', () => {
  const j = ok(cli(['catalog']));
  assert.equal(j.first_run, true);
  const parts = Object.fromEntries(j.groups.flatMap((g) => g.parts.map((p) => [p.id, { ...p, group: g.group }])));
  assert.ok(!('sync-engine' in parts));
  assert.equal(parts.alpha.ticked, true);
  assert.equal(parts.alpha.group, 'hooks');
  assert.ok(!('values' in parts.alpha) && !('risk' in parts.bypass));
  assert.equal(parts.bypass.ask_alone, true);
  assert.equal(parts['skill-architecture'].ticked, false);
  assert.ok(!('delta' in parts));
  assert.deepEqual(j.hidden.map((h) => [h.id, h.unmet]), [['delta', ['cmd:no-such-command-xyz']]]);
  assert.ok(!('gamma' in parts));
  assert.deepEqual(parts.epsilon.requires_parts, ['alpha']);
  assert.equal(parts.epsilon.ticked, false);

  const d = ok(cli(['catalog', '--parts', 'alpha,bypass']));
  const dp = Object.fromEntries(d.groups.flatMap((g) => g.parts.map((p) => [p.id, p])));
  assert.deepEqual(dp.alpha.values.map((v) => v.key), ['LABELS', 'who']);
  assert.equal(dp.bypass.risk, 'Runs every command without asking.');
  assert.equal(dp.alpha.quality, 'tried');
  assert.ok(!('risk' in dp.epsilon));
});

test('first run: install of 2 parts needs the risky confirm, then records every proposal as baseline', () => {
  snapInstalled = null;
  const before = snap();
  const q = needsAnswer(cli(['install', '--parts', 'alpha,beta']));
  const risky = q.find((x) => x.kind === 'risky');
  assert.equal(risky.id, 'alpha');
  assert.deepEqual(risky.pointers, ['/env/ALPHA_KEY']);
  assert.deepEqual(snap(), before);

  const r = cli(['install', '--parts', 'alpha,beta', '--confirm-risky', 'alpha', '--values', 'LABELS={"a":"A"}', '--values', 'who=Ann']);
  const j = ok(r);
  assert.deepEqual(j.baseline, ['p-v1-note']);
  assert.equal(read('hooks/plain.sh'), 'echo plain v1\n');
  assert.equal(read('hooks/alpha.js'), 'const LABELS = {"a":"A"};\nmodule.exports = { LABELS };\n');
  assert.equal(read('rules/claude-setup--alpha.md'), 'Hello Ann v1\n');
  assert.match(read('agents/b.md'), /^model: opus$/m);
  assert.equal(read('rules/claude-setup--beta.md'), 'Planner is Opus 5.5.\n');
  const s = stateOf();
  assert.equal(s.answers['p-v1-note'].answer, 'baseline');
  assert.equal(s.repo.commit, c1);
  assert.equal(s.repo.tag, 'v1');
  assert.deepEqual(Object.keys(s.parts).sort(), ['alpha', 'beta', 'sync-engine']);
  assert.equal(s.values.planner_model, 'Opus 5.5');
  assert.equal(s.files['hooks/plain.sh'].existed_before, true);
  assert.equal(fs.readFileSync(path.join(cfg, ...s.files['hooks/plain.sh'].backup.split('/')), 'utf8'), 'user original\r\n');
  const settings = JSON.parse(read('settings.json'));
  assert.deepEqual(settings, { theme: 'dark', env: { USER_KEY: '1', ALPHA_KEY: '1' } });
  assert.equal(read('notes/user.txt'), 'user notes\r\n');
  assert.equal(read('skills/mine/SKILL.md'), 'my skill\n');
  assert.ok(calls('-p').length >= 1);
  assert.equal(fakeGet().calls.every((c) => c[0] === 'claude'), true);
  snapInstalled = snap();
});

test('status --json: clone, version, pending, no crash', () => {
  const j = ok(cli(['status']));
  assert.equal(j.repo.tag, 'v1');
  assert.equal(j.parts, 3);
  assert.equal(j.pending, 0);
  assert.equal(j.crashed, null);
  assert.deepEqual(j.held, []);
  assert.equal(j.engine_update, false);
});

test('values: list, set, unknown key', () => {
  const j = ok(cli(['values']));
  assert.deepEqual(j.values.map((v) => v.key).sort(), ['LABELS', 'planner_agent_model', 'planner_model', 'who']);
  const set = ok(cli(['values', 'set', 'who=Bob']));
  assert.deepEqual(set.apply_with, ['alpha']);
  assert.equal(stateOf().values.who, 'Bob');
  ok(cli(['values', 'set', 'who=Ann']));
  assert.equal(cli(['values', 'set', 'nope=1']).code, 1);
});

test('apply (plan only) fetches v2 and lists a card for every proposal; writes nothing', () => {
  const before = snap();
  const j = ok(cli(['apply', '--cards']));
  assert.equal(j.mode, 'plan');
  assert.equal(j.repo.head, c2);
  assert.equal(j.repo.tag, 'v2');
  assert.deepEqual(j.pending.map((p) => p.id), ['p-alpha-hook', 'p-beta-agent', 'p-gamma-add']);
  const byId = Object.fromEntries(j.pending.map((p) => [p.id, p]));
  assert.deepEqual(byId['p-alpha-hook'].risky, ['/env/NEW_KEY']);
  assert.match(byId['p-alpha-hook'].card, /Better hook/);
  assert.match(byId['p-alpha-hook'].card, /\+echo plain v2/);
  assert.match(byId['p-alpha-hook'].card, /\+ \/env\/NEW_KEY = "2"/);
  assert.deepEqual(byId['p-beta-agent'].risky, []);
  assert.match(byId['p-beta-agent'].card, /\+agent body v2/);
  assert.deepEqual(byId['p-gamma-add'].risky, ['/mcpServers/gamma-mcp']);
  assert.match(byId['p-gamma-add'].card, /\+ mcp gamma-mcp/);
  assert.deepEqual(byId['p-gamma-add'].steps.map((s) => [s.kind, s.text]), [['user', 'Make a gamma account.'], ['machine', 'Set up gee on this PC.']]);
  assert.equal(byId['p-alpha-hook'].noop, false);
  assert.deepEqual(snap(), before);
  assert.deepEqual(calls('mcp'), []);
  assert.equal(git(['rev-parse', 'HEAD'], user), c2);
  assert.equal(j.hidden.not_installed, 1);
  assert.equal(j.cards_omitted, false);
  assert.ok(j.pending.every((p) => p.card && p.files.length > 0));
  assert.deepEqual(ok(cli(['plan', '--proposals', 'p-beta-agent'])).pending.map((p) => p.id), ['p-beta-agent']);
  const bad = cli(['apply', '--proposals', 'nope']);
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /nope is not pending/);
  assert.deepEqual(snap(), before);
});

test('apply: a risky proposal without --confirm-risky and a local edit both stop with exit 2', () => {
  write('hooks/plain.sh', 'my own edit\n', cfg);
  snapPre = snap();
  const q = needsAnswer(cli(['apply', '--proposals', 'p-alpha-hook', '--answers', 'p-beta-agent=skip,p-gamma-add=later']));
  assert.deepEqual(q.map((x) => x.kind).sort(), ['local-edit', 'risky']);
  assert.equal(q.find((x) => x.kind === 'local-edit').dest, 'hooks/plain.sh');
  assert.deepEqual(snap(), snapPre);
  assert.equal(stateOf().answers['p-alpha-hook'], undefined);
});

test('apply with answers: accept installs only the accepted one, --keep holds the edited file, skip and later are recorded', () => {
  const j = ok(cli(['apply', '--proposals', 'p-alpha-hook', '--answers', 'p-beta-agent=skip,p-gamma-add=later', '--keep', 'hooks/plain.sh', '--confirm-risky', 'p-alpha-hook']));
  assert.deepEqual(j.accepted, ['p-alpha-hook']);
  assert.deepEqual(j.skipped, ['p-beta-agent']);
  assert.deepEqual(j.later, ['p-gamma-add']);
  assert.equal(read('hooks/plain.sh'), 'my own edit\n');
  assert.deepEqual(j.result.held, ['hooks/plain.sh']);
  assert.equal(JSON.parse(read('settings.json')).env.NEW_KEY, '2');
  assert.match(read('agents/b.md'), /agent body v1/);
  assert.equal(exists('tools/gamma.txt'), false);
  assert.deepEqual(calls('mcp'), []);
  const s = stateOf();
  assert.equal(s.files['hooks/plain.sh'].held, true);
  assert.equal(s.answers['p-alpha-hook'].answer, 'accept');
  assert.equal(s.answers['p-beta-agent'].answer, 'skip');
  assert.equal(s.answers['p-gamma-add'].answer, 'later');
  assert.equal(s.repo.tag, 'v2');
  assert.equal(s.parts.gamma, undefined);
  const next = ok(cli(['apply']));
  assert.deepEqual(next.pending.map((p) => p.id), ['p-gamma-add']);
  assert.deepEqual(next.pending[0].held ?? [], []);
});

test('rollback --last: plan lists the settings, the apply restores the exact earlier tree and keeps the person data', () => {
  const plan = ok(cli(['rollback', '--last', '--plan']));
  assert.equal(plan.mode, 'plan');
  assert.deepEqual(plan.plan.files.map((f) => f.dest), ['settings.json']);
  const r = ok(cli(['rollback', '--last']));
  assert.equal(r.mode, 'applied');
  assert.deepEqual(snap(), snapPre);
  assert.deepEqual(JSON.parse(read('settings.json')), { theme: 'dark', env: { USER_KEY: '1', ALPHA_KEY: '1' } });
  assert.equal(read('hooks/plain.sh'), 'my own edit\n');
  const s = stateOf();
  assert.equal(s.answers['p-alpha-hook'], undefined);
  assert.equal(s.files['hooks/plain.sh'].held, false);
  assert.equal(s.repo.tag, 'v1');
  const again = ok(cli(['apply']));
  assert.deepEqual(again.pending.map((p) => p.id), ['p-alpha-hook', 'p-beta-agent', 'p-gamma-add']);
});

test('apply accept all: --overwrite replaces the edit (backed up); new part registers its MCP server through the fake runner', () => {
  const j = ok(cli(['apply', '--proposals', 'p-alpha-hook,p-beta-agent,p-gamma-add', '--overwrite', 'hooks/plain.sh', '--confirm-risky', 'p-alpha-hook,p-gamma-add']));
  assert.equal(read('hooks/plain.sh'), 'echo plain v2\n');
  assert.match(read('agents/b.md'), /agent body v2/);
  assert.equal(read('tools/gamma.txt'), 'gamma is gee\n');
  const run = stateOf().runs.at(-1);
  assert.equal(fs.readFileSync(path.join(runDirOf(run, cfg), 'files', 'hooks', 'plain.sh'), 'utf8'), 'my own edit\n');
  assert.deepEqual(calls('mcp', 'get'), [['claude', 'mcp', 'get', 'gamma-mcp']]);
  assert.deepEqual(calls('mcp', 'add-json'), [['claude', 'mcp', 'add-json', 'gamma-mcp', '{"command":"node","args":["g.js"]}', '-s', 'user']]);
  assert.deepEqual(fakeGet().mcp['gamma-mcp'], { command: 'node', args: ['g.js'] });
  const s = stateOf();
  assert.deepEqual(s.mcp['gamma-mcp'], { part: 'gamma', prev: { $absent: true } });
  assert.equal(s.parts.gamma.installed, true);
  assert.deepEqual(j.result.steps.map((x) => x.text), ['Make a gamma account.', 'Set up gee on this PC.']);
  assert.ok(!calls('plugin').length);
  snapV2 = snap();
});

test('verify runs the installed parts checks', () => {
  const j = ok(cli(['verify']));
  assert.deepEqual(j.results.map((r) => [r.part, r.pass]), [['alpha', true], ['gamma', true]]);
});

test('rollback --to v1: plan, then apply restores the exact v1 tree, removes the MCP server, re-offers the proposals', () => {
  const plan = ok(cli(['rollback', '--to', 'v1', '--plan']));
  assert.equal(plan.plan.target_tag, 'v1');
  assert.ok(plan.plan.files.some((f) => f.dest === 'tools/gamma.txt' && f.action === 'delete'));
  assert.deepEqual(plan.plan.mcp.map((m) => [m.name, m.action]), [['gamma-mcp', 'remove']]);
  const r = ok(cli(['rollback', '--to', 'v1']));
  assert.deepEqual(r.result.mcp, [{ name: 'gamma-mcp', action: 'removed' }]);
  assert.deepEqual(calls('mcp', 'remove'), [['claude', 'mcp', 'remove', 'gamma-mcp', '-s', 'user']]);
  assert.deepEqual(fakeGet().mcp, {});
  assert.deepEqual(stateOf().mcp, {});
  assert.deepEqual(snap(), snapInstalled);
  const s = stateOf();
  assert.equal(s.repo.tag, 'v1');
  assert.equal(s.answers['p-alpha-hook'].answer, 'rolled-back');
  assert.equal(s.parts.gamma, undefined);
  assert.equal(JSON.parse(read('settings.json')).env.NEW_KEY, undefined);
  assert.equal(read('notes/user.txt'), 'user notes\r\n');
  assert.equal(read('skills/mine/SKILL.md'), 'my skill\n');
  const next = ok(cli(['apply']));
  assert.deepEqual(next.pending.map((p) => p.id), ['p-alpha-hook', 'p-beta-agent', 'p-gamma-add']);
});

test('undo of the rollback returns to the v2 tree and puts the MCP server back', () => {
  const r = ok(cli(['rollback', '--last']));
  assert.deepEqual(r.result.mcp, [{ name: 'gamma-mcp', action: 'added' }]);
  assert.deepEqual(snap(), snapV2);
  assert.deepEqual(fakeGet().mcp['gamma-mcp'], { command: 'node', args: ['g.js'] });
  const s = stateOf();
  assert.equal(s.repo.tag, 'v2');
  assert.equal(s.mcp['gamma-mcp'].part, 'gamma');
  assert.equal(s.answers['p-alpha-hook'].answer, 'accept');
});

test('MCP: a server that already exists is never overwritten; a failed add leaves no record', () => {
  const cfgB = path.join(root, 'config-mcp');
  write('settings.json', '{}\n', cfgB);
  const opts = { dir: cfgB };
  ok(cli(['bootstrap', '--repo', user], opts));
  fakeSet({ mcp: { 'gamma-mcp': { command: 'mine' } } });
  const before = calls('mcp', 'add-json').length;
  const p1 = cli(['plan', '--parts', 'gamma', '--repo', user], opts);
  assert.equal(p1.code, 0);
  assert.deepEqual(p1.json.parts[0].risky, ['/mcpServers/gamma-mcp']);
  const q = needsAnswer(cli(['install', '--parts', 'gamma', '--repo', user], opts));
  assert.equal(q[0].kind, 'risky');
  const j = ok(cli(['install', '--parts', 'gamma', '--confirm-risky', 'gamma', '--repo', user], opts));
  assert.equal(calls('mcp', 'add-json').length, before);
  assert.deepEqual(fakeGet().mcp['gamma-mcp'], { command: 'mine' });
  assert.deepEqual(stateOf(cfgB).mcp, {});
  assert.match(j.result.warnings.join('\n'), /already exists/);

  fakeSet({ mcp: {}, mcpFail: true });
  ok(cli(['install', '--parts', 'gamma', '--confirm-risky', 'gamma', '--repo', user], opts));
  assert.deepEqual(stateOf(cfgB).mcp, {});
  fakeSet({ mcpFail: false });
});

test('versions: tags with messages and the runs', () => {
  const j = ok(cli(['versions']));
  assert.deepEqual(j.tags.map((t) => [t.tag, t.message, t.current]), [['v2', 'Version two', true], ['v1', 'Version one', false]]);
  assert.ok(j.runs.length >= 6);
  assert.ok(j.runs.every((r) => ['apply', 'rollback'].includes(r.kind) && r.status));
  assert.ok(j.runs.some((r) => r.kind === 'rollback'));
  assert.equal(ok(cli(['rollback', '--runs', '2', '--plan'])).plan.undone_runs.length, 2);
});

test('a crashed run is reported by status, blocks apply, can be finished or undone', () => {
  const cfgC = path.join(root, 'config-crash');
  write('notes/mine.txt', 'mine\n', cfgC);
  const opts = { dir: cfgC };
  ok(cli(['bootstrap', '--repo', user], opts));
  const before = snap(cfgC);
  const crash = () => {
    const st = load(cfgC);
    const run = newRun(st, 'apply', null, c1, cfgC);
    save(st, cfgC);
    write('hooks/half.txt', 'half\n', cfgC);
    journal(runDirOf(run, cfgC), { ev: 'file', action: 'write', dest: 'hooks/half.txt', existed: false, backup: null, hashBefore: null, hashAfter: hashFile(path.join(cfgC, 'hooks/half.txt')) });
    st.files['hooks/half.txt'] = { hash: hashFile(path.join(cfgC, 'hooks/half.txt')), commit: c1, part: 'sync-engine', mode: 'managed', existed_before: false, backup: null, held: false };
    save(st, cfgC);
    return run;
  };
  const run = crash();
  const s = ok(cli(['status'], opts));
  assert.equal(s.crashed.run, run.id);
  const q = needsAnswer(cli(['apply', '--no-fetch'], opts));
  assert.equal(q[0].kind, 'crash');
  assert.deepEqual(q[0].options, ['finish', 'undo']);
  const plan = ok(cli(['rollback', '--crashed', '--plan'], opts));
  assert.deepEqual(plan.plan.files.map((f) => [f.dest, f.action]), [['hooks/half.txt', 'delete']]);
  ok(cli(['rollback', '--crashed'], opts));
  assert.deepEqual(snap(cfgC), before);
  assert.equal(ok(cli(['status'], opts)).crashed, null);

  const run2 = crash();
  const fin = ok(cli(['apply', '--no-fetch', '--crash', 'finish'], opts));
  assert.equal(fin.mode, 'plan');
  assert.equal(stateOf(cfgC).runs.find((r) => r.id === run2.id).status, 'done');
  assert.equal(ok(cli(['status'], opts)).crashed, null);
});

test('adopt: takes over a pack install (2 equal, 1 edited, rules/setup-pack folder), keeps the person files', () => {
  const plain = 'echo plain v1\n';
  const agent = '---\nname: b\nmodel: fable\n---\nagent body v1\n';
  const mig = [
    { pack: '01-rules/core.md', repo: null, installed_at: 'rules/setup-pack/core.md', sha256: sha('pack core rules\n') },
    { pack: '01-rules/other.md', repo: null, installed_at: 'rules/setup-pack/other.md', sha256: sha('original other\n') },
    { pack: '03-hooks/plain.sh', repo: 'payload/hooks/plain.sh', installed_at: 'hooks/plain.sh', sha256: sha(plain), sha256_lf: sha(plain) },
    { pack: '04-agents/b.md', repo: 'payload/agents/b.md', installed_at: 'agents/b.md', sha256: sha(agent), sha256_lf: sha(agent) },
    { pack: '03-hooks/alpha.js', repo: 'payload/hooks/alpha.js', installed_at: 'hooks/alpha.js', sha256: sha('const LABELS = {};\nmodule.exports = { LABELS };\n'), sha256_lf: sha('const LABELS = {};\nmodule.exports = { LABELS };\n') },
    { pack: '03-hooks/gone.sh', repo: 'payload/hooks/plain.sh', installed_at: 'hooks/gone.sh', sha256: 'x', sha256_lf: 'x' },
    { pack: '02-settings/frag.json', repo: 'payload/settings/alpha.json', installed_at: null, sha256: 'y', sha256_lf: 'y' },
  ];
  const cfgA = path.join(root, 'config-adopt');
  write('hooks/plain.sh', plain, cfgA);
  write('agents/b.md', agent, cfgA);
  write('hooks/alpha.js', 'const LABELS = {"mine":1};\nmodule.exports = { LABELS };\n', cfgA);
  write('rules/setup-pack/core.md', 'pack core rules\n', cfgA);
  write('rules/setup-pack/other.md', 'my edited other\n', cfgA);
  write('notes/mine.txt', 'mine\n', cfgA);
  write('settings.json', JSON.stringify({ theme: 'dark' }, null, 2) + '\n', cfgA);
  const pre = snap(cfgA);
  const opts = { dir: cfgA };
  write('migrations/pack-2026-11-21.json', JSON.stringify(mig, null, 2), owner);
  git(['add', '-A'], owner);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Add the migration map'], owner);
  git(['push', '-q', 'origin', 'main'], owner);
  git(['fetch', '-q', '--tags'], user);
  git(['merge', '-q', '--ff-only'], user);

  const j = ok(cli(['adopt', '--repo', user], { ...opts, exe: path.join(user, 'sync', 'sync.mjs') }));
  assert.equal(j.from, 'pack-2026-11-21');
  assert.deepEqual(j.report.managed.sort(), ['agents/b.md', 'hooks/plain.sh']);
  assert.deepEqual(j.report.held, ['hooks/alpha.js']);
  assert.deepEqual(j.edited_rules, ['rules/setup-pack/other.md']);
  const s = stateOf(cfgA);
  assert.equal(s.files['hooks/plain.sh'].held, false);
  assert.equal(s.files['hooks/plain.sh'].existed_before, false);
  assert.equal(s.files['hooks/plain.sh'].part, 'alpha');
  assert.equal(s.files['hooks/plain.sh'].hash, sha(plain));
  assert.equal(s.files['agents/b.md'].part, 'beta');
  assert.equal(s.files['hooks/alpha.js'].held, true);
  assert.equal(s.files['hooks/alpha.js'].hash, sha('const LABELS = {};\nmodule.exports = { LABELS };\n'));
  assert.equal(s.runs.at(-1).kind, 'adopt');
  assert.equal(s.runs.at(-1).status, 'done');
  assert.equal(exists('rules/setup-pack', cfgA), false);
  assert.equal(read('rules/claude-setup--core.md', cfgA), 'Core rule\n');
  assert.deepEqual(Object.keys(s.parts).sort(), ['alpha', 'beta', 'core-rules']);
  const backup = path.join(runDirOf(s.runs.at(-1), cfgA), 'files', 'rules', 'setup-pack', 'other.md');
  assert.equal(fs.readFileSync(backup, 'utf8'), 'my edited other\n');
  for (const k of ['hooks/plain.sh', 'agents/b.md', 'hooks/alpha.js', 'notes/mine.txt', 'settings.json']) assert.equal(snap(cfgA)[k], pre[k]);
  const undo = ok(cli(['rollback', '--last'], opts));
  assert.equal(undo.mode, 'applied');
  assert.deepEqual(snap(cfgA), pre);
});

test('skill-overrides: all 7 built-in names are kept, an uninstalled non-built-in skill is dropped, an installed one is kept', () => {
  const cfgS = path.join(root, 'config-skills');
  write('settings.json', '{}\n', cfgS);
  ok(cli(['install', '--parts', 'skill-overrides', '--repo', user], { dir: cfgS }));
  const o = JSON.parse(read('settings.json', cfgS)).skillOverrides;
  assert.deepEqual(Object.keys(o).sort(), ['fewer-permission-prompts', 'init', 'keybindings-help', 'plugin-authoring', 'schedule', 'security-review', 'simplify']);

  const cfgT = path.join(root, 'config-skills2');
  write('settings.json', '{}\n', cfgT);
  ok(cli(['install', '--parts', 'skill-overrides,skill-architecture', '--repo', user], { dir: cfgT }));
  const o2 = JSON.parse(read('settings.json', cfgT)).skillOverrides;
  assert.equal(o2.architecture, 'off');
  assert.ok(!('not-installed-skill' in o2));
  assert.equal(Object.keys(o2).length, 8);
  assert.ok(exists('skills/architecture/SKILL.md', cfgT));
});

test('planPart keeps the 7 built-in skill names for any caller (library level)', () => {
  const cfgL = path.join(root, 'config-lib');
  write('settings.json', '{}\n', cfgL);
  const e = entry('skill-overrides', { settings: ['payload/settings/skill-overrides.json'] });
  const plan = planPart(e, { repo: user, commit: c1, state: load(cfgL), configDir: cfgL, home: path.join(root, 'home'), merge, installedSkills: new Set(['architecture']) });
  const keys = Object.keys(plan.settings[0].fragment.skillOverrides).sort();
  assert.deepEqual(keys, ['architecture', 'fewer-permission-prompts', 'init', 'keybindings-help', 'plugin-authoring', 'schedule', 'security-review', 'simplify']);
});

test('engine update: reported alone, blocks apply, installs alone, then sync continues', () => {
  write('sync/INTERFACES.md', `${fs.readFileSync(path.join(owner, 'sync', 'INTERFACES.md'), 'utf8')}\nEngine v3 note.\n`, owner);
  release('Version three', 'v3');
  assert.equal(ok(cli(['status'])).engine_update, false);
  const j = ok(cli(['apply']));
  assert.equal(j.engine.update, true);
  assert.deepEqual(j.engine.files, ['tools/claude-setup/sync/INTERFACES.md']);
  assert.deepEqual(j.pending, []);
  const q = needsAnswer(cli(['apply', '--proposals', 'p-alpha-hook']));
  assert.equal(q[0].kind, 'engine-update');
  assert.equal(ok(cli(['status'])).engine_update, true);
  const up = ok(cli(['apply', '--update-engine']));
  assert.equal(up.updated, true);
  assert.match(read('tools/claude-setup/sync/INTERFACES.md'), /Engine v3 note\./);
  const after = ok(cli(['apply']));
  assert.equal(after.engine.update, false);
  assert.equal(after.repo.tag, 'v3');
  assert.equal(stateOf().parts['sync-engine'].at_commit, git(['rev-parse', 'HEAD'], user));
});

test('settings conflicts are planned and skipped unless accepted; ask-alone, missing parts and unmet needs stop install', () => {
  const cfgX = path.join(root, 'config-conflict');
  write('settings.json', JSON.stringify({ env: { NEW_KEY: '9' } }, null, 2) + '\n', cfgX);
  const opts = { dir: cfgX };
  ok(cli(['bootstrap', '--repo', user], opts));
  const qb = needsAnswer(cli(['install', '--parts', 'bypass'], opts));
  assert.deepEqual([qb[0].kind, qb[0].ask_alone, qb[0].pointers, qb[0].risk], ['risky', true, ['/permissions/defaultMode'], 'Runs every command without asking.']);
  const qm = needsAnswer(cli(['install', '--parts', 'epsilon'], opts));
  assert.deepEqual([qm[0].kind, qm[0].missing], ['missing-parts', [{ part: 'epsilon', requires: 'alpha' }]]);
  const bad = cli(['install', '--parts', 'delta'], opts);
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /delta: needs cmd:no-such-command-xyz/);
  const plan = ok(cli(['plan', '--parts', 'alpha'], opts));
  assert.deepEqual(plan.parts[0].settings_conflicts, [{ pointer: '/env/NEW_KEY', current: '9', wanted: '2', accepted: false }]);

  const first = snap(cfgX);
  const j = ok(cli(['install', '--parts', 'alpha,epsilon', '--confirm-risky', 'alpha'], opts));
  assert.deepEqual(j.result.settings_skipped, ['/env/NEW_KEY']);
  assert.deepEqual(JSON.parse(read('settings.json', cfgX)).env, { NEW_KEY: '9', ALPHA_KEY: '1' });
  assert.deepEqual(Object.keys(stateOf(cfgX).parts).sort(), ['alpha', 'epsilon', 'sync-engine']);
  assert.notDeepEqual(snap(cfgX), first);

  ok(cli(['install', '--parts', 'alpha', '--confirm-risky', 'alpha', '--accept-settings', '/env/NEW_KEY'], opts));
  assert.deepEqual(JSON.parse(read('settings.json', cfgX)).env, { NEW_KEY: '2', ALPHA_KEY: '1' });
  ok(cli(['rollback', '--last'], opts));
  assert.deepEqual(JSON.parse(read('settings.json', cfgX)).env, { NEW_KEY: '9', ALPHA_KEY: '1' });
});

test('a remove proposal uninstalls its part: local edits ask, kept files stay, rollback brings it back', () => {
  proposal('p-remove-beta', { title: 'Remove beta', kind: 'remove', part: 'beta', touches: ['agents/b.md', 'rules/claude-setup--beta.md'] });
  release('Version four', 'v4');
  const plan = ok(cli(['apply', '--cards']));
  assert.deepEqual(plan.pending.map((p) => p.id), ['p-remove-beta']);
  assert.match(plan.pending[0].card, /agents\/b\.md \(removed\)/);
  assert.match(plan.pending[0].card, /rules\/claude-setup--beta\.md \(removed\)/);

  write('rules/claude-setup--beta.md', 'my own beta rule\n', cfg);
  const pre = snap();
  const q = needsAnswer(cli(['apply', '--proposals', 'p-remove-beta']));
  assert.deepEqual(q.map((x) => [x.kind, x.dest]), [['local-edit-remove', 'rules/claude-setup--beta.md']]);
  assert.deepEqual(snap(), pre);

  const j = ok(cli(['apply', '--proposals', 'p-remove-beta', '--answers', 'rules/claude-setup--beta.md=keep']));
  assert.deepEqual(j.result.removed, ['agents/b.md']);
  assert.deepEqual(j.result.kept, ['rules/claude-setup--beta.md']);
  assert.equal(exists('agents/b.md'), false);
  assert.equal(read('rules/claude-setup--beta.md'), 'my own beta rule\n');
  const s = stateOf();
  assert.equal(s.parts.beta, undefined);
  assert.equal(s.files['agents/b.md'], undefined);
  assert.equal(s.files['rules/claude-setup--beta.md'], undefined);
  assert.equal(s.answers['p-remove-beta'].answer, 'accept');

  ok(cli(['rollback', '--last']));
  assert.deepEqual(snap(), pre);
  assert.equal(stateOf().parts.beta.installed, true);
  assert.equal(stateOf().answers['p-remove-beta'], undefined);
});

test('text output without --json is readable', () => {
  const text = (args) => {
    const r = spawnSync(process.execPath, [engineCli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, CLAUDE_SETUP_TEST_HOME: path.join(root, 'home'), CLAUDE_SETUP_TEST_FAKE: fake, CLAUDE_CONFIG_DIR: cfg } });
    return { code: r.status, out: r.stdout };
  };
  const s = text(['status']);
  assert.equal(s.code, 0);
  assert.match(s.out, /Parts installed: \d+/);
  const a = text(['apply']);
  assert.equal(a.code, 0);
  assert.match(a.out, /Remove beta/);
  assert.match(text(['catalog']).out, /\[installed\] alpha/);
  const bad = text(['rollback']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^Error: rollback needs/);
});

test('plan --parts is compact unless --cards is given; many new text files are collapsed but code is always shown', () => {
  const cfgZ = path.join(root, 'config-zeta');
  write('settings.json', '{}\n', cfgZ);
  const lean = ok(cli(['plan', '--parts', 'zeta', '--repo', user], { dir: cfgZ }));
  assert.ok(!('card' in lean.parts[0]));
  assert.equal(lean.cards_omitted, true);
  assert.equal(lean.parts[0].files.length, 13);
  const full = ok(cli(['plan', '--parts', 'zeta', '--cards', '--repo', user], { dir: cfgZ }));
  const card = full.parts[0].card;
  assert.match(card, /skills\/zeta\/run\.js \(new file\)/);
  assert.equal((card.match(/\.md \(new file\)/g) || []).length, 8);
  assert.match(card, /4 more new text files are not shown here/);
  assert.equal(fs.existsSync(path.join(cfgZ, 'skills')), false);
});
