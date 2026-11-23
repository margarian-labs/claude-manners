import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAllowed, backupFile, configDir, copyAtomic, hashBuffer, hashFile, hashTree, journal, readJournal, readJson, removeFile, writeFileAtomic, writeJsonAtomic } from '../../sync/lib/fsx.mjs';

let root;
let cfg;
const saved = { ...process.env };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fsx-'));
  cfg = path.join(root, 'config');
  fs.mkdirSync(cfg);
  process.env.CLAUDE_SETUP_TEST = '1';
  process.env.CLAUDE_SETUP_TEST_ROOT = root;
  process.env.CLAUDE_CONFIG_DIR = cfg;
});

after(() => {
  for (const k of ['CLAUDE_SETUP_TEST', 'CLAUDE_SETUP_TEST_ROOT', 'CLAUDE_CONFIG_DIR']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('hashFile normalizes CRLF for text, not for binary, null when missing', () => {
  const a = path.join(root, 'a.txt');
  const b = path.join(root, 'b.txt');
  fs.writeFileSync(a, 'one\r\ntwo\r\n');
  fs.writeFileSync(b, 'one\ntwo\n');
  assert.equal(hashFile(a), hashFile(b));
  assert.equal(hashFile(a), hashBuffer(Buffer.from('one\ntwo\n')));
  const c = path.join(root, 'c.bin');
  const d = path.join(root, 'd.bin');
  fs.writeFileSync(c, Buffer.from([0, 13, 10, 65]));
  fs.writeFileSync(d, Buffer.from([0, 10, 65]));
  assert.notEqual(hashFile(c), hashFile(d));
  assert.equal(hashFile(path.join(root, 'nope')), null);
});

test('hashTree is stable, order independent and content sensitive', () => {
  const t = path.join(root, 'tree');
  fs.mkdirSync(path.join(t, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(t, 'z.txt'), 'z');
  fs.writeFileSync(path.join(t, 'sub', 'a.txt'), 'a\r\n');
  const h1 = hashTree(t);
  assert.equal(hashTree(t), h1);
  fs.writeFileSync(path.join(t, 'sub', 'a.txt'), 'a\n');
  assert.equal(hashTree(t), h1);
  fs.writeFileSync(path.join(t, 'sub', 'a.txt'), 'b\n');
  assert.notEqual(hashTree(t), h1);
  assert.equal(hashFile(t), hashTree(t));
});

test('writeJsonAtomic and readJson round trip, no temp files left', () => {
  const p = path.join(root, 'j', 'x.json');
  writeJsonAtomic(p, { a: 1, b: [1, 2] });
  assert.deepEqual(readJson(p), { a: 1, b: [1, 2] });
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ['x.json']);
  assert.equal(readJson(path.join(root, 'missing.json'), 'fb'), 'fb');
  fs.writeFileSync(p, '{bad');
  assert.throws(() => readJson(p), /invalid JSON/);
});

test('copyAtomic keeps exact bytes', () => {
  const s = path.join(root, 's.bin');
  const d = path.join(root, 'out', 'd.bin');
  const bytes = Buffer.from([1, 2, 13, 10, 255, 0]);
  fs.writeFileSync(s, bytes);
  copyAtomic(s, d);
  assert.deepEqual(fs.readFileSync(d), bytes);
});

test('backupFile copies once per run per path under files/<rel>', () => {
  const f = path.join(cfg, 'hooks', 'x.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'first');
  const run = path.join(cfg, 'backups', 'r1');
  const b1 = backupFile(run, f);
  assert.equal(b1, path.join(run, 'files', 'hooks', 'x.js'));
  fs.writeFileSync(f, 'second');
  const b2 = backupFile(run, f);
  assert.equal(b2, b1);
  assert.equal(fs.readFileSync(b1, 'utf8'), 'first');
  assert.equal(backupFile(run, path.join(cfg, 'nothing.txt')), null);
  assert.throws(() => backupFile(run, path.join(root, 'outside.txt')), /outside the config dir/);
});

test('journal appends JSON lines and readJournal ignores a torn last line', () => {
  const run = path.join(cfg, 'backups', 'r2');
  journal(run, { ev: 'file', dest: 'a' });
  journal(run, { ev: 'file', dest: 'b' });
  fs.appendFileSync(path.join(run, 'journal.jsonl'), '{"ev":"fi');
  const ev = readJournal(run);
  assert.deepEqual(ev.map((e) => e.dest), ['a', 'b']);
  assert.ok(ev[0].t);
  assert.deepEqual(readJournal(path.join(cfg, 'backups', 'none')), []);
});

test('removeFile prunes empty parents below the top level only', () => {
  const f = path.join(cfg, 'skills', 'foo', 'ref', 'a.md');
  writeFileAtomic(f, 'x');
  removeFile(f, cfg);
  assert.equal(fs.existsSync(path.join(cfg, 'skills', 'foo')), false);
  assert.equal(fs.existsSync(path.join(cfg, 'skills')), true);
  const g = path.join(cfg, 'skills', 'bar', 'a.md');
  writeFileAtomic(g, 'x');
  writeFileAtomic(path.join(cfg, 'skills', 'bar', 'keep.md'), 'y');
  removeFile(g, cfg);
  assert.equal(fs.existsSync(path.join(cfg, 'skills', 'bar', 'keep.md')), true);
});

test('test-mode guard refuses paths and config dirs outside the root', () => {
  assert.equal(configDir(), path.resolve(cfg));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-outside-'));
  try {
    assert.throws(() => writeFileAtomic(path.join(outside, 'x.txt'), 'x'), /outside CLAUDE_SETUP_TEST_ROOT/);
    assert.equal(fs.existsSync(path.join(outside, 'x.txt')), false);
    assert.throws(() => assertAllowed(outside), /refusing/);
    const keep = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = outside;
    assert.throws(() => configDir(), /refusing/);
    process.env.CLAUDE_CONFIG_DIR = keep;
    const sneaky = path.join(root, '..', path.basename(outside));
    assert.throws(() => assertAllowed(sneaky), /refusing/);
    const keepRoot = process.env.CLAUDE_SETUP_TEST_ROOT;
    delete process.env.CLAUDE_SETUP_TEST_ROOT;
    assert.throws(() => assertAllowed(cfg), /refusing/);
    process.env.CLAUDE_SETUP_TEST_ROOT = keepRoot;
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
