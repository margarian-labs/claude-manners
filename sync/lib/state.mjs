import fs from 'node:fs';
import path from 'node:path';
import { configDir, readJson, writeJsonAtomic, copyAtomic, relInside } from './fsx.mjs';

export const stateFile = (cfg = configDir()) => path.join(cfg, 'state', 'claude-manners', 'state.json');

export const emptyState = () => ({
  version: 1,
  repo: { path: null, commit: null, tag: null },
  engine: { version: '1.0.0', sha256: null },
  facts: {},
  values: {},
  parts: {},
  answers: {},
  files: {},
  settings: {},
  mcp: {},
  runs: [],
});

export function load(cfg = configDir()) {
  const s = readJson(stateFile(cfg), null);
  if (!s) return emptyState();
  if (s.version !== 1) throw new Error(`unsupported state version ${s.version}`);
  return { ...emptyState(), ...s };
}

export function save(state, cfg = configDir()) {
  const file = stateFile(cfg);
  if (fs.existsSync(file)) copyAtomic(file, file + '.bak');
  writeJsonAtomic(file, state);
  return file;
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const runDirOf = (run, cfg = configDir()) => (path.isAbsolute(run.backup) ? run.backup : path.join(cfg, ...run.backup.split('/')));

export function newRun(state, kind, from, to, cfg = configDir(), now = new Date()) {
  let t = new Date(now);
  let id;
  let dir;
  for (;;) {
    id = stamp(t);
    dir = path.join(cfg, 'state', 'claude-manners', 'backups', `${day(t)}`, id);
    if (!state.runs.some((r) => r.id === id) && !fs.existsSync(dir)) break;
    t = new Date(t.getTime() + 1000);
  }
  fs.mkdirSync(dir, { recursive: true });
  const { runs, ...rest } = state;
  writeJsonAtomic(path.join(dir, 'state-before.json'), rest);
  const run = { id, kind, at: now.toISOString(), from: from ?? null, to: to ?? null, proposals: [], status: 'started', backup: relInside(cfg, dir) };
  state.runs.push(run);
  return run;
}

export function finishRun(state, run, status = 'done') {
  const r = typeof run === 'string' ? state.runs.find((x) => x.id === run) : run;
  if (!r) throw new Error(`unknown run ${run}`);
  r.status = status;
  return r;
}

export function findCrashedRun(state) {
  return [...state.runs].reverse().find((r) => r.status === 'started') ?? null;
}
