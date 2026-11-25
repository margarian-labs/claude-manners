import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runVerify } from '../../sync/lib/conditions.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fwd = (p) => p.replace(/\\/g, '/');

const gitBashDir = () => (process.env.PATH || '').split(path.delimiter).find((d) => d && !/system32/i.test(d) && fs.existsSync(path.join(d, 'bash.exe')));
const SKIP = process.platform !== 'win32' || !gitBashDir() ? 'needs Windows and Git Bash' : false;

const DROPPED = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_VOICE', 'HOOK_BG', 'CLAUDE_TITLE_GEN', 'CLAUDE_CODE_SESSION_ID', 'HANDOFF_PROMPT_PCT', 'HANDOFF_PROMPT_ANY_ENTRYPOINT', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'HOME', 'USERPROFILE']);

function setEnv(env, key, value) {
  for (const k of Object.keys(env)) if (k.toUpperCase() === key.toUpperCase()) delete env[k];
  if (value !== undefined) env[key] = value;
}

function cleanEnv(homeDir, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const u = k.toUpperCase();
    if (DROPPED.has(u) || u.startsWith('SESSION_NAMER_')) continue;
    env[k] = v;
  }
  env.HOME = fwd(homeDir);
  env.USERPROFILE = homeDir;
  for (const [k, v] of Object.entries(extra)) setEnv(env, k, v);
  return env;
}

const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, ...opts });

const linkOrCopy = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
};

const catalogDir = path.join(REPO, 'catalog');
const catalog = () => fs.readdirSync(catalogDir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(catalogDir, f), 'utf8')));

let root;
let stub;
let sample;
let counter = 0;

function mergeInto(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) dst[k] = [...(dst[k] || []), ...v];
    else if (v && typeof v === 'object') mergeInto((dst[k] ||= {}), v);
    else if (dst[k] === undefined) dst[k] = v;
  }
}

function makeHome(name, { skills = false } = {}) {
  const home = path.join(root, `${name}-${counter++}`);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const settings = {};
  for (const entry of catalog()) {
    for (const s of entry.settings || []) {
      const file = path.join(REPO, s);
      if (fs.existsSync(file)) mergeInto(settings, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    for (const f of entry.files || []) {
      if ((f.dest.startsWith('skills/') && !skills) || f.dest.includes('{memory_dir}')) continue;
      const src = path.join(REPO, f.src);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(home, '.claude', f.dest);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(src, dst, { recursive: true });
    }
    for (const rule of entry.rules || []) {
      const src = path.join(REPO, rule);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.join(home, '.claude', 'rules'), { recursive: true });
      fs.copyFileSync(src, path.join(home, '.claude', 'rules', path.basename(rule)));
    }
  }
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  return home;
}

const newDir = (prefix) => fs.mkdtempSync(path.join(root, prefix));

before(() => {
  if (SKIP) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-hooks-'));
  sample = path.join(root, 'sample-transcript.jsonl');
  fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', 'handoff-transcript.jsonl'), sample);
  stub = path.join(root, 'stub-claude.js');
  fs.writeFileSync(stub, 'process.stdout.write(JSON.stringify({ structured_output: { name: "Orders page CSV export", currentStillFits: false }, total_cost_usd: 0 }));\n');
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin', 'curl'), '#!/usr/bin/env bash\necho "curl $*" >> "$CURL_LOG"\ncat > /dev/null\n', { mode: 0o755 });
});

after(() => {
  if (!root) return;
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
});

const t = (name, ...rest) => {
  const fn = rest.pop();
  test(name, { skip: SKIP, timeout: 600000, ...rest[0] }, fn);
};

const HOOK_EXPECTATIONS = [
  { match: /session-id\.sh/, stdout: 'Session ID: t1' },
  { match: /auto-approve-shell\.sh/, stdout: '"behavior":"allow"' },
  { match: /compact-recovery\.sh/, stdout: 'Context was just compacted' },
  { match: /handoff-prompt\.sh/, stdout: 'Handoff check', env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000', HANDOFF_PROMPT_PCT: '0.8' } },
  { match: /compact-instructions\.md/, nonEmpty: true },
  { match: /session-namer\.sh/, env: () => ({ SESSION_NAMER_SYNC: '1', SESSION_NAMER_CLAUDE_CMD: stub }) },
];

t('every registered hook command runs', () => {
  const home = makeHome('hooks');
  const fragments = fs.readdirSync(path.join(REPO, 'payload', 'settings', 'fragments')).filter((f) => /^hooks-.*\.json$/.test(f)).sort();
  assert.ok(fragments.length > 0);
  const covered = new Set();
  const failures = [];
  let ran = 0;
  for (const frag of fragments) {
    const settings = JSON.parse(fs.readFileSync(path.join(REPO, 'payload', 'settings', 'fragments', frag), 'utf8'));
    for (const [event, groups] of Object.entries(settings.hooks || {})) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          covered.add(frag);
          const command = hook.command;
          if (command.includes('telegram-')) continue;
          const exp = HOOK_EXPECTATIONS.find((e) => e.match.test(command)) || {};
          const extra = typeof exp.env === 'function' ? exp.env() : exp.env || {};
          const input = {
            session_id: 't1', hook_event_name: event, cwd: home, transcript_path: fwd(sample), scratchpad_dir: fwd(newDir('sp-')),
            prompt: 'hello', tool_name: 'Read', tool_input: { command: 'ls' },
          };
          const r = run('bash', ['-c', command], { env: cleanEnv(home, extra), cwd: home, input: JSON.stringify(input) });
          ran++;
          const label = `${frag} ${event}: ${command}`;
          const problems = [];
          if (r.status !== 0) problems.push(`exit ${r.status} ${r.error ? r.error.message : ''}`);
          if (/No such file|Cannot find module/.test(r.stderr)) problems.push('stderr reports a missing file');
          if (exp.stdout && !r.stdout.includes(exp.stdout)) problems.push(`stdout lacks ${exp.stdout}`);
          if (exp.nonEmpty && !r.stdout.trim()) problems.push('stdout is empty');
          if (problems.length) failures.push(`${label}\n  ${problems.join('; ')}\n  stdout: ${r.stdout.slice(0, 300)}\n  stderr: ${r.stderr.slice(0, 500)}`);
        }
      }
    }
  }
  assert.deepEqual([...covered].sort(), fragments, 'every hooks fragment was visited');
  assert.ok(ran > 0);
  assert.deepEqual(failures, [], failures.join('\n'));
});

