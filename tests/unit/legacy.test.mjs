import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { aliasRule, beforeRename, isForwarderSrc, migrate, renameBytes } from '../../sync/lib/legacy.mjs';
import { bytesFor, destKey, expandFiles } from '../../sync/lib/install.mjs';
import { hashBuffer, hashFile } from '../../sync/lib/fsx.mjs';
import { git, headCommit } from '../../sync/lib/repo.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAVED = { ...process.env };
const ENV_KEYS = ['CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SETUP_LEGACY_ENTRY', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const FORWARDER = fs.readFileSync(path.join(PROJECT, 'payload', 'legacy', 'sync.mjs'));
const RUNS = ['20261125-100000', '20261125-100100', '20261125-100200'];
const COMMIT = 'c'.repeat(40);
const ANY_RULE = /^rules\/claude-(setup|manners)--/;
const NEW_SYNC = 'tools/claude-manners/sync/sync.mjs';
const FWD = 'tools/claude-setup/sync/sync.mjs';
const MUTATORS = ['renameSync', 'rmSync', 'rmdirSync', 'appendFileSync', 'writeFileSync', 'mkdirSync'];

let root;
let seq = 0;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const at = (cfg, rel) => path.join(cfg, ...rel.split('/'));
const put = (cfg, rel, data) => {
  fs.mkdirSync(path.dirname(at(cfg, rel)), { recursive: true });
  fs.writeFileSync(at(cfg, rel), data);
};
const get = (cfg, rel) => fs.readFileSync(at(cfg, rel));
const has = (cfg, rel) => fs.existsSync(at(cfg, rel));
const fresh = (name = 'cfg') => {
  const d = path.join(root, `${name}-${++seq}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const readState = (cfg, dir = 'claude-manners') => JSON.parse(fs.readFileSync(at(cfg, `state/${dir}/state.json`), 'utf8'));
const ruleNames = (cfg) => (has(cfg, 'rules') ? fs.readdirSync(at(cfg, 'rules')).sort() : []);

function files(dir) {
  const out = {};
  const rec = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory() || (ent.isSymbolicLink() && fs.statSync(p).isDirectory())) {
        out[`${r}/`] = 'dir';
        rec(p, r);
      } else out[r] = sha(fs.readFileSync(p));
    }
  };
  rec(dir, '');
  return out;
}

const rule = (name, brand = 'claude-setup', eol = '\n') => [
  `<!-- ${brand} part: ${name} -->`, '', `# ${brand} rules: ${name}`, '',
  `Installed by ${brand} into ~/.claude/rules/ and loaded every session. Rule ${name}.`, '',
  '| Working in | Workspace |', '|---|---|', '| Desktop/code/claude-setup | General |', '',
].join(eol);

function build(cfg, o = {}) {
  const { newEngine = true, editedEngine = true, absBackup = true, extra } = o;
  const state = {
    version: 1,
    repo: { path: path.join(root, 'claude-setup'), commit: COMMIT, tag: 'v2' },
    engine: { version: '1.3.0', sha256: null },
    facts: {}, values: {}, parts: {}, answers: {}, files: {}, settings: {}, mcp: {}, runs: [],
  };
  const originals = [];
  const file = (key, tracked, disk = tracked, fields = {}, part = 'p') => {
    if (disk !== null) {
      put(cfg, key, disk);
      if (ANY_RULE.test(key)) originals.push({ key, bytes: Buffer.from(disk) });
    }
    if (tracked !== null) {
      state.files[key] = { hash: hashBuffer(Buffer.from(tracked)), commit: COMMIT, part, mode: 'managed', existed_before: false, backup: null, held: false, ...fields };
      state.parts[part] = { installed: true, at_commit: COMMIT };
    }
  };
  RUNS.forEach((id, i) => {
    const dir = `state/claude-setup/backups/2026-11-25/${id}`;
    state.runs.push({ id, kind: 'apply', at: `2026-11-25T10:0${i}:00.000Z`, from: i ? COMMIT : null, to: COMMIT, proposals: [], status: 'done', backup: dir });
    put(cfg, `${dir}/journal.jsonl`, `{"t":"2026-11-25T10:0${i}:00.000Z","ev":"file","action":"write","dest":"rules/claude-setup--core.md","existed":false,"backup":"${dir}/files/x"}\n`);
    put(cfg, `${dir}/state-before.json`, `${JSON.stringify({ version: 1, parts: {}, files: { 'rules/claude-setup--orig.md': { backup: `${dir}/files/rules/claude-setup--orig.md` } } }, null, 2)}\n`);
  });
  const snapDir = (id) => `state/claude-setup/backups/2026-11-25/${id}/files`;
  put(cfg, `${snapDir(RUNS[1])}/rules/claude-setup--orig.md`, 'my own rule before sync\n');
  put(cfg, `${snapDir(RUNS[0])}/rules/claude-setup--edited.md`, 'edited rule before sync\n');

  file('rules/claude-setup--core.md', rule('core-rules'), undefined, {}, 'core-rules');
  file('rules/claude-setup--crlf.md', rule('crlf', 'claude-setup', '\r\n'), undefined, {}, 'crlf');
  file('rules/claude-setup--edited.md', rule('edited'), `${rule('edited')}my edit\n`, { existed_before: true, backup: absBackup ? at(cfg, `${snapDir(RUNS[0])}/rules/claude-setup--edited.md`) : `${snapDir(RUNS[0])}/rules/claude-setup--edited.md` }, 'edited');
  file('rules/claude-setup--held.md', rule('held'), `${rule('held')}held edit\n`, { held: true }, 'held');
  file('rules/claude-setup--gone.md', rule('gone'), null, {}, 'gone');
  file('rules/claude-setup--orig.md', rule('orig'), undefined, { existed_before: true, backup: `${snapDir(RUNS[1])}/rules/claude-setup--orig.md` }, 'orig');

  const eng = (key, tracked, disk) => file(key, tracked, disk, {}, 'sync-engine');
  eng('tools/claude-setup/sync/lib/a.mjs', 'export const a = 1;\n');
  eng('tools/claude-setup/sync/lib/b.mjs', 'export const b = 1;\n', editedEngine ? 'export const b = 2; // mine\n' : undefined);
  eng('skills/claude-setup-sync/SKILL.md', '# old skill\n');
  eng(FWD, FORWARDER);
  if (newEngine) {
    eng(NEW_SYNC, 'export const engine = 2;\n');
    eng('skills/claude-manners-sync/SKILL.md', '# new skill\n');
  }

  put(cfg, 'rules/mine.md', '# my rule\nsee rules/claude-setup--core.md\nplain text\n');
  put(cfg, 'CLAUDE.md', '# Notes\nRun node ~/.claude/tools/claude-setup/sync/sync.mjs status\nmy claude-setup clone\nUse the claude-setup-sync skill\n');
  put(cfg, 'settings.json', '{\n  "theme": "dark",\n  "a": "node ~/.claude/tools/claude-setup/sync/sync.mjs status",\n  "b": "node C:\\\\Users\\\\x\\\\.claude\\\\tools\\\\claude-setup\\\\sync\\\\sync.mjs status"\n}\n');
  put(cfg, 'settings.local.json', '{\n  "note": "state/claude-setup/state.json"\n}\n');
  put(cfg, 'notes/n.txt', 'plain notes\r\n');
  put(cfg, 'state/claude-setup/privacy-words.txt', 'secret\n');
  extra?.({ cfg, file, state });
  put(cfg, 'state/claude-setup/state.json', `${JSON.stringify(state, null, 2)}\n`);
  return { state, originals };
}

const bothNames = (only) => ({ file }) => {
  const N = (n, tail = '') => `${rule(n, 'claude-manners')}${tail}`;
  const pair = (n, oldTracked, oldDisk, oldFields, newTracked, newDisk) => {
    if (only && !only.includes(n)) return;
    file(`rules/claude-setup--${n}.md`, oldTracked, oldDisk, oldFields, n);
    file(`rules/claude-manners--${n}.md`, newTracked, newDisk, {}, n);
  };
  pair('pa', rule('pa'), undefined, {}, N('pa', 'newer\n'));
  pair('pb', rule('pb'), `${rule('pb')}MY EDIT\n`, {}, N('pb', 'payload\n'));
  pair('pc', rule('pc'), undefined, {}, null, 'my own file at the new name\n');
  pair('pd', rule('pd'), undefined, {}, null, rule('pd'));
  pair('pe', rule('pe'), `${rule('pe')}EDIT\n`, {}, null, 'own new file\n');
  pair('pf', rule('pf'), `${rule('pf')}held edit\n`, { held: true }, N('pf', 'payload\n'));
  pair('pg', rule('pg'), `${rule('pg')}same edit\n`, {}, null, `${rule('pg')}same edit\n`);
};

function crashAt(n, fn) {
  const real = Object.fromEntries(MUTATORS.map((m) => [m, fs[m]]));
  let calls = 0;
  let fired = false;
  for (const m of MUTATORS) {
    fs[m] = function patched(...args) {
      if (fired) throw new Error('process is dead');
      if (++calls === n) {
        fired = true;
        if (m === 'writeFileSync') real.writeFileSync(args[0], Buffer.from(args[1]).subarray(0, 20));
        throw new Error('crash');
      }
      return real[m](...args);
    };
  }
  try {
    fn();
  } catch {} finally {
    Object.assign(fs, real);
  }
  return { fired, calls };
}

const flat = (o, p = '') => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => flat(v, `${p}/${k}`)) : [`${p}=${JSON.stringify(o)}`]);
function diff(got, want) {
  const g = new Set(flat(got));
  const w = new Set(flat(want));
  return [...[...g].filter((x) => !w.has(x)).map((x) => `got ${x}`), ...[...w].filter((x) => !g.has(x)).map((x) => `want ${x}`)];
}

