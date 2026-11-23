import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanFiles } from '../../owner/dash-scan.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../owner/dash-scan.mjs');
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-scan-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, '--repo', dir, ...args], { encoding: 'utf8' });

test('scanFiles reports line numbers for both dashes', () => {
  const dir = makeRepo({ 'a.md': `ok\nbad ${EM} here\nfine\n1${EN}2\n`, 'b.md': 'clean - hyphen\n' });
  const hits = scanFiles(dir, ['a.md', 'b.md']);
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}:${h.char}`), ['a.md:2:U+2014', 'a.md:4:U+2013']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 1 and lists file:line for tracked files', () => {
  const dir = makeRepo({ 'sub/x.txt': `one\ntwo ${EM}\n`, 'y.txt': 'clean\n' });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /sub\/x\.txt:2: U\+2014/);
  assert.doesNotMatch(r.stdout, /y\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 0 on clean repo and skips binary files', () => {
  const dir = makeRepo({ 'a.txt': 'plain\n', 'bin.dat': Buffer.concat([Buffer.from([0]), Buffer.from(EM)]) });
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--files limits the scan', () => {
  const dir = makeRepo({ 'bad.txt': `x${EM}y\n`, 'good.txt': 'fine\n' });
  assert.equal(run(dir, '--files', 'good.txt').status, 0);
  const r = run(dir, '--files', 'bad.txt', 'good.txt');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /bad\.txt:1/);
  fs.rmSync(dir, { recursive: true, force: true });
});