const SKIPPED_VERIFY = {
  'plugin-playwright': 'needs the claude CLI',
  'plugin-skill-creator': 'needs the claude CLI',
  'plugin-superpowers': 'needs the claude CLI',
  'disk-watchdog': 'sweeps the real PC',
  'sync-engine': 'needs a sync state',
};

const verifyEnv = (home, id) => cleanEnv(home, id === 'session-namer' ? { SESSION_NAMER_CLAUDE_CMD: stub } : {});

t('every catalog verify command passes on a fresh copy', () => {
  const home = makeHome('verify', { skills: true });
  const cfg = fwd(path.join(home, '.claude'));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'tools', 'sync-second-profile.mjs')), 'two-accounts file is copied under tools/');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'statusline.sh')), 'statusline.sh is copied');
  const failures = [];
  let ran = 0;
  for (const entry of catalog()) {
    if (!entry.verify || !entry.verify.length || SKIPPED_VERIFY[entry.id]) continue;
    for (const cmd of entry.verify) {
      const r = runVerify(cmd, { cfg, repo: fwd(REPO), env: verifyEnv(home, entry.id) });
      ran++;
      if (r.status !== 0) failures.push(`${entry.id}: ${cmd}\n  exit ${r.status} ${r.error ? r.error.message : ''}\n  stdout: ${r.stdout.slice(0, 500)}\n  stderr: ${r.stderr.slice(0, 800)}`);
    }
  }
  assert.ok(ran > 0);
  assert.deepEqual(failures, [], failures.join('\n'));
});

const DEAD_HOOKS = {
  'session-id': 'session-id.js',
  'bypass-mode': 'auto-approve-shell.js',
  'compact-recovery': 'compact-recovery.js',
  handoff: 'handoff-prompt.js',
  'notifications-telegram': 'telegram-process.js',
  'session-namer': 'session-namer.js',
};

t('a dead hook makes its verify fail', () => {
  const home = makeHome('dead');
  const cfg = fwd(path.join(home, '.claude'));
  const byId = Object.fromEntries(catalog().map((e) => [e.id, e]));
  for (const [id, script] of Object.entries(DEAD_HOOKS)) {
    const file = path.join(home, '.claude', 'hooks', script);
    assert.ok(fs.existsSync(file), `${script} exists`);
    fs.writeFileSync(file, 'process.exit(0)\n');
    const results = byId[id].verify.map((cmd) => runVerify(cmd, { cfg, repo: fwd(REPO), env: verifyEnv(home, id) }));
    assert.ok(results.some((r) => r.status !== 0), `${id}: a verify command must fail once ${script} is dead`);
  }
});

function namerCheck(home, { pathValue, cwd, extra = {} }) {
  const env = cleanEnv(home, { PATH: pathValue, ...extra });
  return run(process.execPath, [path.join(home, '.claude', 'hooks', 'session-namer.js'), '--check'], { env, cwd });
}

