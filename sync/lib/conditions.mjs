import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WEEK_MS = 7 * 24 * 3600 * 1000;

function versionParts(s) {
  const m = /(\d+(?:\.\d+)*)/.exec(String(s ?? ''));
  return m ? m[1].split('.').map(Number) : null;
}

function atLeast(have, want) {
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export function check(need, ctx) {
  if (need === 'windows') return ctx.platform === 'win32';
  if (need === 'second-profile') return !!ctx.secondProfile();
  if (need === 'memohopper-connected') return !!ctx.memohopperConnected();
  if (need === 'fable-access') return ctx.fableAccess();
  if (need === 'haiku-access') return ctx.haikuAccess ? ctx.haikuAccess() : 'unknown';
  if (need.startsWith('part:')) return ctx.installedParts.has(need.slice(5));
  if (need.startsWith('plugin:')) return ctx.plugins.has(need.slice(7));
  if (need.startsWith('cmd:')) return !!ctx.which(need.slice(4));
  if (need.startsWith('claude>=')) {
    const want = versionParts(need.slice(8));
    const have = versionParts(ctx.claudeVersion);
    if (!want) throw new Error(`bad version in need: ${need}`);
    if (!have) return 'unknown';
    return atLeast(have, want);
  }
  throw new Error(`unknown need: ${need}`);
}

const BASH_RUN = 'set --; i=0; while [ "$i" -lt "$CS_N" ]; do n="CS_A$i"; set -- "$@" "${!n}"; i=$((i+1)); done; exec "$CS_CMD" "$@"';

export function defaultRun(cmd, args, opts = {}) {
  let r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (cmd === 'claude' && process.platform === 'win32' && ['ENOENT', 'EINVAL'].includes(r.error?.code)) {
    const env = { ...(opts.env ?? process.env), MSYS_NO_PATHCONV: '1', CS_CMD: cmd, CS_N: String(args.length) };
    args.forEach((a, i) => { env[`CS_A${i}`] = a; });
    r = spawnSync('bash', ['-c', BASH_RUN], { encoding: 'utf8', windowsHide: true, ...opts, env });
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

export function makeFableAccess({ state, run = defaultRun, now = () => Date.now() }) {
  return () => {
    const f = state.facts;
    if (f && typeof f.fable_access === 'boolean' && f.checked_at) {
      const age = now() - Date.parse(f.checked_at);
      if (age >= 0 && age < WEEK_MS) return f.fable_access;
    }
    const r = run('claude', ['-p', '--model', 'claude-fable-5-2', '--max-turns', '1', 'Reply ok'], { timeout: 120000 });
    let result = 'unknown';
    if (!r.error && r.status === 0) result = true;
    else if (/unrecognized_model/.test(`${r.stdout}\n${r.stderr}`)) result = false;
    if (typeof result === 'boolean') {
      state.facts = { ...(state.facts || {}), fable_access: result, checked_at: new Date(now()).toISOString() };
    }
    return result;
  };
}

export function makeSecondProfile({ home = os.homedir(), configDir }) {
  return () => {
    let names;
    try { names = fs.readdirSync(home); } catch { return false; }
    const own = configDir ? path.resolve(configDir).toLowerCase() : null;
    return names.some((n) => {
      if (!/^\.claude-/.test(n)) return false;
      const d = path.join(home, n);
      return path.resolve(d).toLowerCase() !== own && fs.existsSync(path.join(d, 'settings.json'));
    });
  };
}

export function makeMemohopperConnected({ run = defaultRun } = {}) {
  return () => {
    const r = run('claude', ['mcp', 'list'], { timeout: 60000 });
    return !r.error && /memohopper/i.test(`${r.stdout}\n${r.stderr}`);
  };
}

export function makeWhich({ env = process.env, platform = process.platform } = {}) {
  return (cmd) => {
    const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
    const exts = platform === 'win32' ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
    return dirs.some((d) => exts.some((x) => { try { return fs.statSync(path.join(d, cmd + x)).isFile(); } catch { return false; } }));
  };
}

export function defaultCtx({ state, configDir, home, run = defaultRun, platform = process.platform, env = process.env, now } = {}) {
  const plugins = new Set();
  try {
    const s = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
    for (const [k, v] of Object.entries(s.enabledPlugins || {})) if (v) plugins.add(k.split('@')[0]);
  } catch { /* no settings yet */ }
  const installedParts = new Set(Object.entries(state.parts || {}).filter(([, v]) => v && v.installed).map(([k]) => k));
  const v = run('claude', ['--version'], { timeout: 30000 });
  return {
    platform,
    state,
    configDir,
    which: makeWhich({ env, platform }),
    installedParts,
    plugins,
    claudeVersion: v.error || v.status !== 0 ? null : v.stdout.trim(),
    secondProfile: makeSecondProfile({ home, configDir }),
    memohopperConnected: makeMemohopperConnected({ run }),
    fableAccess: makeFableAccess({ state, run, now }),
  };
}
