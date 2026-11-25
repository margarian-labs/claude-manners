import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashFile, walk } from '../../sync/lib/fsx.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLD = process.env.UPGRADE_FROM || '2665c98';
const SAVED = { ...process.env };
const ENV_KEYS = ['CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const FORWARDER = fs.readFileSync(path.join(PROJECT, 'payload', 'legacy', 'sync.mjs'));
const NO_WAY = /rollback cannot go back past the rename/;
const OLD_SYNC = 'tools/claude-setup/sync/sync.mjs';
const NEW_SYNC = 'tools/claude-manners/sync/sync.mjs';
const PART = { alpha: 'alpha', beta: 'beta', core: 'core-rules', delta: 'delta' };
const LINE = { alpha: 'Alpha rule.', beta: 'Beta rule v1.', core: 'Core rule.', delta: 'Delta rule.' };

const run = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const oldTree = (() => {
  try {
    run(['cat-file', '-e', `${OLD}^{commit}`], PROJECT);
    return run(['ls-tree', '-r', '--name-only', OLD, '--', 'sync'], PROJECT).split('\n').filter(Boolean)
      .map((n) => [n, execFileSync('git', ['show', `${OLD}:${n}`], { cwd: PROJECT, maxBuffer: 64 << 20 })]);
  } catch {
    return null;
  }
})();
const t = (name, fn) => test(name, oldTree ? {} : { skip: `commit ${OLD} (the old engine) is not in this clone, so no upgrade can be tested` }, fn);

let root;
let cfg;
let origin;
let owner;
let user;
let fake;
let c3;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const at = (dir, rel) => path.join(dir, ...rel.split('/'));
const read = (rel, dir = cfg) => fs.readFileSync(at(dir, rel));
const exists = (rel, dir = cfg) => fs.existsSync(at(dir, rel));
const write = (rel, data, base = owner) => {
  fs.mkdirSync(path.dirname(at(base, rel)), { recursive: true });
  fs.writeFileSync(at(base, rel), data);
};
const ruleNames = (dir = cfg) => fs.readdirSync(at(dir, 'rules')).filter((n) => n.startsWith('claude-')).sort();
const stateOf = (dir = cfg, name = 'claude-manners') => JSON.parse(fs.readFileSync(at(dir, `state/${name}/state.json`), 'utf8'));
const snap = (dir = cfg, skip = () => false) => Object.fromEntries(walk(dir).filter((r) => !skip(r)).map((r) => [r, sha(read(r, dir))]));
const outsideState = (dir = cfg) => snap(dir, (r) => r.startsWith('state/'));
const showAt = (ref, p) => execFileSync('git', ['show', `${ref}:${p}`], { cwd: owner, maxBuffer: 64 << 20 });
const oldExe = (dir) => path.join(dir, 'tools', 'claude-setup', 'sync', 'sync.mjs');
const newExe = (dir) => path.join(dir, 'tools', 'claude-manners', 'sync', 'sync.mjs');

function cli(args, { dir = cfg, exe }) {
  const env = { ...process.env, CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, CLAUDE_SETUP_TEST_HOME: path.join(root, 'home'), CLAUDE_SETUP_TEST_FAKE: fake, CLAUDE_CONFIG_DIR: dir };
  delete env.CLAUDE_SETUP_LEGACY_ENTRY;
  const r = spawnSync(process.execPath, [exe, ...args, '--json'], { encoding: 'utf8', env });
  try {
    return { code: r.status, json: JSON.parse(r.stdout) };
  } catch {
    throw new Error(`not JSON (exit ${r.status}): ${r.stdout}\n${r.stderr}`);
  }
}
const oldCli = (args, dir = cfg) => cli(args, { dir, exe: oldExe(dir) });
const newCli = (args, dir = cfg) => cli(args, { dir, exe: newExe(dir) });
const ok = (r) => {
  assert.equal(r.code, 0, JSON.stringify(r.json, null, 1));
  return r.json;
};
const fails = (r, re) => {
  assert.equal(r.code, 1, JSON.stringify(r.json));
  assert.match(r.json.error, re);
};

const entry = (id, extra) => ({
  id, title: id, group: 'tools', level: 'optional', summary: `The ${id} part.`, details: `The ${id} part does one small thing for the tests, and changes only the files it lists.`, use: 'auto', trigger: '', needs: [], files: [], settings: [], rules: [], mcp: [], plugins: [], values: [],
  user_steps: [], machine_steps: [], verify: [], tokens_always_on: { value: null, how: 'not measured yet' }, quality: 'tried', risk: 'Test part, no code runs.', ask_alone: false, license: null, ...extra,
});
const putEntry = (e) => write(`catalog/${e.id}.json`, JSON.stringify(e, null, 2));
const ruleText = (n, brand, line = LINE[n]) => [
  `<!-- ${brand} part: ${PART[n]} -->`, '', `# ${brand} rules: ${PART[n]}`, '',
  `Installed by ${brand} into ~/.claude/rules/ and loaded every session. ${line}`, '', '| Desktop/code/claude-setup | General |', '',
].join('\n');
const proposal = (id, part, touches) => write(`proposals/${id}.md`, [
  '---', `id: ${id}`, `title: ${id}`, 'kind: change', 'level: recommended', `part: ${part}`, 'touches:', ...touches.map((x) => `  - ${x}`),
  'tokens_always_on: "+10"', 'quality: tried', 'risk: Test change, no code runs.', 'undo: Roll back to the previous version.', '---', '',
  '## What changes', '', 'Something changes.', '', '## Why', '', 'Because the test needs it.', '',
].join('\n'));
const release = (msg, tag) => {
  run(['add', '-A'], owner);
  run(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], owner);
  run(['tag', '-a', tag, '-m', msg], owner);
  run(['push', '-q', 'origin', 'main', '--tags'], owner);
  return run(['rev-parse', 'HEAD'], owner);
};
const parts = (brand) => ({
  alpha: entry('alpha', { group: 'hooks', files: [{ src: 'payload/hooks/plain.sh', dest: 'hooks/plain.sh', mode: 'managed' }], rules: [`payload/rules/${brand}--alpha.md`] }),
  beta: entry('beta', { group: 'agents', rules: [`payload/rules/${brand}--beta.md`] }),
  core: entry('core-rules', { group: 'rules', level: 'recommended', rules: [`payload/rules/${brand}--core.md`] }),
});
const engineOld = entry('sync-engine', {
  group: 'tools', level: 'recommended', needs: ['cmd:node', 'cmd:git'],
  files: [{ src: 'sync', dest: 'tools/claude-setup/sync', mode: 'managed' }, { src: 'sync/skill', dest: 'skills/claude-setup-sync', mode: 'managed' }],
});