t('the namer finds an npm-installed claude and never one in the project folder', { skip: process.platform !== 'win32' ? 'win32 only' : SKIP }, () => {
  const home = makeHome('namer-path');
  const emptyDir = newDir('empty-');

  const npmDir = newDir('npm-');
  fs.writeFileSync(path.join(npmDir, 'claude.cmd'), '@echo off\r\n');
  const npmExe = path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  linkOrCopy(process.execPath, npmExe);
  const a = namerCheck(home, { pathValue: npmDir, cwd: home });
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.ok(a.stdout.includes(`fail ${npmExe}:`), `npm install is found: ${a.stdout}`);

  const project = newDir('project-');
  linkOrCopy(process.execPath, path.join(project, 'claude.exe'));
  fs.writeFileSync(path.join(project, 'claude.cmd'), '@echo off\r\n');
  const b = namerCheck(home, { pathValue: '.' + path.delimiter + emptyDir, cwd: project });
  assert.ok(b.stdout.startsWith('fail claude:'), `project folder is not searched: ${b.stdout}`);
  assert.ok(!b.stdout.includes(project), b.stdout);

  const plainDir = newDir('plain-');
  const plainExe = path.join(plainDir, 'claude.exe');
  linkOrCopy(process.execPath, plainExe);
  const c = namerCheck(home, { pathValue: plainDir, cwd: home });
  assert.ok(c.stdout.includes(plainExe), `plain claude.exe on PATH is found: ${c.stdout}`);

  const execDir = newDir('execpath-');
  const execExe = path.join(execDir, 'claude.exe');
  linkOrCopy(process.execPath, execExe);
  const d = namerCheck(home, { pathValue: emptyDir, cwd: home, extra: { CLAUDE_CODE_EXECPATH: execExe } });
  assert.ok(!d.stdout.includes(execExe), `--check ignores CLAUDE_CODE_EXECPATH: ${d.stdout}`);
});

const hookPrompt = (home, sid, prompt, extra) => run('bash', [fwd(path.join(home, '.claude', 'hooks', 'session-namer.sh'))], {
  env: cleanEnv(home, { SESSION_NAMER_SYNC: '1', ...extra }),
  cwd: home,
  input: JSON.stringify({ session_id: sid, hook_event_name: 'UserPromptSubmit', cwd: home, prompt }),
});

t('the namer names a session end to end', () => {
  const home = makeHome('namer-e2e');
  const first = hookPrompt(home, 'n1', 'Add a CSV export to the orders page', { SESSION_NAMER_CLAUDE_CMD: stub });
  assert.equal(first.status, 0, first.stderr);
  const second = hookPrompt(home, 'n1', 'also add a date filter', { SESSION_NAMER_CLAUDE_CMD: stub });
  assert.equal(second.status, 0, second.stderr);
  const out = JSON.parse(second.stdout);
  assert.ok(out.hookSpecificOutput.sessionTitle.includes('Orders page CSV export'), second.stdout);

  const missing = path.join(root, 'no-such-dir', 'claude-missing.exe');
  const n2 = hookPrompt(home, 'n2', 'Add a CSV export to the orders page', { SESSION_NAMER_CLAUDE_CMD: missing });
  assert.equal(n2.status, 0, n2.stderr);
  const lines = fs.readFileSync(path.join(home, '.claude', 'state', 'session-namer', 'namer.log'), 'utf8').trim().split('\n');
  const cols = lines[lines.length - 1].split('\t');
  assert.equal(cols[2], 'done');
  assert.equal(cols[8], 'fail');
  assert.equal(cols[cols.length - 1], 'spawn ENOENT');
});

t('the Telegram stop hook creates its folder and sends once', () => {
  const home = makeHome('telegram');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'session')));
  fs.writeFileSync(path.join(home, '.claude', 'telegram.conf'), 'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_CHAT_ID=1\nMACHINE_NAME=T\n');
  const curlLog = path.join(root, 'curl.log');
  const env = cleanEnv(home, { HOOK_BG: '1', CURL_LOG: fwd(curlLog), PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH });
  const input = JSON.stringify({ session_id: 's1', cwd: fwd(home), last_assistant_message: 'hello' });
  const script = fwd(path.join(home, '.claude', 'hooks', 'telegram-stop.sh'));
  for (let i = 0; i < 2; i++) {
    const r = run('bash', [script], { env, cwd: home, input });
    assert.equal(r.status, 0, r.stderr);
  }
  assert.ok(fs.existsSync(path.join(home, '.claude', 'session', 'last_stop_s1')));
  const sent = fs.readFileSync(curlLog, 'utf8').split('\n').filter(Boolean);
  assert.equal(sent.length, 1, sent.join('\n'));
});

t('usage tools print local time', () => {
  const home = newDir('usage-home-');
  const proj = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  const record = {
    type: 'assistant', timestamp: '2026-11-20T10:00:00.000Z', requestId: 'r1', uuid: 'u1',
    message: { id: 'm1', model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } },
  };
  fs.writeFileSync(path.join(proj, '0a1b2c3d-0000-4000-8000-000000000001.jsonl'), JSON.stringify(record) + '\n');
  const script = path.join(makeHome('usage'), '.claude', 'tools', 'usage-audit.mjs');
  const audit = (tz) => {
    const r = run(process.execPath, [script, '--start', '2026-11-20T00:00:00Z', '--end', '2026-11-21T00:00:00Z'], { env: { ...cleanEnv(home), TZ: tz } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const tokyo = audit('Asia/Tokyo');
  assert.deepEqual(Object.keys(tokyo.personal.byHourLocal), ['11-20 19:00']);
  assert.equal(tokyo.personal.sessions[0].from, '11-20 19:00');
  const utc = audit('UTC');
  assert.deepEqual(Object.keys(utc.personal.byHourLocal), ['11-20 10:00']);
  assert.equal(utc.personal.sessions[0].from, '11-20 10:00');
});
