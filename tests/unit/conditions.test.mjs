import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, defaultRun, runVerify, makeFableAccess, makeSecondProfile, makeMemohopperConnected, makeWhich, defaultCtx } from '../../sync/lib/conditions.mjs';

const ctx = (o = {}) => ({
  platform: 'win32', state: {}, configDir: '/x', which: (c) => c === 'node', installedParts: new Set(['status-line']), plugins: new Set(['figma']),
  claudeVersion: '2.1.5 (Claude Code)', secondProfile: () => true, memohopperConnected: () => false, fableAccess: () => 'unknown', ...o,
});

test('each need form', () => {
  const c = ctx();
  assert.equal(check('windows', c), true);
  assert.equal(check('windows', ctx({ platform: 'linux' })), false);
  assert.equal(check('second-profile', c), true);
  assert.equal(check('memohopper-connected', c), false);
  assert.equal(check('fable-access', c), 'unknown');
  assert.equal(check('fable-access', ctx({ fableAccess: () => false })), false);
  assert.equal(check('haiku-access', c), 'unknown');
  assert.equal(check('haiku-access', ctx({ haikuAccess: () => true })), true);
  assert.equal(check('part:status-line', c), true);
  assert.equal(check('part:other', c), false);
  assert.equal(check('plugin:figma', c), true);
  assert.equal(check('plugin:x', c), false);
  assert.equal(check('cmd:node', c), true);
  assert.equal(check('cmd:git', c), false);
  assert.equal(check('claude>=2.1.5', c), true);
  assert.equal(check('claude>=2.1', c), true);
  assert.equal(check('claude>=2.1.6', c), false);
  assert.equal(check('claude>=10', c), false);
  assert.equal(check('claude>=2', ctx({ claudeVersion: '10.0.0' })), true);
  assert.equal(check('claude>=2', ctx({ claudeVersion: null })), 'unknown');
  assert.throws(() => check('bogus', c), /unknown need/);
});

const NOW = Date.parse('2026-11-23T12:00:00Z');

test('fableAccess: exit 0 true and cached', () => {
  const state = {};
  const calls = [];
  const run = (cmd, args, opts) => { calls.push([cmd, args, opts]); return { status: 0, stdout: 'ok', stderr: '' }; };
  const f = makeFableAccess({ state, run, now: () => NOW });
  assert.equal(f(), true);
  assert.deepEqual(calls[0][1], ['-p', '--model', 'claude-fable-5-2', '--max-turns', '1', 'Reply ok']);
  assert.equal(calls[0][2].timeout, 120000);
  assert.deepEqual(state.facts, { fable_access: true, checked_at: new Date(NOW).toISOString() });
  assert.equal(f(), true);
  assert.equal(calls.length, 1);
});

test('fableAccess: cache expires after 7 days', () => {
  const state = { facts: { fable_access: true, checked_at: new Date(NOW - 8 * 24 * 3600 * 1000).toISOString() } };
  let n = 0;
  const run = () => { n++; return { status: 1, stdout: '', stderr: 'error: unrecognized_model claude-fable-5-2' }; };
  assert.equal(makeFableAccess({ state, run, now: () => NOW })(), false);
  assert.equal(n, 1);
  assert.equal(state.facts.fable_access, false);
  const fresh = { facts: { fable_access: false, checked_at: new Date(NOW - 6 * 24 * 3600 * 1000).toISOString() } };
  assert.equal(makeFableAccess({ state: fresh, run, now: () => NOW })(), false);
  assert.equal(n, 1);
});