function normState(cfg) {
  const s = readState(cfg);
  s.runs = s.runs.map((r) => (r.kind === 'rename' ? { ...r, id: '-', at: '-', backup: '-' } : r));
  const report = s.renamed?.report ?? {};
  if (s.renamed) {
    s.renamed.run = '-';
    delete s.renamed.report;
  }
  for (const k of Object.keys(report)) if (Array.isArray(report[k])) report[k].sort();
  return { main: s, report };
}

const outside = (cfg) => Object.fromEntries(Object.entries(files(cfg)).filter(([k]) => !k.startsWith('state/claude-manners/') && !/\.tmp-\d+$/.test(k)));
const keep = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.endsWith('/') && !k.startsWith('state/claude-manners/') && !/\.tmp-\d+$/.test(k)));
const emptyDirs = (m) => Object.keys(m).filter((k) => k.endsWith('/') && !k.startsWith('state/'));

function lost(all, originals) {
  const have = new Set(Object.entries(all).filter(([k]) => ANY_RULE.test(k) || k.startsWith('state/')).map(([, v]) => v));
  return originals.filter((o) => !have.has(sha(o.bytes))).map((o) => o.key);
}

function bothRemain(cfg) {
  const names = ruleNames(cfg);
  return names.filter((n) => n.startsWith('claude-setup--') && names.includes(n.replace('claude-setup--', 'claude-manners--')));
}