function releaseV3() {
  fs.rmSync(at(owner, 'sync'), { recursive: true, force: true });
  fs.cpSync(path.join(PROJECT, 'sync'), at(owner, 'sync'), { recursive: true });
  fs.copyFileSync(path.join(PROJECT, 'catalog', 'sync-engine.json'), at(owner, 'catalog/sync-engine.json'));
  write('payload/legacy/sync.mjs', FORWARDER);
  for (const n of ['alpha', 'beta', 'core']) {
    run(['mv', `payload/rules/claude-setup--${n}.md`, `payload/rules/claude-manners--${n}.md`], owner);
    write(`payload/rules/claude-manners--${n}.md`, ruleText(n, 'claude-manners', n === 'beta' ? 'Beta rule v2.' : undefined));
  }
  write('payload/rules/claude-manners--delta.md', ruleText('delta', 'claude-manners'));
  for (const e of [...Object.values(parts('claude-manners')), entry('delta', { group: 'tools', rules: ['payload/rules/claude-manners--delta.md'] })]) putEntry(e);
  proposal('p-engine-rename', 'sync-engine', ['tools/claude-manners/sync/']);
  proposal('p-alpha-3', 'alpha', ['rules/claude-manners--alpha.md']);
  proposal('p-beta-3', 'beta', ['rules/claude-manners--beta.md']);
  proposal('p-core-3', 'core-rules', ['rules/claude-manners--core.md']);
  c3 = release('Version three', 'v3');
}

