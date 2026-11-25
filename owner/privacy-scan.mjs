#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const DEFAULT_ALLOW = path.join(HERE, 'privacy-allow.json');

const USAGE = `Usage: node owner/privacy-scan.mjs [--all | --files <f...>] [--json] [--allow <file>] [--root <dir>]
Default: staged files plus untracked, not ignored files. Exit 0 clean, 1 findings, 2 usage error.
Personal word list: file at CLAUDE_SETUP_PRIVACY_WORDS or ~/.claude/state/claude-manners/privacy-words.txt`;

const SAFE_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'company.com'];
const FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'mjs', 'json', 'html'];
const SAFE_USER_NAMES = ['<name>', 'user', 'username', 'you', 'me', 'example', 'public', 'default', '%username%', '$user', '${user}', 'name', 'test', 'bob', 'bob smith', 'data', 'some.one'];
const NAME = String.raw`([^\\/\s"'<>|:*?,;()\[\]{}\x60]+)`;

const RULES = [
  { id: 'key-aws', re: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g },
  { id: 'key-github', re: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { id: 'key-slack', re: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'key-telegram', re: /(?<![A-Za-z0-9])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g },
  { id: 'key-anthropic', re: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'key-openai', re: /(?<![A-Za-z0-9])sk-(?!ant-)(?:(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{20,})/g },
  { id: 'key-private', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'key-jwt', re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g },
  { id: 'key-generic', re: /(?:api[_-]?key|secret|token|password)['"]?\s*[:=]\s*['"]([^'"]{12,})/gdi, group: 1 },
  { id: 'email', re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g },
  { id: 'path-home', re: new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}` + NAME, 'gdi'), group: 1 },
  { id: 'path-home', re: new RegExp(String.raw`(?<![A-Za-z0-9_.:-])/(?:mnt/)?[a-z]/Users/` + NAME, 'gd'), group: 1 },
  { id: 'path-home', re: new RegExp(String.raw`(?<![A-Za-z0-9_.:-])/(?:Users|home)/` + NAME, 'gd'), group: 1 },
];
const ENTROPY_RE = /[A-Za-z0-9+/=_-]{32,}/g;
const WORD_SEGMENT = /^(?:[a-z0-9]+|[A-Z0-9]+|[A-Z][a-z0-9]+)$/;
const PLACEHOLDER_VALUE = /\$\{|\{\{|<[^>]*>|%[A-Za-z_]+%|^\$|^\.\.\./;

export function mask(s) {
  const k = Math.min(2, Math.floor(s.length / 4));
  const mid = Math.min(s.length - 2 * k, 12);
  return s.slice(0, k) + '*'.repeat(mid) + (k ? s.slice(-k) : '');
}

export function identifierLike(tok) {
  if (/^[A-Za-z]+$/.test(tok)) return true;
  const segs = tok.split(/[-_/=+]+/).filter(Boolean);
  return segs.length > 1 && segs.every((x) => WORD_SEGMENT.test(x));
}

export function entropy(s) {
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) || 0) + 1);
  let h = 0;
  for (const n of f.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

export function globToRegExp(glob) {
  const g = glob.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

export function loadAllow(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = (k) => {
    const v = j[k] ?? [];
    if (!Array.isArray(v)) throw new Error(`allow-list "${k}" must be an array`);
    return v;
  };
  const text = (e, k) => {
    const v = typeof e === 'string' ? e : e && (k === 'paths' ? e.glob : e.value);
    if (typeof v !== 'string' || !v) throw new Error(`allow-list "${k}" entry needs a ${k === 'paths' ? 'glob' : 'value'}`);
    return v;
  };
  return {
    emails: list('emails').map((e) => text(e, 'emails').toLowerCase()),
    strings: list('strings').map((e) => text(e, 'strings')),
    paths: list('paths').map((e) => ({
      re: globToRegExp(text(e, 'paths')),
      rules: typeof e === 'string' || !e.rules ? null : e.rules,
    })),
  };
}

export const EMPTY_ALLOW = { emails: [], strings: [], paths: [] };

export function defaultWordsPath() {
  const at = (name) => path.join(os.homedir(), '.claude', 'state', name, 'privacy-words.txt');
  return !fs.existsSync(at('claude-manners')) && fs.existsSync(at('claude-setup')) ? at('claude-setup') : at('claude-manners');
}

export function loadWords(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch {
    return { re: null, warning: `personal word list not found (${file}); the word rule is off` };
  }
  const words = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!words.length) return { re: null, warning: `personal word list is empty (${file}); the word rule is off` };
  const parts = words.sort((a, b) => b.length - a.length)
    .map((w) => w.split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${parts.join('|')})(?![\p{L}\p{N}_])`, 'giu');
  return { re, warning: null };
}