function sweep(label, buildOpts, t) {
  const tpl = fresh(`${label}-tpl`);
  const { originals } = build(tpl, { ...buildOpts, absBackup: false });
  const ref = fresh(`${label}-ref`);
  fs.cpSync(tpl, ref, { recursive: true });
  assert.ok(migrate(ref));
  const refAll = files(ref);
  const want = { files: keep(refAll), empty: emptyDirs(refAll), state: normState(ref) };
  const cats = { 'lost after a crash': [], 'both names remain': [], 'files differ': [], 'state.json differs': [], 'renamed.report differs': [], 'rename runs not one': [] };
  const cosmetic = new Set();
  const judge = (tag, dir) => {
    const all = files(dir);
    const add = (cat, msg) => cats[cat].push(`${tag}: ${msg}`);
    if (bothRemain(dir).length) add('both names remain', bothRemain(dir).join(','));
    const fd = diff(keep(all), want.files);
    if (fd.length) add('files differ', fd.join(' | '));
    for (const k of emptyDirs(all)) if (!want.empty.includes(k)) cosmetic.add(k);
    const st = normState(dir);
    const sd = diff(st.main, want.state.main);
    if (sd.length) add('state.json differs', sd.join(' | '));
    const rd = diff(st.report, want.state.report);
    if (rd.length) add('renamed.report differs', rd.join(' | '));
    const renames = st.main.runs.filter((r) => r.kind === 'rename').length;
    if (renames !== 1) add('rename runs not one', `${renames}`);
    const gone = lost(all, originals);
    if (gone.length) add('lost after a crash', `after the resume: ${gone}`);
  };
  const step = (tag, dir, crashes) => {
    for (const c of crashes) crashAt(c, () => migrate(dir));
    const gone = lost(files(dir), originals);
    if (gone.length) cats['lost after a crash'].push(`${tag}: right after the crash: ${gone}`);
    migrate(dir);
    judge(tag, dir);
  };
  let total = 0;
  for (let n = 1; n < 3000; n++) {
    const dir = fresh(`${label}-n`);
    fs.cpSync(tpl, dir, { recursive: true });
    const r = crashAt(n, () => migrate(dir));
    if (!r.fired) {
      total = r.calls;
      break;
    }
    step(`N=${n}`, dir, []);
  }
  assert.ok(total > 20, `only ${total} mutating calls seen`);
  for (let n = 1; n <= total; n += 17) {
    for (const m of [2, 12]) {
      const dir = fresh(`${label}-nm`);
      fs.cpSync(tpl, dir, { recursive: true });
      step(`N=${n},M=${m}`, dir, [n, m]);
    }
  }
  t.diagnostic(`${label}: ${total} mutating calls; harmless leftovers (empty folders): ${[...cosmetic].join(', ') || 'none'}`);
  return cats;
}