const toHead = (clone) => {
  run(['fetch', '-q', '--tags'], clone);
  run(['merge', '-q', '--ff-only'], clone);
};

function oldInstall(name, partIds = 'alpha,beta,core-rules') {
  const dir = path.join(root, `cfg-${name}`);
  const clone = path.join(root, `user-${name}`);
  run(['clone', '-q', '-c', 'core.autocrlf=false', '--branch', 'main', origin, clone], root);
  run(['reset', '-q', '--hard', 'v2'], clone);
  run(['config', 'core.autocrlf', 'false'], clone);
  ok(cli(['bootstrap', '--repo', clone], { dir, exe: path.join(clone, 'sync', 'sync.mjs') }));
  if (partIds) ok(oldCli(['install', '--parts', partIds], dir));
  return { dir, clone };
}

function adoptInstall(name) {
  const dir = path.join(root, `cfg-${name}`);
  const clone = path.join(root, `user-${name}`);
  run(['clone', '-q', '-c', 'core.autocrlf=false', '--branch', 'main', origin, clone], root);
  run(['reset', '-q', '--hard', 'v2'], clone);
  run(['config', 'core.autocrlf', 'false'], clone);
  write('hooks/plain.sh', 'echo plain v1\n', dir);
  write('rules/setup-pack/core.md', 'pack core rules\n', dir);
  write('notes/mine.txt', 'mine\n', dir);
  ok(cli(['bootstrap', '--repo', clone], { dir, exe: path.join(clone, 'sync', 'sync.mjs') }));
  ok(oldCli(['adopt', '--repo', clone], dir));
  toHead(clone);
  return { dir, clone };
}

