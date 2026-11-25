import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { drift, main } from '../../owner/drift.mjs';

function write(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-repo-'));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cfg-'));
  write(dir, 'payload/skills/x/SKILL.md', 'line one\nline two\n');
  write(dir, 'payload/skills/x/notes.md', 'repo notes\n');
  write(dir, 'payload/hooks/h.js', 'hook\n');
  write(dir, 'payload/tpl/r.json', '{"v": "{{VALUE}}"}\n');
  write(dir, 'payload/seed/s.md', 'seed\n');
  write(dir, 'payload/rules/claude-manners--x.md', 'rule\n');
  const entry = {
    id: 'a', title: 'A', group: 'tools', level: 'optional', summary: 's', needs: [],
    files: [
      { src: 'payload/skills/x', dest: 'skills/x', mode: 'managed' },
      { src: 'payload/hooks/h.js', dest: 'hooks/h.js', mode: 'managed' },
      { src: 'payload/tpl/r.json', dest: 'tpl/r.json', mode: 'rendered' },
      { src: 'payload/seed/s.md', dest: 'seed/s.md', mode: 'seed' },
    ],
    settings: [], rules: ['payload/rules/claude-manners--x.md'],
    tokens_always_on: { value: null, how: 'not measured yet' },
  };
  write(dir, 'catalog/a.json', JSON.stringify(entry, null, 2) + '\n');
  write(cfg, 'skills/x/SKILL.md', 'line one\r\nline two\r\n');
  write(cfg, 'skills/x/notes.md', 'live notes\n');
  write(cfg, 'skills/x/extra.md', 'only live\n');
  write(cfg, 'tpl/r.json', '{"v": "filled"}\n');
  write(cfg, 'seed/s.md', 'changed seed\n');
  return { dir, cfg };
}

const clean = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('drift reports every status, skips seed and lists rules', () => {
  const { dir, cfg } = makeFixture();
  try {
    const r = drift(dir, cfg);
    assert.equal(r.parts.length, 1);
    const byDest = Object.fromEntries(r.parts[0].files.map((f) => [f.dest, f.status]));
    assert.deepEqual(byDest, {
      'skills/x/SKILL.md': 'same',
      'skills/x/notes.md': 'differs',
      'skills/x/extra.md': 'live-only',
      'hooks/h.js': 'missing-live',
      'tpl/r.json': 'differs (rendered, check by hand)',
    });
    assert.equal(r.parts[0].files.find((f) => f.dest === 'hooks/h.js').src, 'payload/hooks/h.js');
    assert.ok(!('seed/s.md' in byDest));
    assert.deepEqual(r.rules, [{ id: 'a', src: 'payload/rules/claude-manners--x.md', dest: 'rules/claude-manners--x.md' }]);
    assert.deepEqual(r.summary, { differ: 2, missingLive: 1, liveOnly: 1, same: 1, rules: 1 });
  } finally { clean(dir, cfg); }
});

test('main prints json with --json, hides same lines unless --all, and never writes', () => {
  const { dir, cfg } = makeFixture();
  const logs = [];
  const orig = console.log;
  console.log = (s) => logs.push(String(s));
  try {
    const before = fs.readdirSync(cfg, { recursive: true }).sort();
    assert.equal(main(['--repo', dir, '--config-dir', cfg, '--json']), 0);
    const j = JSON.parse(logs.pop());
    assert.deepEqual(j.parts[0].files.map((f) => f.status).sort(), ['differs', 'differs (rendered, check by hand)', 'live-only', 'missing-live']);
    assert.equal(j.rules.length, 1);
    assert.equal(j.summary.same, 1);

    logs.length = 0;
    assert.equal(main(['--repo', dir, '--config-dir', cfg]), 0);
    assert.ok(!logs.some((l) => l.includes('SKILL.md')));
    assert.ok(logs.includes('  generalized, compare by hand: payload/rules/claude-manners--x.md -> rules/claude-manners--x.md'));
    assert.equal(logs.at(-1), 'drift: 2 differ, 1 missing-live, 1 live-only, 1 same; 1 rule files to compare by hand');

    logs.length = 0;
    assert.equal(main(['--repo', dir, '--config-dir', cfg, '--all']), 0);
    assert.ok(logs.includes('  same  skills/x/SKILL.md'));

    assert.deepEqual(fs.readdirSync(cfg, { recursive: true }).sort(), before);
  } finally {
    console.log = orig;
    clean(dir, cfg);
  }
});

test('bad arguments exit 2, an unreadable catalog exits 1', () => {
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal(main(['--nope']), 2);
    assert.equal(main(['--repo']), 2);
    assert.equal(main(['extra']), 2);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-empty-'));
    try { assert.equal(main(['--repo', empty, '--config-dir', empty]), 1); } finally { clean(empty); }
  } finally { console.error = err; }
});
