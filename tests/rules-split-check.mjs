// Checks that payload/rules/claude-setup--*.md (parts 1-12) hold every non-empty line of the pack's core.md exactly once.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ZIP = process.env.PACK_ZIP || path.join(os.homedir(), 'Desktop', 'Claude-Setup-Pack-2026-11-21.zip');
const ENTRY = 'Claude-Setup-Pack-2026-11-21/01-rules/core.md';
const RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'payload', 'rules');
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// Split edits: a source line that lost a sentence. removed = text cut from the end of the line,
// moved = the bullet that carries it in another file.
const SPLITS = {
  'Before editing a config file outside git': {
    removed: ' Backups are auto-deleted after 90 days.',
    moved: '- Backups are auto-deleted after 90 days.',
  },
  'Pick skills yourself.': {
    removed: ' Exception: /hallmark (about $1.80 and 4-6 min per page): for a new website, landing or marketing page, first ask me whether to use it and wait for my answer before building.',
    moved: '- Exception: /hallmark (about $1.80 and 4-6 min per page): for a new website, landing or marketing page, first ask me whether to use it and wait for my answer before building.',
  },
};
// Lines added per file (parent headings, intro heading, copied table header). Each is stripped once.
const ADDED = {
  'away-mode': ['## Prompt Shortcut Flags', '| Flag | Meaning |', '|---|---|', '## Workflow Rules'],
  handoff: ['## Workflow Rules'],
  'plugin-superpowers': ['## Workflow Rules'],
  'skill-hallmark': ['## Workflow Rules', '### Pick skills yourself (exception)'],
  tidy: ['### Clean up after yourself'],
  'disk-watchdog': ['### Clean up after yourself'],
  'core-rules': ['### Documents'],
};
const PLANNER_REPLACEMENTS = 3;

const problems = [];
const source = execFileSync('unzip', ['-p', ZIP, ENTRY], { encoding: 'utf8', maxBuffer: 1 << 24 })
  .replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');

const count = (arr) => arr.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());

// expected multiset
// Pack header lines rewritten for claude-setup (flat sync-managed rules).
const RENAMED = new Map([
  ['# Setup pack rules: core', '# claude-setup rules: core'],
  ['Installed by the setup pack into ~/.claude/rules/setup-pack/. Claude Code loads it every session. A re-install replaces this file, so keep your own changes in your CLAUDE.md, or back this file up first.',
    'Installed by claude-setup into ~/.claude/rules/ and loaded every session. Sync manages this file: if you edit it, sync keeps your edit and asks before any update.'],
]);
const expected = [];
for (const raw of source) {
  const line = RENAMED.get(raw) ?? raw;
  const key = Object.keys(SPLITS).find((k) => line.replace(/^- \*\*/, '').startsWith(k) || line.includes(k));
  if (key) {
    const s = SPLITS[key];
    if (!line.endsWith(s.removed)) { problems.push('split marker not at line end: ' + line.slice(0, 60)); expected.push(line); continue; }
    expected.push(line.slice(0, -s.removed.length), s.moved);
  } else expected.push(line);
}
// copied table header rows appear once more in away-mode (stripped there via ADDED), so no extra expected copies.

const files = fs.readdirSync(RULES).filter((f) => /^claude-setup--(core|style-and-coding|flags|away-mode|workflow|handoff|superpowers|hallmark|tidy|disk-watchdog|liteparse|subagents)\.md$/.test(f)).sort();
if (files.length !== 12) problems.push('expected 12 part files, found ' + files.length);

const actual = [];
let planner = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(RULES, f), 'utf8');
  if (text.includes(EM) || text.includes(EN)) problems.push(f + ': contains em or en dash');
  const lines = text.replace(/\r/g, '').split('\n');
  const m = /^<!-- claude-setup part: (\S+) -->$/.exec(lines[0]);
  if (!m) { problems.push(f + ': first line is not the part comment'); continue; }
  const strip = [...(ADDED[m[1]] || [])];
  for (const l of lines.slice(1)) {
    if (l.trim() === '') continue;
    const i = strip.indexOf(l);
    if (i >= 0) { strip.splice(i, 1); continue; }
    if (l.includes('{{planner_model}}')) planner += l.split('{{planner_model}}').length - 1;
    actual.push(l.split('{{planner_model}}').join('Fable 5.2'));
  }
  if (strip.length) problems.push(f + ': expected added lines not found: ' + strip.join(' | '));
}
if (planner !== PLANNER_REPLACEMENTS) problems.push(`planner_model count ${planner}, expected ${PLANNER_REPLACEMENTS}`);

const ec = count(expected), ac = count(actual);
for (const [l, n] of ec) {
  const a = ac.get(l) || 0;
  if (a === 0) problems.push('MISSING: ' + l.slice(0, 100));
  else if (a > n) problems.push(`DUPLICATE (x${a}): ` + l.slice(0, 100));
  else if (a < n) problems.push(`MISSING copy (${a}/${n}): ` + l.slice(0, 100));
}
for (const [l, n] of ac) if (!ec.has(l)) problems.push('EXTRA (not in source): ' + l.slice(0, 100));

// dash check on the other rule file too
for (const f of ['claude-setup--two-accounts.md']) {
  const p = path.join(RULES, f);
  if (!fs.existsSync(p)) { problems.push('missing ' + f); continue; }
  const t = fs.readFileSync(p, 'utf8');
  if (t.includes(EM) || t.includes(EN)) problems.push(f + ': contains em or en dash');
}

if (problems.length) { console.log(problems.join('\n')); console.log('FAIL'); process.exit(1); }
console.log(`source lines: ${source.length}, expected: ${expected.length}, actual: ${actual.length}`);
console.log('PASS');