test('fableAccess: other failures are unknown and not cached', () => {
  const state = {};
  assert.equal(makeFableAccess({ state, run: () => ({ status: 1, stdout: 'network down', stderr: '' }), now: () => NOW })(), 'unknown');
  assert.equal(makeFableAccess({ state, run: () => ({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') }), now: () => NOW })(), 'unknown');
  assert.equal(state.facts, undefined);
});

test('memohopperConnected', () => {
  assert.equal(makeMemohopperConnected({ run: () => ({ status: 0, stdout: 'memohopper: https://x - connected', stderr: '' }) })(), true);
  assert.equal(makeMemohopperConnected({ run: () => ({ status: 0, stdout: 'other: x', stderr: '' }) })(), false);
  assert.equal(makeMemohopperConnected({ run: () => ({ status: null, stdout: '', stderr: '', error: new Error('x') }) })(), false);
});

test('secondProfile: another ~/.claude-* with settings.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cond-'));
  try {
    const cfg = path.join(home, '.claude');
    fs.mkdirSync(cfg);
    fs.writeFileSync(path.join(cfg, 'settings.json'), '{}');
    assert.equal(makeSecondProfile({ home, configDir: cfg })(), false);
    fs.mkdirSync(path.join(home, '.claude-empty'));
    assert.equal(makeSecondProfile({ home, configDir: cfg })(), false);
    fs.mkdirSync(path.join(home, '.claude-personal'));
    fs.writeFileSync(path.join(home, '.claude-personal', 'settings.json'), '{}');
    assert.equal(makeSecondProfile({ home, configDir: cfg })(), true);
    assert.equal(makeSecondProfile({ home, configDir: path.join(home, '.claude-personal') })(), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('which and defaultCtx with injected environment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cond-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'mytool.EXE'), '');
    const w = makeWhich({ env: { PATH: bin, PATHEXT: '.EXE' }, platform: 'win32' });
    assert.equal(w('mytool'), true);
    assert.equal(w('nothing'), false);
    const cfg = path.join(dir, 'cfg');
    fs.mkdirSync(cfg);
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ enabledPlugins: { 'figma@official': true, 'off@x': false } }));
    const state = { parts: { a: { installed: true }, b: { installed: false } } };
    const c = defaultCtx({ state, configDir: cfg, home: dir, run: () => ({ status: 0, stdout: '2.1.5 (Claude Code)\n', stderr: '' }), platform: 'win32', env: { PATH: bin, PATHEXT: '.EXE' } });
    assert.deepEqual([...c.installedParts], ['a']);
    assert.deepEqual([...c.plugins], ['figma']);
    assert.equal(c.claudeVersion, '2.1.5 (Claude Code)');
    assert.equal(check('claude>=2.1', c), true);
    assert.equal(check('cmd:mytool', c), true);
    assert.equal(check('second-profile', c), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const gitBashDir = () => (process.env.PATH || '').split(path.delimiter).find((d) => d && !/system32/i.test(d) && fs.existsSync(path.join(d, 'bash.exe')));

test('defaultRun starts an npm-style claude shim (no claude.exe) and passes every argument exactly', { skip: process.platform !== 'win32' || !gitBashDir() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-shim-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\nfor a in "$@"; do printf \'%s\n\' "$a"; done\n');
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\necho cmd shim\r\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
    env.PATH = [dir, gitBashDir()].join(path.delimiter);
    const args = ['mcp', 'add-json', 'srv', '{"command":"node","args":["C:\\a b\\x.js","*","~/{a,b}"]}', '-s', 'user'];
    const r = defaultRun('claude', args, { env });
    assert.equal(r.error, null);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.split('\n').slice(0, -1), args);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runVerify gives the command the config folder, but a child program sees it only when it was exported before', { skip: process.platform !== 'win32' || !gitBashDir() }, () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-verify-'));
  try {
    const env = { ...process.env };
    delete env.CLAUDE_CONFIG_DIR;
    const cmd = 'test -n "$CLAUDE_CONFIG_DIR" && test "$CLAUDE_SETUP_REPO" = /the/clone && test -z "${CS_VERIFY_CFG:-}" && printenv CLAUDE_CONFIG_DIR';
    const run = (e) => runVerify(cmd, { cfg, repo: '/the/clone', env: { ...e, MSYS_NO_PATHCONV: '1', MSYS2_ENV_CONV_EXCL: '*' } });
    const plain = run(env);
    assert.equal(plain.error, undefined);
    assert.equal(plain.status, 1, `stdout: ${plain.stdout} stderr: ${plain.stderr}`);
    assert.equal(plain.stdout, '');
    const exported = run({ ...env, CLAUDE_CONFIG_DIR: 'C:\\other' });
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(path.resolve(exported.stdout.trim()), path.resolve(cfg));
    assert.equal(runVerify('test "$PWD" -ef "$CLAUDE_CONFIG_DIR"', { cfg, repo: '', env }).status, 0);
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true });
  }
});