before(() => {
  if (!oldTree) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-upg-'));
  Object.assign(process.env, { CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  cfg = path.join(root, 'config');
  origin = path.join(root, 'origin.git');
  owner = path.join(root, 'owner');
  user = path.join(root, 'user');
  fake = path.join(root, 'fake-claude.json');
  fs.writeFileSync(fake, JSON.stringify({ version: '2.1.100 (Claude Code)', fable: false, mcp: {}, calls: [] }));
  fs.mkdirSync(owner, { recursive: true });
  run(['init', '-q', '--bare', '-b', 'main', origin], root);
  run(['init', '-q', '-b', 'main'], owner);
  run(['config', 'core.autocrlf', 'false'], owner);
  run(['remote', 'add', 'origin', origin], owner);

  for (const [n, data] of oldTree) write(n, data);
  write('payload/hooks/plain.sh', 'echo plain v1\n');
  for (const n of ['alpha', 'beta', 'core']) write(`payload/rules/claude-setup--${n}.md`, ruleText(n, 'claude-setup'));
  for (const e of [engineOld, ...Object.values(parts('claude-setup'))]) putEntry(e);
  const plain = sha('echo plain v1\n');
  write('migrations/pack-2026-11-21.json', JSON.stringify([
    { pack: '03-hooks/plain.sh', repo: 'payload/hooks/plain.sh', installed_at: 'hooks/plain.sh', sha256: plain, sha256_lf: plain },
    { pack: '01-rules/core.md', repo: null, installed_at: 'rules/setup-pack/core.md', sha256: sha('pack core rules\n') },
  ]));
  proposal('p-v1-note', 'alpha', ['hooks/plain.sh']);
  release('Version one', 'v1');
  write('payload/hooks/plain.sh', 'echo plain v2\n');
  write('payload/rules/claude-setup--beta.md', ruleText('beta', 'claude-setup', 'Beta rule v2.'));
  proposal('p-alpha-2', 'alpha', ['hooks/plain.sh']);
  proposal('p-beta-2', 'beta', ['rules/claude-setup--beta.md']);
  release('Version two', 'v2');

  run(['clone', '-q', '-c', 'core.autocrlf=false', '--branch', 'main', origin, user], root);
  run(['reset', '-q', '--hard', 'v1'], user);
  run(['config', 'core.autocrlf', 'false'], user);
  ok(cli(['bootstrap', '--repo', user], { exe: path.join(user, 'sync', 'sync.mjs') }));
  ok(oldCli(['install', '--parts', 'alpha,beta,core-rules']));
  fs.appendFileSync(at(cfg, 'rules/claude-setup--beta.md'), 'my beta edit\n');
  ok(oldCli(['apply', '--proposals', 'p-alpha-2,p-beta-2', '--keep', 'rules/claude-setup--beta.md']));
  fs.appendFileSync(at(cfg, 'rules/claude-setup--alpha.md'), 'my alpha edit\n');
  write('rules/mine.md', '# my rule\nsee rules/claude-setup--core.md\n', cfg);
  write('CLAUDE.md', '# Notes\nRun node ~/.claude/tools/claude-setup/sync/sync.mjs status\nmy claude-setup clone\nUse the claude-setup-sync skill\n', cfg);
  write('settings.json', '{\n  "theme": "dark",\n  "cmd": "node ~/.claude/tools/claude-setup/sync/sync.mjs status"\n}\n', cfg);
  write('notes/n.txt', 'plain notes\r\n', cfg);
  write('state/claude-setup/privacy-words.txt', 'secret\n', cfg);
});

after(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

t('1. the old engine sees the engine update at the new HEAD, changes nothing until told, then writes the new tool and the forwarder last', () => {
  releaseV3();
  toHead(user);
  const before = snap();
  assert.equal(ok(oldCli(['status'])).engine_update, true);
  assert.deepEqual(snap(), before);
  const plan = ok(oldCli(['apply']));
  assert.equal(plan.engine.update, true);
  assert.ok(plan.engine.files.includes(NEW_SYNC));
  assert.ok(plan.engine.files.includes('skills/claude-manners-sync/SKILL.md'));
  assert.equal(plan.engine.files.at(-1), OLD_SYNC);
  assert.deepEqual(snap(), before);

  assert.equal(ok(oldCli(['apply', '--update-engine'])).updated, true);
  assert.deepEqual(read(OLD_SYNC), FORWARDER);
  assert.deepEqual(read(NEW_SYNC), fs.readFileSync(path.join(PROJECT, 'sync', 'sync.mjs')));
  assert.deepEqual(read('skills/claude-manners-sync/SKILL.md'), fs.readFileSync(path.join(PROJECT, 'sync', 'skill', 'SKILL.md')));
  assert.ok(exists('tools/claude-setup/sync/lib/state.mjs'));
  assert.ok(exists('skills/claude-setup-sync/SKILL.md'));
  assert.ok(exists('state/claude-setup/state.json'));
  assert.equal(exists('state/claude-manners'), false);
});

t('2. status through the old path migrates once: nothing lost, every old run byte for byte, no proposal rewrites a renamed rule', () => {
  const pre = snap();
  const preRule = (n) => read(`rules/claude-setup--${n}.md`);
  const [alpha, beta] = [preRule('alpha'), preRule('beta')];
  const own = ['CLAUDE.md', 'settings.json', 'rules/mine.md', 'notes/n.txt'];
  const r = ok(oldCli(['status']));
  const rep = r.renamed;
  assert.ok(rep, 'data.renamed is missing');
  const s = stateOf();
  const post = snap();

  assert.equal(exists('state/claude-setup'), false);
  assert.deepEqual(ruleNames(), ['claude-manners--alpha.md', 'claude-manners--beta.md', 'claude-manners--core.md']);
  assert.deepEqual(read('rules/claude-manners--core.md'), showAt(c3, 'payload/rules/claude-manners--core.md'));
  assert.deepEqual(read('rules/claude-manners--alpha.md'), alpha);
  assert.deepEqual(read('rules/claude-manners--beta.md'), beta);
  assert.equal(s.files['rules/claude-manners--core.md'].hash, hashFile(at(cfg, 'rules/claude-manners--core.md')));
  assert.equal(s.files['rules/claude-manners--beta.md'].held, true);
  assert.equal(Object.keys(s.files).some((k) => /^(rules\/claude-setup--|tools\/claude-setup|skills\/claude-setup-sync)/.test(k)), false);
  const resolve = (b) => (path.isAbsolute(b) ? b : at(cfg, b));
  for (const f of Object.values(s.files)) if (f.backup) assert.ok(fs.existsSync(resolve(f.backup)), f.backup);
  for (const x of s.runs) assert.ok(fs.existsSync(resolve(x.backup)), x.backup);
  for (const [k, v] of Object.entries(pre)) if (k.startsWith('state/claude-setup/backups/')) assert.equal(post[k.replace('state/claude-setup', 'state/claude-manners')], v, k);
  assert.equal(exists('tools/claude-setup/sync/lib/state.mjs'), false);
  assert.equal(exists('skills/claude-setup-sync'), false);
  assert.deepEqual(read(OLD_SYNC), FORWARDER);
  for (const k of own) assert.equal(post[k], pre[k], k);
  assert.equal(read('state/claude-manners/privacy-words.txt').toString(), 'secret\n');
  assert.deepEqual([...rep.rules_moved].sort(), ['alpha', 'beta', 'core'].map((n) => `rules/claude-manners--${n}.md`));
  assert.deepEqual([...rep.edited_text_kept].sort(), ['rules/claude-manners--alpha.md', 'rules/claude-manners--beta.md']);
  assert.deepEqual(rep.old_files_left, []);
  assert.deepEqual([...rep.mentions].sort(), ['CLAUDE.md:2', 'CLAUDE.md:4', 'rules/mine.md:2', 'settings.json:3']);
  assert.deepEqual([r.last_run.kind, r.last_run.status], ['rename', 'done']);

  const ap = ok(oldCli(['apply']));
  assert.equal(ap.engine.update, false);
  assert.deepEqual(ap.pending.map((p) => p.id).sort(), ['p-alpha-3', 'p-beta-3', 'p-core-3']);
  for (const p of ap.pending) assert.deepEqual(p.files.filter((f) => f.dest.startsWith('rules/')), [], p.id);
  const by = Object.fromEntries(ap.pending.map((p) => [p.id, p]));
  assert.equal(by['p-core-3'].noop, true);
  assert.deepEqual(by['p-alpha-3'].questions.map((q) => [q.kind, q.dest]), [['local-edit', 'rules/claude-manners--alpha.md']]);
  assert.deepEqual(by['p-beta-3'].held, ['rules/claude-manners--beta.md']);
  assert.deepEqual(snap(), post);
});

t('3. a second status through the old path is quiet; the first one from the new path reports once and removes the forwarder', () => {
  assert.equal('renamed' in ok(oldCli(['status'])), false);
  assert.ok(exists(OLD_SYNC));
  const first = ok(newCli(['status']));
  assert.ok(first.renamed);
  assert.equal(exists(OLD_SYNC), false);
  assert.equal(exists('tools/claude-setup'), false);
  assert.equal('renamed' in ok(newCli(['status'])), false);
});

t('4. every way back past the rename is refused and changes nothing', () => {
  const before = snap();
  const cases = [
    [['--last'], NO_WAY], [['--last', '--plan'], NO_WAY], [['--runs', '1'], NO_WAY], [['--runs', '1', '--plan'], NO_WAY], [['--runs', '3'], NO_WAY],
    [['--redo'], /nothing to redo/], [['--crashed'], /no crashed run/],
    [['--to', 'v1'], NO_WAY], [['--to', 'v1', '--plan'], NO_WAY], [['--to', 'v2'], NO_WAY], [['--to', 'v2', '--plan'], NO_WAY],
  ];
  for (const [flags, re] of cases) fails(newCli(['rollback', ...flags]), re);
  assert.deepEqual(snap(), before);
});

t('5. after the rename a later release applies, asks about the edited rule, rolls back to the exact tree, redoes, and goes to v3', () => {
  write('payload/hooks/plain.sh', 'echo plain v3\n');
  write('payload/rules/claude-manners--core.md', ruleText('core', 'claude-manners', 'Core rule v4.'));
  proposal('p-alpha-4', 'alpha', ['hooks/plain.sh']);
  proposal('p-core-4', 'core-rules', ['rules/claude-manners--core.md']);
  release('Version four', 'v4');
  const pre = outsideState();
  const q = newCli(['apply', '--proposals', 'p-alpha-4,p-core-4']);
  assert.equal(q.code, 2);
  assert.deepEqual(q.json.questions.map((x) => [x.kind, x.dest, x.options.join()]), [['local-edit', 'rules/claude-manners--alpha.md', 'keep,overwrite']]);
  assert.deepEqual(outsideState(), pre);

  ok(newCli(['apply', '--proposals', 'p-alpha-4,p-core-4', '--overwrite', 'rules/claude-manners--alpha.md']));
  assert.deepEqual(read('rules/claude-manners--alpha.md'), showAt('v4', 'payload/rules/claude-manners--alpha.md'));
  assert.deepEqual(read('rules/claude-manners--core.md'), showAt('v4', 'payload/rules/claude-manners--core.md'));
  assert.equal(read('hooks/plain.sh').toString(), 'echo plain v3\n');
  const post = outsideState();

  const back = ok(newCli(['rollback', '--last']));
  assert.deepEqual(back.result.warnings, []);
  assert.deepEqual(outsideState(), pre);
  ok(newCli(['rollback', '--redo']));
  assert.deepEqual(outsideState(), post);

  const to = ok(newCli(['rollback', '--to', 'v3', '--answers', 'rules/claude-manners--beta.md=keep']));
  assert.equal(to.mode, 'applied');
  assert.equal(stateOf().repo.tag, 'v3');
  assert.deepEqual(read('rules/claude-manners--core.md'), showAt('v3', 'payload/rules/claude-manners--core.md'));
  assert.equal(read('hooks/plain.sh').toString(), 'echo plain v2\n');
  assert.equal(sha(read('rules/claude-manners--beta.md')), pre['rules/claude-manners--beta.md']);
  assert.match(read('rules/claude-manners--beta.md').toString(), /my beta edit/);
  assert.deepEqual(ok(newCli(['apply'])).pending.map((p) => p.id).filter((id) => /-4$/.test(id)).sort(), ['p-alpha-4', 'p-core-4']);
});

t('6. an old engine that installs at the new HEAD before its update leaves both rule names; the migration keeps each rule once', () => {
  const { dir, clone } = oldInstall('mixed');
  toHead(clone);
  ok(oldCli(['install', '--parts', 'delta,alpha'], dir));
  assert.ok(exists('rules/claude-setup--alpha.md', dir) && exists('rules/claude-manners--alpha.md', dir));
  assert.equal(ok(oldCli(['apply', '--update-engine'], dir)).updated, true);
  const r = ok(oldCli(['status'], dir));
  assert.ok(r.renamed);
  assert.deepEqual(ruleNames(dir), ['claude-manners--alpha.md', 'claude-manners--beta.md', 'claude-manners--core.md', 'claude-manners--delta.md']);
  assert.deepEqual(read('rules/claude-manners--alpha.md', dir), showAt('v4', 'payload/rules/claude-manners--alpha.md'));
  assert.deepEqual(read('rules/claude-manners--delta.md', dir), showAt('v4', 'payload/rules/claude-manners--delta.md'));
  const s = stateOf(dir);
  assert.equal(Object.keys(s.files).filter((k) => /claude-setup/.test(k)).length, 0);
  for (const f of Object.keys(s.files).filter((k) => k.startsWith('rules/'))) assert.equal(s.files[f].hash, hashFile(at(dir, f)), f);
  const backups = Object.entries(snap(dir, (x) => !x.startsWith('state/claude-manners/backups/'))).map(([, v]) => v);
  assert.ok(backups.includes(sha(ruleText('alpha', 'claude-setup'))), 'the removed old alpha rule has no backup');
});

for (const gone of [false, true]) {
  t(`7. an adopted install, updated and migrated: repair ${gone ? 'rewrites a deleted rule under the new name' : 'has nothing to write'}`, () => {
    const { dir } = adoptInstall(gone ? 'adopt-gone' : 'adopt');
    assert.ok(exists('rules/claude-setup--core.md', dir) && exists('rules/claude-setup--alpha.md', dir));
    if (gone) fs.rmSync(at(dir, 'rules/claude-setup--core.md'));
    ok(oldCli(['apply', '--update-engine'], dir));
    const first = ok(newCli(['status'], dir));
    assert.ok(first.renamed);
    assert.equal(first.files_check, 'pending');
    const plan = ok(newCli(['repair', '--plan'], dir));
    assert.deepEqual(plan.files.map((f) => [f.dest, f.why]), gone ? [['rules/claude-manners--core.md', 'restore-missing']] : []);
    assert.deepEqual(ruleNames(dir).filter((n) => n.startsWith('claude-setup--')), []);
    if (gone) {
      ok(newCli(['repair'], dir));
      assert.equal(read('rules/claude-manners--core.md', dir).toString(), ruleText('core', 'claude-manners'));
      assert.deepEqual(ruleNames(dir), ['claude-manners--alpha.md', 'claude-manners--core.md']);
    }
    assert.equal(ok(newCli(['status'], dir)).files_check, 'done');
  });
}

t('8. a run the old engine left unfinished is reported after the migration, cannot be undone past it, and can be finished', () => {
  const { dir, clone } = oldInstall('crash', 'core-rules');
  toHead(clone);
  ok(oldCli(['apply', '--update-engine'], dir));
  const file = at(dir, 'state/claude-setup/state.json');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  st.runs.at(-1).status = 'started';
  const crashed = st.runs.at(-1).id;
  fs.writeFileSync(file, `${JSON.stringify(st, null, 2)}\n`);
  const r = ok(oldCli(['status'], dir));
  assert.ok(r.renamed);
  assert.deepEqual([r.crashed.run, r.crashed.kind], [crashed, 'apply']);
  assert.ok(ok(newCli(['status'], dir)).crashed);
  const before = snap(dir);
  fails(newCli(['rollback', '--crashed'], dir), NO_WAY);
  assert.deepEqual(snap(dir), before);
  ok(newCli(['apply', '--no-fetch', '--crash', 'finish'], dir));
  assert.equal(ok(newCli(['status'], dir)).crashed, null);
  assert.equal(stateOf(dir).runs.find((x) => x.id === crashed).status, 'done');
});

t('9. a fresh bootstrap by the new engine on an empty config has the new layout only', () => {
  const dir = path.join(root, 'cfg-fresh');
  const clone = path.join(root, 'user-fresh');
  run(['clone', '-q', '-c', 'core.autocrlf=false', '--branch', 'main', origin, clone], root);
  const r = ok(cli(['bootstrap', '--repo', clone], { dir, exe: path.join(clone, 'sync', 'sync.mjs') }));
  assert.equal(r.engine, newExe(dir));
  assert.ok(exists(NEW_SYNC, dir) && exists('skills/claude-manners-sync/SKILL.md', dir) && exists('state/claude-manners/state.json', dir));
  for (const k of ['tools/claude-setup', 'skills/claude-setup-sync', 'state/claude-setup']) assert.equal(exists(k, dir), false, k);
  assert.equal(Object.keys(stateOf(dir).files).some((k) => /claude-setup/.test(k)), false);
  assert.equal('renamed' in ok(newCli(['status'], dir)), false);

  const lone = path.join(root, 'cfg-lone');
  write(OLD_SYNC, FORWARDER, lone);
  fails(cli(['status'], { dir: lone, exe: oldExe(lone) }), /moved to tools\/claude-manners\/sync and is missing there/);
});

t('10. the old catalog check accepts every catalog entry of this project', async () => {
  const dir = fs.mkdtempSync(path.join(root, 'oldcat-'));
  const src = oldTree.find(([n]) => n === 'sync/lib/catalog.mjs')[1];
  assert.equal(/from '\.\//.test(src.toString()), false, 'the old catalog check imports a sibling file');
  fs.writeFileSync(path.join(dir, 'catalog.mjs'), src);
  const { validateEntry } = await import(pathToFileURL(path.join(dir, 'catalog.mjs')).href);
  const entries = fs.readdirSync(path.join(PROJECT, 'catalog')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(PROJECT, 'catalog', f), 'utf8')));
  assert.ok(entries.length > 40);
  const ids = new Set(entries.map((e) => e.id));
  assert.deepEqual(entries.map((e) => [e.id, validateEntry(e, ids)]).filter(([, errs]) => errs.length), []);
});
