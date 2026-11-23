import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAllowed, backupFile, configDir, hashBuffer, hashFile, journal, readJson, relInside, writeFileAtomic } from './fsx.mjs';
import { lsTree, showFileAt } from './repo.mjs';
import { save } from './state.mjs';

export const defaultMerge = await import('./settings-merge.mjs').catch((e) => {
  if (e.code === 'ERR_MODULE_NOT_FOUND' && /settings-merge/.test(e.message)) return null;
  throw e;
});

export const BUILTIN_SKILLS = ['fewer-permission-prompts', 'plugin-authoring', 'init', 'security-review', 'simplify', 'schedule', 'keybindings-help'];

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export const encodeHome = (home) => home.replace(/[^A-Za-z0-9]/g, '-');

export function destKey(dest, home = os.homedir()) {
  let d = String(dest).replace(/\\/g, '/');
  if (d.startsWith('{memory_dir}')) d = `projects/${encodeHome(home)}/memory${d.slice('{memory_dir}'.length)}`;
  d = path.posix.normalize(d).replace(/\/+$/, '');
  const bad = !d || d === '.' || d === '..' || d.startsWith('../') || path.posix.isAbsolute(d) || /^[A-Za-z]:/.test(d);
  const reserved = d === 'settings.json' || d === '.claude.json' || /^(state\/claude-setup|backups)(\/|$)/.test(d);
  if (bad || reserved) throw new Error(`bad or reserved dest: ${dest}`);
  return d;
}

export function absOf(cfg, key) {
  const parts = String(key).split('/');
  if (!key || parts.includes('..') || path.isAbsolute(key) || /^[A-Za-z]:/.test(key)) throw new Error(`bad path key: ${key}`);
  return path.join(cfg, ...parts);
}

export function render(text, values) {
  return text.replace(PLACEHOLDER, (m, k) => {
    if (values[k] === undefined || values[k] === null) throw new Error(`no value for ${m}`);
    return String(values[k]);
  });
}

export function setFrontmatter(text, key, value) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) throw new Error('no frontmatter found');
  const re = new RegExp(`^${key}:[^\\r\\n]*`, 'm');
  const body = re.test(m[2]) ? m[2].replace(re, () => `${key}: ${value}`) : `${m[2]}\n${key}: ${value}`;
  return m[1] + body + m[3] + text.slice(m[0].length);
}

function jsLiteral(v) {
  if (typeof v !== 'string') return JSON.stringify(v);
  const t = v.trim();
  if (/^[[{]/.test(t)) return JSON.stringify(JSON.parse(t));
  return JSON.stringify(v);
}

export function setConstLine(text, key, value, where) {
  const re = new RegExp(`^const ${key} = [^\\r\\n]*;(?=[ \\t]*\\r?$)`, 'm');
  if (!re.test(text)) throw new Error(`${where}: line "const ${key} = ...;" not found`);
  if (value === '' || value === undefined || value === null) return text;
  return text.replace(re, () => `const ${key} = ${jsLiteral(value)};`);
}

export function mergedValues(entry, given) {
  const out = {};
  for (const v of entry.values || []) out[v.key] = v.default;
  for (const [k, v] of Object.entries(given || {})) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

export function renderBytes(entry, item, raw, values, warnings = [], home) {
  if (raw.includes(0)) return raw;
  let text = raw.toString('utf8');
  for (const def of entry.values || []) {
    if (!def.file || destKey(def.file, home) !== item.dest) continue;
    const val = values[def.key];
    if (def.frontmatter) {
      if (val !== '') text = setFrontmatter(text, def.frontmatter, val);
    } else if (item.dest.endsWith('.js')) {
      text = setConstLine(text, def.key, val, item.dest);
    } else if (!text.includes(`{{${def.key}}}`)) {
      warnings.push(`value ${def.key} has no {{${def.key}}} placeholder in ${item.dest}; it has no effect`);
    }
  }
  return Buffer.from(render(text, values), 'utf8');
}

export function expandFiles(entry, repo, commit, { home, lenient = false } = {}) {
  const out = [];
  const add = (srcRaw, base, mode, rule) => {
    const src = srcRaw.replace(/\/+$/, '');
    const tree = lsTree(repo, commit, src);
    if (!tree.length) {
      if (lenient) return;
      throw new Error(`${entry.id}: ${srcRaw} does not exist at ${commit}`);
    }
    if (tree.length === 1 && tree[0].path === src) out.push({ src, dest: base, mode, rule, exec: tree[0].mode === '100755' });
    else for (const t of tree) out.push({ src: t.path, dest: `${base}/${t.path.slice(src.length + 1)}`, mode, rule, exec: t.mode === '100755' });
  };
  for (const f of entry.files || []) add(f.src, destKey(f.dest, home), f.mode, false);
  for (const r of entry.rules || []) add(r, `rules/${path.posix.basename(r)}`, 'managed', true);
  return out;
}

export function bytesFor(entry, item, repo, commit, values, warnings, home) {
  const raw = showFileAt(repo, commit, item.src);
  return item.mode === 'rendered' || item.rule ? renderBytes(entry, item, raw, values, warnings, home) : raw;
}

export function installedSkills(cfg, state) {
  const s = new Set();
  try {
    for (const e of fs.readdirSync(path.join(cfg, 'skills'), { withFileTypes: true })) s.add(e.name);
  } catch {}
  for (const k of Object.keys(state.files || {})) {
    const m = /^skills\/([^/]+)\//.exec(k);
    if (m) s.add(m[1]);
  }
  return s;
}

function deepRender(v, values) {
  if (typeof v === 'string') return v.includes('{{') ? render(v, values) : v;
  if (Array.isArray(v)) return v.map((x) => deepRender(x, values));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRender(x, values)]));
  return v;
}