function emailAllowed(email, allow) {
  const e = email.toLowerCase();
  const d = e.slice(e.lastIndexOf('@') + 1);
  if (d === 'test' || d.endsWith('.test')) return true;
  if (FILE_EXTENSIONS.includes(d.slice(d.lastIndexOf('.') + 1))) return true;
  if (SAFE_EMAIL_DOMAINS.some((x) => d === x || d.endsWith('.' + x))) return true;
  return allow.emails.some((a) => (a.startsWith('@') ? d === a.slice(1) || d.endsWith(a) : a === e));
}

function pathNameAllowed(name) {
  const n = name.replace(/\.+$/, '').toLowerCase();
  return !n || SAFE_USER_NAMES.includes(n) || /^[$%{<[~]/.test(n);
}

export function scanText(text, { allow = EMPTY_ALLOW, words = null, skipRules = [] } = {}) {
  const skipped = (id) => skipRules.some((r) => id === r || id.startsWith(r + '-'));
  const rules = RULES.filter((r) => !skipped(r.id));
  const useWords = words && !skipped('word');
  const useEntropy = !skipped('entropy');
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (!line) continue;
    const spans = [];
    const add = (rule, start, raw, full) => {
      const end = start + raw.length;
      if (spans.some(([a, b]) => start < b && end > a)) return;
      if (allow.strings.includes(raw) || (full && allow.strings.includes(full))) return;
      if (allow.strings.some((s) => { for (let i = line.indexOf(s); i >= 0; i = line.indexOf(s, i + 1)) if (i <= start && i + s.length >= end) return true; return false; })) return;
      spans.push([start, end]);
      findings.push({ line: ln + 1, col: start + 1, rule, raw });
    };
    const consider = (id, re, group) => {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const raw = group ? m[group] : m[0];
        const start = group ? m.indices[group][0] : m.index;
        if (id === 'email' && emailAllowed(raw, allow)) continue;
        if (id === 'path-home' && pathNameAllowed(raw)) continue;
        if (id === 'key-generic' && PLACEHOLDER_VALUE.test(raw)) continue;
        add(id, start, id === 'path-home' ? raw.replace(/\.+$/, '') : raw, m[0]);
      }
    };
    for (const r of rules) consider(r.id, r.re, r.group);
    if (useWords) consider('word', words, 0);
    if (useEntropy) {
      for (const m of line.matchAll(ENTROPY_RE)) {
        if (entropy(m[0]) > 4.0 && !identifierLike(m[0])) add('entropy', m.index, m[0]);
      }
    }
  }
  return findings;
}

function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').slice(1);
  if (buf.includes(0)) return null;
  return buf.toString('utf8').replace(/^﻿/, '');
}