const REPORT = 'renamed.report differs';
const STATE = 'state.json differs';
const sweeps = {};
const summarize = (cats, only) => Object.entries(cats).filter(([k, v]) => v.length && only(k)).map(([k, v]) => {
  const distinct = [...new Set(v.map((m) => m.replace(/^[^:]*: /, '')))].slice(0, 4).map((s) => s.slice(0, 300));
  return `${k}: ${v.length} cases, e.g. ${distinct.join(' || ')}`;
});

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-legacy-'));
  Object.assign(process.env, { CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, CLAUDE_CONFIG_DIR: path.join(root, 'config'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  delete process.env.CLAUDE_SETUP_LEGACY_ENTRY;
});

after(() => {
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('migrate: a normal old install moves to the new name, every edit and every old run stays byte for byte', () => {
  const cfg = fresh();
  const { state: old, originals } = build(cfg);
  const orig = Object.fromEntries(originals.map((o) => [o.key, o.bytes]));
  const before = files(cfg);
  const report = migrate(cfg);
  const after = files(cfg);
  const s = readState(cfg);

  assert.equal(has(cfg, 'state/claude-setup'), false);
  assert.equal(Object.keys(after).some((k) => k.startsWith('state/claude-setup')), false);
  assert.deepEqual(ruleNames(cfg), ['claude-manners--core.md', 'claude-manners--crlf.md', 'claude-manners--edited.md', 'claude-manners--held.md', 'claude-manners--orig.md', 'mine.md']);
  assert.equal(get(cfg, 'rules/claude-manners--core.md').toString(), rule('core-rules', 'claude-manners'));
  assert.ok(get(cfg, 'rules/claude-manners--core.md').toString().includes('| Desktop/code/claude-setup | General |'));
  assert.equal(get(cfg, 'rules/claude-manners--orig.md').toString(), rule('orig', 'claude-manners'));
  assert.deepEqual(get(cfg, 'rules/claude-manners--crlf.md'), Buffer.from(rule('crlf', 'claude-manners', '\r\n')));
  for (const n of ['edited', 'held']) assert.deepEqual(get(cfg, `rules/claude-manners--${n}.md`), orig[`rules/claude-setup--${n}.md`]);
  assert.equal(has(cfg, 'rules/claude-manners--gone.md'), false);
  assert.equal(s.files['rules/claude-manners--gone.md'].hash, hashBuffer(Buffer.from(rule('gone'))));
  for (const n of ['core', 'crlf', 'orig']) {
    const key = `rules/claude-manners--${n}.md`;
    assert.equal(s.files[key].hash, hashFile(at(cfg, key)), key);
  }
  assert.equal(s.files['rules/claude-manners--edited.md'].hash, old.files['rules/claude-setup--edited.md'].hash);
  assert.equal(s.files['rules/claude-manners--held.md'].held, true);
  assert.equal(Object.keys(s.files).some((k) => /^(rules\/claude-setup--|tools\/claude-setup|skills\/claude-setup-sync)/.test(k)), false);

  const resolve = (b) => (path.isAbsolute(b) ? b : at(cfg, b));
  for (const f of Object.values(s.files)) if (f.backup) assert.ok(fs.existsSync(resolve(f.backup)), f.backup);
  for (const r of s.runs) assert.ok(fs.existsSync(resolve(r.backup)), r.backup);
  assert.equal(s.files['rules/claude-manners--orig.md'].backup, `state/claude-manners/backups/2026-11-25/${RUNS[1]}/files/rules/claude-setup--orig.md`);
  assert.equal(s.files['rules/claude-manners--edited.md'].backup, at(cfg, `state/claude-manners/backups/2026-11-25/${RUNS[0]}/files/rules/claude-setup--edited.md`));
  for (const [k, v] of Object.entries(before)) if (k.startsWith('state/claude-setup/backups/')) assert.equal(after[k.replace('state/claude-setup', 'state/claude-manners')], v, k);
  for (const k of ['version', 'repo', 'engine', 'facts', 'values', 'parts', 'answers', 'settings', 'mcp']) assert.deepEqual(s[k], old[k], k);

  for (const k of ['tools/claude-setup/sync/lib/a.mjs', 'skills/claude-setup-sync/SKILL.md']) assert.equal(has(cfg, k), false, k);
  assert.equal(get(cfg, 'tools/claude-setup/sync/lib/b.mjs').toString(), 'export const b = 2; // mine\n');
  assert.deepEqual(get(cfg, FWD), FORWARDER);
  assert.equal(get(cfg, 'state/claude-manners/privacy-words.txt').toString(), 'secret\n');
  for (const k of ['CLAUDE.md', 'settings.json', 'settings.local.json', 'rules/mine.md', 'notes/n.txt', NEW_SYNC]) assert.equal(after[k], before[k], k);
  assert.equal(Object.keys(after).some((k) => /\.tmp-/.test(k)), false);

  assert.deepEqual([...report.rules_moved].sort(), ['core', 'crlf', 'edited', 'held', 'orig'].map((n) => `rules/claude-manners--${n}.md`));
  assert.deepEqual([...report.edited_text_kept].sort(), ['rules/claude-manners--edited.md', 'rules/claude-manners--held.md']);
  assert.deepEqual(report.old_files_left, ['tools/claude-setup/sync/lib/b.mjs']);
  assert.deepEqual([...report.mentions].sort(), ['CLAUDE.md:2', 'CLAUDE.md:4', 'rules/mine.md:2', 'settings.json:3', 'settings.json:4', 'settings.local.json:2']);
  assert.match(report.note, /claude-manners/);
  assert.deepEqual(s.renamed.report, report);
  assert.equal(s.renamed.done, true);
  assert.equal(s.runs.length, 4);
  assert.deepEqual(s.runs.slice(0, 3).map((r) => [r.id, r.kind, r.status, r.at]), old.runs.map((r) => [r.id, r.kind, r.status, r.at]));
  assert.equal(s.runs[3].kind, 'rename');
  assert.equal(s.runs[3].status, 'done');
  assert.equal(s.renamed.run, s.runs[3].id);
});

test('migrate: a second call changes nothing; the forwarder goes only when the new tool is the caller', () => {
  const cfg = fresh();
  build(cfg, { editedEngine: false });
  const first = migrate(cfg);
  const tree = files(cfg);
  assert.equal(migrate(cfg), null);
  assert.deepEqual(files(cfg), tree);

  const self = at(cfg, NEW_SYNC);
  process.env.CLAUDE_SETUP_LEGACY_ENTRY = '1';
  try {
    assert.equal(migrate(cfg, { self }), null);
  } finally {
    delete process.env.CLAUDE_SETUP_LEGACY_ENTRY;
  }
  assert.deepEqual(files(cfg), tree);
  assert.equal(migrate(cfg, { self: at(cfg, 'tools/other/sync.mjs') }), null);
  assert.ok(has(cfg, FWD));

  assert.deepEqual(migrate(cfg, { self }), first);
  assert.equal(has(cfg, 'tools/claude-setup'), false);
  assert.ok(has(cfg, NEW_SYNC));
  assert.equal(migrate(cfg, { self }), null);

  const direct = fresh();
  build(direct, { editedEngine: false });
  assert.ok(migrate(direct, { self: at(direct, NEW_SYNC) }));
  assert.equal(has(direct, 'tools/claude-setup'), false);

  const mine = fresh();
  build(mine, { editedEngine: false });
  migrate(mine);
  put(mine, FWD, 'my own script\n');
  const kept = files(mine);
  assert.equal(migrate(mine, { self: at(mine, NEW_SYNC) }), null);
  assert.deepEqual(files(mine), kept);
});

test('migrate: a crash at every file operation loses nothing, never leaves both names and ends with the same files', (t) => {
  sweeps.all = sweep('crash', { extra: bothNames(['pb', 'pc']) }, t);
  assert.deepEqual(summarize(sweeps.all, (k) => k !== REPORT && k !== STATE), []);
});

test('migrate: after a crash and a restart state.json equals the uninterrupted one, held flags included', () => {
  assert.ok(sweeps.all, 'the crash sweep did not run');
  assert.deepEqual(summarize(sweeps.all, (k) => k === STATE), []);
});

test('migrate: after a crash and a restart the report still lists every rule that was moved', () => {
  assert.ok(sweeps.all, 'the crash sweep did not run');
  assert.deepEqual(summarize(sweeps.all, (k) => k === REPORT), []);
});

test('migrate: when both rule names exist the person edit wins at the new name and the loser is backed up', () => {
  const cfg = fresh();
  const { originals } = build(cfg, { extra: bothNames() });
  const orig = Object.fromEntries(originals.map((o) => [o.key, o.bytes.toString()]));
  migrate(cfg);
  const s = readState(cfg);
  const content = (n) => get(cfg, `rules/claude-manners--${n}.md`).toString();
  assert.deepEqual(bothRemain(cfg), []);
  assert.equal(ruleNames(cfg).filter((n) => /^claude-setup--/.test(n)).length, 0);
  assert.equal(content('pa'), orig['rules/claude-manners--pa.md']);
  assert.equal(content('pb'), orig['rules/claude-setup--pb.md']);
  assert.equal(content('pc'), orig['rules/claude-manners--pc.md']);
  assert.equal(content('pd'), rule('pd', 'claude-manners'));
  assert.equal(content('pe'), orig['rules/claude-setup--pe.md']);
  assert.equal(content('pf'), orig['rules/claude-setup--pf.md']);
  assert.equal(content('pg'), orig['rules/claude-setup--pg.md']);
  for (const n of ['pb', 'pc', 'pe', 'pf', 'pg']) assert.equal(s.files[`rules/claude-manners--${n}.md`].held, true, n);
  for (const n of ['pa', 'pd']) assert.equal(s.files[`rules/claude-manners--${n}.md`].held, false, n);
  const stateFiles = Object.entries(files(cfg)).filter(([k]) => k.startsWith('state/claude-manners/backups/') && k.includes('/files/rules/'));
  const backedUp = new Set(stateFiles.map(([, v]) => v));
  for (const key of ['claude-setup--pa', 'claude-manners--pb', 'claude-setup--pc', 'claude-setup--pd', 'claude-manners--pe', 'claude-manners--pf', 'claude-setup--pg']) {
    assert.ok(backedUp.has(sha(orig[`rules/${key}.md`])), `${key} has no backup`);
  }
  assert.deepEqual(lost(files(cfg), originals), []);
});

test('migrate: two state folders, or a leftover new folder, stop with a message and change nothing; no state.json means no migration', () => {
  const both = fresh();
  build(both);
  put(both, 'state/claude-manners/state.json', '{"version":1}\n');
  let tree = files(both);
  assert.throws(() => migrate(both), /two sync folders found/);
  assert.deepEqual(files(both), tree);

  const leftover = fresh();
  build(leftover);
  put(leftover, 'state/claude-manners/privacy-words.txt', 'x\n');
  tree = files(leftover);
  assert.throws(() => migrate(leftover), /two sync folders found/);
  assert.deepEqual(files(leftover), tree);

  const empty = fresh();
  build(empty);
  fs.mkdirSync(at(empty, 'state/claude-manners'));
  tree = files(empty);
  assert.throws(() => migrate(empty), /two sync folders found/);
  assert.deepEqual(files(empty), tree);

  const words = fresh();
  put(words, 'state/claude-setup/privacy-words.txt', 'x\n');
  put(words, 'rules/claude-setup--mine.md', 'mine\n');
  tree = files(words);
  assert.equal(migrate(words), null);
  assert.deepEqual(files(words), tree);

  const newOnly = fresh();
  put(newOnly, 'state/claude-setup/privacy-words.txt', 'x\n');
  put(newOnly, 'state/claude-manners/state.json', `${JSON.stringify({ version: 1, repo: {}, runs: [], files: { 'hooks/a.sh': { hash: 'x' } } })}\n`);
  tree = files(newOnly);
  assert.equal(migrate(newOnly), null);
  assert.deepEqual(files(newOnly), tree);
});

test('migrate: a state folder that cannot be renamed gives a clear error within seconds and changes nothing', () => {
  const cfg = fresh();
  build(cfg);
  const tree = files(cfg);
  const real = fs.renameSync;
  const t0 = Date.now();
  fs.renameSync = (from, to) => {
    if (path.resolve(from) === at(cfg, 'state/claude-setup')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return real(from, to);
  };
  try {
    assert.throws(() => migrate(cfg), /could not rename .*\(EBUSY\)\. Nothing was changed/);
  } finally {
    fs.renameSync = real;
  }
  assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(files(cfg), tree);
});

test('migrate: a fresh install of the new layout is never touched, even when the clone path says claude-setup', () => {
  const cfg = fresh();
  const bytes = Buffer.from(rule('core-rules', 'claude-manners'));
  put(cfg, 'rules/claude-manners--core.md', bytes);
  put(cfg, 'rules/claude-setup--mine.md', 'my own rule\n');
  put(cfg, NEW_SYNC, 'export const engine = 2;\n');
  put(cfg, 'CLAUDE.md', 'see ~/.claude/tools/claude-setup/sync\n');
  const dir = 'state/claude-manners/backups/2026-11-26/20261126-090000';
  put(cfg, `${dir}/state-before.json`, '{}\n');
  const state = {
    version: 1, repo: { path: 'D:/code/claude-setup', commit: COMMIT, tag: 'v3' }, engine: { version: '2.0.0', sha256: null }, facts: {}, values: {}, parts: {}, answers: {}, settings: {}, mcp: {},
    files: { 'rules/claude-manners--core.md': { hash: hashBuffer(bytes), commit: COMMIT, part: 'core-rules', mode: 'managed', existed_before: false, backup: null, held: false }, [NEW_SYNC]: { hash: 'x', commit: COMMIT, part: 'sync-engine', mode: 'managed', existed_before: false, backup: null, held: false } },
    runs: [{ id: '20261126-090000', kind: 'apply', at: '2026-11-26T09:00:00.000Z', from: null, to: COMMIT, proposals: [], status: 'done', backup: dir }],
  };
  put(cfg, 'state/claude-manners/state.json', `${JSON.stringify(state, null, 2)}\n`);
  const tree = files(cfg);
  assert.equal(migrate(cfg), null);
  assert.equal(migrate(cfg, { self: at(cfg, NEW_SYNC) }), null);
  assert.deepEqual(files(cfg), tree);

  const empty = fresh();
  assert.equal(migrate(empty), null);
  assert.deepEqual(fs.readdirSync(empty), []);
  assert.equal(migrate(path.join(root, 'no-such-config')), null);
  assert.equal(fs.existsSync(path.join(root, 'no-such-config')), false);
});

test('migrate: without the new tool on disk rules and state move, the old tool stays, and the next call finishes', () => {
  const cfg = fresh();
  build(cfg, { newEngine: false });
  const ref = fresh();
  build(ref, { newEngine: false });
  put(ref, NEW_SYNC, 'export const engine = 2;\n');
  migrate(ref);

  const first = migrate(cfg);
  assert.match(first.note, /START\.md/);
  const s = readState(cfg);
  assert.equal(s.renamed.done, false);
  assert.equal(has(cfg, 'state/claude-setup'), false);
  assert.deepEqual(ruleNames(cfg).filter((n) => /^claude-setup--/.test(n)), []);
  assert.ok(has(cfg, 'rules/claude-manners--core.md'));
  assert.ok(has(cfg, 'tools/claude-setup/sync/lib/a.mjs'));
  assert.deepEqual(get(cfg, FWD), FORWARDER);
  assert.ok(s.files['tools/claude-setup/sync/lib/a.mjs'] && s.files[FWD]);
  assert.equal(s.runs.at(-1).kind, 'rename');
  const tree = files(cfg);
  assert.match(migrate(cfg).note, /START\.md/);
  assert.deepEqual(files(cfg), tree);

  put(cfg, NEW_SYNC, 'export const engine = 2;\n');
  const done = migrate(cfg);
  assert.equal(readState(cfg).renamed.done, true);
  assert.match(done.note, /ask them to start a new Claude Code session/);
  assert.equal(readState(cfg).runs.filter((r) => r.kind === 'rename').length, 1);
  assert.equal(has(cfg, 'tools/claude-setup/sync/lib/a.mjs'), false);
  assert.equal(has(cfg, 'skills/claude-setup-sync/SKILL.md'), false);
  assert.deepEqual(outside(cfg), outside(ref));
  assert.deepEqual(done.rules_moved.slice().sort(), ['core', 'crlf', 'edited', 'held', 'orig'].map((n) => `rules/claude-manners--${n}.md`));
});

for (const order of ['main first', 'second first']) {
  test(`migrate: two config folders sharing rules and skills by junction, ${order}, end with each rule once and honest hashes`, (t) => {
    const main = fresh('main');
    const second = fresh('second');
    build(main);
    const { state: st2 } = build(second);
    fs.rmSync(at(second, 'rules'), { recursive: true });
    fs.rmSync(at(second, 'skills'), { recursive: true });
    try {
      fs.symlinkSync(at(main, 'rules'), at(second, 'rules'), 'junction');
      fs.symlinkSync(at(main, 'skills'), at(second, 'skills'), 'junction');
    } catch (e) {
      t.skip(`junctions are not available here: ${e.code}`);
      return;
    }
    const editedBytes = get(main, 'rules/claude-setup--edited.md');
    const run = order === 'main first' ? [main, second] : [second, main];
    for (const dir of run) assert.doesNotThrow(() => migrate(dir));
    const names = ruleNames(main);
    assert.deepEqual(names.filter((n) => n.startsWith('claude-setup--')), []);
    assert.equal(names.filter((n) => n.startsWith('claude-manners--')).length, 5);
    for (const dir of [main, second]) {
      const s = readState(dir);
      for (const n of ['core', 'crlf', 'orig']) {
        const key = `rules/claude-manners--${n}.md`;
        assert.equal(s.files[key].hash, hashFile(at(dir, key)), `${dir} ${key}`);
      }
      assert.deepEqual(get(dir, 'rules/claude-manners--edited.md'), editedBytes);
      assert.equal(s.files['rules/claude-manners--edited.md'].hash, st2.files['rules/claude-setup--edited.md'].hash);
      assert.equal(s.files['rules/claude-manners--held.md'].held, true);
      assert.equal(s.renamed.done, true);
    }
  });
}

test('helpers: aliasRule, renameBytes, beforeRename, isForwarderSrc, destKey', () => {
  assert.equal(aliasRule('rules/claude-setup--core.md'), 'rules/claude-manners--core.md');
  for (const same of ['rules/claude-manners--core.md', 'rules/mine.md', 'hooks/claude-setup--x.md', 'rules/sub/claude-setup--x.md']) assert.equal(aliasRule(same), same);

  const text = rule('core-rules');
  const once = renameBytes(Buffer.from(text));
  assert.equal(once.toString(), rule('core-rules', 'claude-manners'));
  assert.deepEqual(renameBytes(once), once);
  assert.deepEqual(renameBytes(Buffer.from(rule('crlf', 'claude-setup', '\r\n'))), Buffer.from(rule('crlf', 'claude-manners', '\r\n')));
  const same = Buffer.from('## claude-setup rules: x\n- claude-setup part: y\nclaude-setup rules: z\n# claude-setup-sync rules: w\nsee <!-- claude-setup part: q --> inline\n# claude-setup rulesx\n');
  assert.deepEqual(renameBytes(same), same);
  const odd = Buffer.from([0x80, 0xff, 0x0d, 0x0a, 0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80, 0x00, 0x0a]);
  assert.deepEqual(renameBytes(odd), odd);
  assert.equal(renameBytes(Buffer.from('<!-- claude-setup part: a -->\n<!-- claude-setup part: b -->\n')).toString(), '<!-- claude-manners part: a -->\n<!-- claude-manners part: b -->\n');

  assert.equal(beforeRename(undefined), true);
  assert.equal(beforeRename({ files: [] }), true);
  assert.equal(beforeRename({}), true);
  assert.equal(beforeRename({ files: [{ dest: 'tools/claude-setup/sync' }, { dest: 'skills/claude-setup-sync' }] }), true);
  assert.equal(beforeRename({ files: [{ dest: 'tools/claude-setup/sync' }, { dest: 'tools/claude-manners/sync' }] }), false);
  assert.equal(isForwarderSrc('payload/legacy/sync.mjs'), true);
  for (const no of ['payload/legacy', 'payload/legacyx/sync.mjs', 'payload/rules/x.md', 'sync/sync.mjs', 'x/payload/legacy/a']) assert.equal(isForwarderSrc(no), false, no);

  for (const bad of ['state/claude-setup/x', 'state/claude-manners/x', 'state/claude-setup', 'state/claude-manners', './state/claude-setup/x', 'state\\claude-manners\\x', 'state/claude-manners/../claude-manners/x', 'backups/x']) assert.throws(() => destKey(bad), /bad or reserved/, bad);
  assert.equal(destKey('state/other/x'), 'state/other/x');
  assert.equal(destKey('tools/claude-manners/sync'), 'tools/claude-manners/sync');
});

test('helpers: expandFiles skips payload/legacy and gives rules of an old commit the new name and header', () => {
  const repo = fresh('repo');
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'core.autocrlf', 'false'], repo);
  put(repo, 'payload/rules/claude-setup--core.md', rule('core'));
  put(repo, 'payload/rules/claude-manners--flags.md', rule('flags', 'claude-manners'));
  put(repo, 'payload/legacy/sync.mjs', FORWARDER);
  put(repo, 'sync/sync.mjs', 'export {};\n');
  git(['add', '-A'], repo);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'old'], repo);
  const c = headCommit(repo);
  const e = {
    id: 'sync-engine', values: [],
    files: [{ src: 'sync', dest: 'tools/claude-manners/sync', mode: 'managed' }, { src: 'payload/legacy/sync.mjs', dest: FWD, mode: 'managed' }],
    rules: ['payload/rules/claude-setup--core.md', 'payload/rules/claude-manners--flags.md'],
  };
  const items = expandFiles(e, repo, c, { home: 'D:/home-x' });
  assert.deepEqual(items.map((i) => [i.dest, i.rule]), [[NEW_SYNC, false], ['rules/claude-manners--core.md', true], ['rules/claude-manners--flags.md', true]]);
  assert.equal(items[1].src, 'payload/rules/claude-setup--core.md');
  assert.equal(bytesFor(e, items[1], repo, c, {}, [], 'D:/home-x').toString(), rule('core', 'claude-manners'));
  assert.equal(bytesFor(e, items[2], repo, c, {}, [], 'D:/home-x').toString(), rule('flags', 'claude-manners'));
  assert.equal(expandFiles({ files: [{ src: 'payload/legacy/sync.mjs', dest: FWD, mode: 'managed' }], rules: [] }, repo, c, {}).length, 0);
});