export const settingKey = (w) => (w.match ? `${w.pointer}#${w.match.command ?? JSON.stringify(w.match)}` : w.pointer);

export function revertEntry(e) {
  return { pointer: e.pointer, value: e.value, prev: e.prev, ...(e.match && { match: e.match }), ...(e.created && { created: e.created }) };
}

function recordSetting(state, w, part, run) {
  const key = settingKey(w);
  const old = state.settings[key];
  const entry = { part, pointer: w.pointer, value: w.value, prev: old ? old.prev : w.prev, run };
  if (w.match) entry.match = w.match;
  const created = old?.created ?? w.created;
  if (created) entry.created = created;
  if (old) entry.history = [...(old.history || []), { run: old.run, value: old.value }];
  delete state.settings[key];
  state.settings[key] = entry;
}

function stat(p) {
  try {
    return fs.statSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export function planPart(entry, ctx) {
  const { repo, commit, state } = ctx;
  const cfg = ctx.configDir ?? configDir();
  const home = ctx.home ?? os.homedir();
  const values = mergedValues(entry, ctx.values ?? state.values);
  const overwrite = new Set(ctx.overwrite || []);
  const keep = new Set(ctx.keep || []);
  const plan = {
    part: entry.id, commit, ops: [], conflicts: [], held: [], unchanged: 0, settings: [], settingsConflicts: [],
    mcp: [], plugins: [], user_steps: entry.user_steps || [], machine_steps: entry.machine_steps || [], warnings: [],
  };
  const mk = (kind, item, extra = {}, bytes = null) => {
    const op = { kind, dest: item.dest, part: entry.id, mode: item.mode, src: item.src, ...extra };
    if (bytes) Object.defineProperty(op, 'bytes', { value: bytes, enumerable: false });
    plan.ops.push(op);
  };

  for (const item of expandFiles(entry, repo, commit, { home })) {
    const abs = absOf(cfg, item.dest);
    const bytes = bytesFor(entry, item, repo, commit, values, plan.warnings, home);
    const hash = hashBuffer(bytes);
    const tracked = state.files[item.dest];
    const st = stat(abs);
    if (st?.isDirectory()) throw new Error(`${abs} is a directory, expected a file`);
    const base = { hash, exec: item.exec };
    if (item.mode === 'seed') {
      if (!tracked && !st) mk('write', item, { ...base, why: 'seed' }, bytes);
      else plan.unchanged++;
      continue;
    }
    const cur = st ? hashFile(abs) : null;
    if (cur === hash) {
      if (!tracked) mk('adopt', item, { ...base, why: 'same-as-existing' });
      else if (tracked.hash !== hash || tracked.held) mk('track', item, { ...base, why: 'matches-incoming' });
      else plan.unchanged++;
      continue;
    }
    if (tracked && st && cur !== tracked.hash) {
      if (overwrite.has(item.dest)) mk('write', item, { ...base, why: 'overwrite-local-edit', overwrite: true }, bytes);
      else if (keep.has(item.dest) && !tracked.held) mk('hold', item, { why: 'keep-local-edit' });
      else if (keep.has(item.dest) || tracked.held) plan.held.push(item.dest);
      else plan.conflicts.push({ dest: item.dest, part: entry.id, reason: 'local-edit', current: cur, installed: tracked.hash, incoming: hash });
      continue;
    }
    const why = tracked ? (st ? 'update' : 'restore-missing') : st ? 'replaces-user-file' : 'new';
    mk('write', item, { ...base, why }, bytes);
  }

  if ((entry.settings || []).length) {
    const merge = ctx.merge ?? defaultMerge;
    if (!merge) throw new Error('settings-merge.mjs is not available');
    const cur = readJson(path.join(cfg, 'settings.json'), {});
    const have = new Set([...(ctx.installedSkills ?? installedSkills(cfg, state)), ...BUILTIN_SKILLS]);
    for (const op of plan.ops) {
      const m = /^skills\/([^/]+)(\/|$)/.exec(op.dest);
      if (m) have.add(m[1]);
    }
    for (const src of entry.settings) {
      const frag = merge.pruneSkillOverrides(deepRender(JSON.parse(showFileAt(repo, commit, src).toString('utf8')), values), have);
      const ops = merge.planMerge(cur, frag);
      plan.settings.push({ src, fragment: frag, ops });
      for (const o of ops) if (o.op === 'conflict') plan.settingsConflicts.push({ src, pointer: o.pointer, current: o.prev, wanted: o.value });
    }
  }

  for (const m of entry.mcp || []) plan.mcp.push({ name: m.name, config: m.config, part: entry.id, action: state.mcp[m.name] ? 'keep' : 'add' });
  for (const p of entry.plugins || []) plan.plugins.push({ ...p, part: entry.id });
  return plan;
}

function applyFileOp(op, ctx, runDir, result) {
  const { state, commit } = ctx;
  const cfg = ctx.configDir ?? configDir();
  const abs = absOf(cfg, op.dest);
  const prev = state.files[op.dest] ?? null;
  const exists = fs.existsSync(abs);
  const curHash = exists ? hashFile(abs) : null;

  if (op.kind === 'hold') {
    journal(runDir, { ev: 'file', action: 'hold', dest: op.dest, existed: exists, backup: null, hashBefore: curHash, hashAfter: curHash });
    state.files[op.dest] = { ...prev, held: true };
    result.held.push(op.dest);
    return save(state, cfg);
  }
  if (op.kind === 'write') {
    if (prev && exists && curHash !== prev.hash && curHash !== op.hash && !op.overwrite) throw new Error(`${op.dest} changed after the plan was made; plan again`);
  } else if (curHash !== op.hash) {
    throw new Error(`${op.dest} changed after the plan was made; plan again`);
  }

  const backupAbs = exists ? backupFile(runDir, abs, cfg) : null;
  const backupRel = backupAbs ? relInside(cfg, backupAbs) : null;
  journal(runDir, { ev: 'file', action: op.kind, dest: op.dest, existed: exists, backup: backupRel, hashBefore: curHash, hashAfter: op.hash });
  if (op.kind === 'write') {
    writeFileAtomic(abs, op.bytes, { exec: op.exec });
    if (hashFile(abs) !== op.hash) throw new Error(`${op.dest}: written file does not match the expected hash`);
  }
  state.files[op.dest] = {
    hash: op.hash,
    commit,
    part: op.part,
    mode: op.mode,
    existed_before: prev ? prev.existed_before : exists,
    backup: prev ? prev.backup : backupRel,
    held: false,
  };
  (op.kind === 'write' ? result.written : op.kind === 'adopt' ? result.adopted : result.tracked).push(op.dest);
  save(state, cfg);
}

export function applyPlan(plan, ctx) {
  const { state, commit } = ctx;
  const cfg = ctx.configDir ?? configDir();
  assertAllowed(cfg);
  if (plan.conflicts.length) throw new Error(`${plan.part}: unresolved local edits: ${plan.conflicts.map((c) => c.dest).join(', ')}`);
  const runDir = ctx.runDir;
  const runId = path.basename(runDir);
  const result = {
    part: plan.part, written: [], adopted: [], tracked: [], held: [], settings: { written: [], skipped: [] },
    mcp: plan.mcp, plugins: plan.plugins, user_steps: plan.user_steps, machine_steps: plan.machine_steps, warnings: plan.warnings,
  };
  for (const op of plan.ops) applyFileOp(op, ctx, runDir, result);

  if (plan.settings.length) {
    const merge = ctx.merge ?? defaultMerge;
    if (!merge) throw new Error('settings-merge.mjs is not available');
    const sp = path.join(cfg, 'settings.json');
    assertAllowed(sp);
    const accept = new Set(ctx.acceptSettings || []);
    for (const f of plan.settings) {
      const ops = merge.planMerge(readJson(sp, {}), f.fragment);
      if (!ops.some((o) => o.op === 'add' || (o.op === 'conflict' && accept.has(o.pointer)))) continue;
      const existed = fs.existsSync(sp);
      const backupAbs = existed ? backupFile(runDir, sp, cfg) : null;
      journal(runDir, { ev: 'settings-begin', part: plan.part, src: f.src, existed, backup: backupAbs ? relInside(cfg, backupAbs) : null, hashBefore: hashFile(sp) });
      const res = merge.applyOps(sp, ops, { accept: [...accept] });
      for (const w of res.written) recordSetting(state, w, plan.part, runId);
      journal(runDir, { ev: 'settings-end', part: plan.part, hashAfter: hashFile(sp), written: res.written.map(settingKey) });
      result.settings.written.push(...res.written.map((w) => w.pointer));
      result.settings.skipped.push(...res.skipped);
      save(state, cfg);
    }
  }

  state.parts[plan.part] = { installed: true, at_commit: commit };
  save(state, cfg);
  return result;
}
