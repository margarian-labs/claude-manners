import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffNames, fetchAndUpdate, git, headCommit, isAfter, listTags, lsTree, resolveVersion, showFileAt } from '../../sync/lib/repo.mjs';

let root;
let repo;
let c1;
let c2;
let c3;
const saved = { ...process.env };

const commit = (msg) => {
  git(['add', '-A'], repo);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg], repo);
  return headCommit(repo);
};

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-repo-'));
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'core.autocrlf', 'false'], repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\r\nb\r\n');
  fs.writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 13, 10, 255]));
  fs.mkdirSync(path.join(repo, 'dir', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'dir', 'sub', 'f.txt'), 'f');
  c1 = commit('one');
  git(['tag', 'v1'], repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  c2 = commit('two');
  git(['tag', '-a', 'v2', '-m', 'second release'], repo);
  fs.writeFileSync(path.join(repo, 'new.txt'), 'n');
  c3 = commit('three');
});

after(() => {
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('headCommit and resolveVersion resolve tags, annotated tags and shas', () => {
  assert.equal(headCommit(repo), c3);
  assert.equal(resolveVersion(repo, 'v1'), c1);
  assert.equal(resolveVersion(repo, 'v2'), c2);
  assert.equal(resolveVersion(repo, c2.slice(0, 10)), c2);
  assert.throws(() => resolveVersion(repo, 'nope'));
});

test('showFileAt returns the committed bytes exactly', () => {
  assert.deepEqual(showFileAt(repo, c1, 'a.txt'), Buffer.from('a\r\nb\r\n'));
  assert.deepEqual(showFileAt(repo, c1, 'bin.dat'), Buffer.from([0, 1, 2, 13, 10, 255]));
  assert.equal(showFileAt(repo, c2, 'a.txt').toString(), 'changed\n');
  assert.throws(() => showFileAt(repo, c1, 'new.txt'));
});

test('lsTree lists files recursively, a file path returns itself', () => {
  assert.deepEqual(lsTree(repo, c1, 'dir').map((t) => t.path), ['dir/sub/f.txt']);
  assert.deepEqual(lsTree(repo, c1, 'a.txt').map((t) => t.path), ['a.txt']);
  assert.deepEqual(lsTree(repo, c1, 'missing'), []);
});

test('listTags returns newest first with sha and message', () => {
  const tags = listTags(repo);
  assert.deepEqual(tags.map((t) => t.tag), ['v2', 'v1']);
  assert.deepEqual(tags.map((t) => t.sha), [c2, c1]);
  assert.equal(tags[0].message, 'second release');
});

test('isAfter and diffNames', () => {
  assert.equal(isAfter(repo, c3, c1), true);
  assert.equal(isAfter(repo, c1, c3), false);
  assert.equal(isAfter(repo, c1, c1), false);
  assert.equal(isAfter(repo, 'deadbeef', c1), false);
  assert.deepEqual(diffNames(repo, c1, c3).sort(), ['a.txt', 'new.txt']);
});

test('fetchAndUpdate fast-forwards a clone and reports from and to', () => {
  const clone = path.join(root, 'clone');
  git(['clone', '-q', repo, clone], root);
  assert.equal(headCommit(clone), c3);
  fs.writeFileSync(path.join(repo, 'later.txt'), 'l');
  const c4 = commit('four');
  git(['tag', 'v3'], repo);
  const r = fetchAndUpdate(clone);
  assert.deepEqual(r, { from: c3, to: c4 });
  assert.equal(listTags(clone)[0].tag, 'v3');
  assert.deepEqual(fetchAndUpdate(clone), { from: c4, to: c4 });
});
