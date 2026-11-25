import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, finishRun, findCrashedRun, load, newRun, runDirOf, save, stateFile } from '../../sync/lib/state.mjs';

let root;
let cfg;
const saved = { ...process.env };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-state-'));
  cfg = path.join(root, 'config');
  Object.assign(process.env, { CLAUDE_SETUP_TEST: '1', CLAUDE_SETUP_TEST_ROOT: root, CLAUDE_CONFIG_DIR: cfg });
});

after(() => {
  for (const k of ['CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT', 'CLAUDE_CONFIG_DIR']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('load returns the default v1 state when nothing is saved', () => {
  const s = load();
  assert.deepEqual(s, emptyState());
  assert.equal(s.version, 1);
  assert.deepEqual(s.runs, []);
});

test('save writes state.json and keeps the previous version as state.json.bak', () => {
  const s = load();
  s.values.k = 'one';
  save(s);
  assert.equal(fs.existsSync(stateFile() + '.bak'), false);
  s.values.k = 'two';
  save(s);
  assert.equal(JSON.parse(fs.readFileSync(stateFile() + '.bak', 'utf8')).values.k, 'one');
  assert.equal(load().values.k, 'two');
  assert.equal(stateFile(), path.join(cfg, 'state', 'claude-manners', 'state.json'));
});

test('load rejects an unknown version and fills missing keys', () => {
  fs.writeFileSync(stateFile(), JSON.stringify({ version: 1, values: { a: 1 } }));
  const s = load();
  assert.deepEqual(s.files, {});
  assert.equal(s.values.a, 1);
  fs.writeFileSync(stateFile(), JSON.stringify({ version: 2 }));
  assert.throws(() => load(), /unsupported state version/);
});

test('newRun makes a started run with a backup dir, snapshot and a unique id', () => {
  const s = emptyState();
  s.files['a/b.txt'] = { hash: 'h' };
  const now = new Date(2026, 10, 23, 9, 8, 7);
  const r1 = newRun(s, 'apply', 'aaa', 'bbb', cfg, now);
  const r2 = newRun(s, 'rollback', 'bbb', 'aaa', cfg, now);
  assert.equal(r1.id, '20261123-090807');
  assert.equal(r2.id, '20261123-090808');
  assert.equal(r1.status, 'started');
  assert.equal(r1.kind, 'apply');
  assert.equal(r1.backup, 'state/claude-manners/backups/2026-11-23/20261123-090807');
  assert.equal(runDirOf(r1, cfg), path.join(cfg, 'state', 'claude-manners', 'backups', '2026-11-23', r1.id));
  assert.deepEqual(s.runs.map((r) => r.id), [r1.id, r2.id]);
  const snap = JSON.parse(fs.readFileSync(path.join(runDirOf(r1, cfg), 'state-before.json'), 'utf8'));
  assert.deepEqual(snap.files, { 'a/b.txt': { hash: 'h' } });
  assert.equal(snap.runs, undefined);
});

test('finishRun sets the status; findCrashedRun returns a run left started', () => {
  const s = emptyState();
  const r1 = newRun(s, 'apply', null, 'x', cfg, new Date(2026, 10, 24, 1, 1, 1));
  assert.equal(findCrashedRun(s), r1);
  finishRun(s, r1);
  assert.equal(r1.status, 'done');
  assert.equal(findCrashedRun(s), null);
  const r2 = newRun(s, 'apply', 'x', 'y', cfg, new Date(2026, 10, 24, 1, 1, 5));
  assert.equal(findCrashedRun(s).id, r2.id);
  finishRun(s, r2.id, 'rolled-back');
  assert.equal(r2.status, 'rolled-back');
  assert.equal(findCrashedRun(s), null);
  assert.throws(() => finishRun(s, 'nope'), /unknown run/);
});

test('state functions refuse a config dir outside the test root', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-out-'));
  try {
    assert.throws(() => save(emptyState(), outside), /refusing/);
    assert.equal(fs.existsSync(path.join(outside, 'state')), false);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