function parseArgs(argv) {
  const o = { all: false, files: null, json: false, allow: null, root: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') o.all = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--allow' || a === '--root') {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = argv[++i];
    } else if (a === '--files') {
      o.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.files.push(argv[++i]);
      if (!o.files.length) throw new Error('--files needs at least one file');
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (o.all && o.files) throw new Error('--all and --files cannot be combined');
  return o;
}

function git(root, args, asBuffer = false) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 1 << 30, encoding: asBuffer ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const nul = (s) => s.split('\0').filter(Boolean);

function listInputs(o, root) {
  if (o.files) {
    return o.files.map((f) => {
      const abs = path.resolve(f);
      if (!fs.existsSync(abs)) throw new Error(`file not found: ${f}`);
      let rel = path.relative(root, abs).split(path.sep).join('/');
      if (rel.startsWith('..') || path.isAbsolute(rel)) rel = abs.split(path.sep).join('/');
      return { rel, read: () => fs.readFileSync(abs) };
    });
  }
  const fromFs = (rel) => ({ rel, read: () => fs.readFileSync(path.join(root, rel)) });
  try {
    if (o.all) return nul(git(root, ['ls-files', '-z'])).map(fromFs);
    const staged = nul(git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
    const untracked = nul(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
    return [
      ...staged.map((rel) => ({ rel, read: () => git(root, ['show', ':' + rel], true) })),
      ...untracked.map(fromFs),
    ];
  } catch (e) {
    throw new Error(`git failed in ${root}: ${String(e.stderr || e.message).trim()}`);
  }
}

function pathSkips(rel, allow) {
  const rules = [];
  for (const p of allow.paths) {
    if (!p.re.test(rel)) continue;
    if (!p.rules) return null;
    rules.push(...p.rules);
  }
  return rules;
}

export function run(argv, env = process.env) {
  const fail = (msg) => ({ code: 2, stdout: '', stderr: `privacy-scan: ${msg}\n${USAGE}\n` });
  let o;
  try { o = parseArgs(argv); } catch (e) { return fail(e.message); }
  if (o.help) return { code: 0, stdout: USAGE + '\n', stderr: '' };
  const root = path.resolve(o.root || DEFAULT_ROOT);
  let allow, inputs;
  try { allow = loadAllow(o.allow || DEFAULT_ALLOW); } catch (e) { return fail(`cannot read allow-list: ${e.message}`); }
  try { inputs = listInputs(o, root); } catch (e) { return fail(e.message); }
  const { re: words, warning } = loadWords(env.CLAUDE_SETUP_PRIVACY_WORDS || defaultWordsPath());
  const warnings = warning ? [warning] : [];
  const findings = [];
  const binary = [];
  let scanned = 0;
  for (const f of inputs) {
    const skips = pathSkips(f.rel, allow);
    if (skips === null) continue;
    let text;
    try { text = decode(f.read()); } catch (e) { warnings.push(`cannot read ${f.rel}: ${e.code || e.message}`); continue; }
    scanned++;
    if (words && !skips.includes('word')) {
      for (const m of f.rel.matchAll(words)) findings.push({ file: f.rel, line: 0, col: m.index + 1, rule: 'word', text: mask(m[0]) });
    }
    if (text === null) { binary.push(f.rel); continue; }
    for (const x of scanText(text, { allow, words, skipRules: skips })) {
      findings.push({ file: f.rel, line: x.line, col: x.col, rule: x.rule, text: mask(x.raw) });
    }
  }
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col));
  const code = findings.length ? 1 : 0;
  if (o.json) {
    return { code, stdout: JSON.stringify({ ok: code === 0, scanned, findings, binarySkipped: binary, warnings }, null, 2) + '\n', stderr: '' };
  }
  const out = findings.map((f) => `${f.file}:${f.line}:${f.col}  ${f.rule}  ${f.text}`);
  for (const b of binary) out.push(`binary, not scanned: ${b}`);
  out.push(`privacy-scan: ${scanned} files scanned, ${findings.length} findings, ${binary.length} binary skipped`);
  return { code, stdout: out.join('\n') + '\n', stderr: warnings.map((w) => `warning: ${w}\n`).join('') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
