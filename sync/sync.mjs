#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { backupFile, configDir, hashFile, journal, readJson, relInside, removeFile, walk, writeFileAtomic, writeJsonAtomic } from './lib/fsx.mjs';
import { fetchAndUpdate, git, headCommit, listTags, lsTree, resolveVersion, showFileAt } from './lib/repo.mjs';
import { validateEntry } from './lib/catalog.mjs';
import { parseFrontmatter, pending, validateProposal } from './lib/proposals.mjs';
import { check, defaultCtx, defaultRun, runVerify } from './lib/conditions.mjs';
import { absOf, applyPlan, defaultMerge as merge, encodeHome, expandFiles, installedSkills, mergedValues, planPart } from './lib/install.mjs';
import { applyRollback, catalogAt, planRollback, planUndo } from './lib/rollback.mjs';
import { card, partCard, riskyPointers } from './lib/display.mjs';
import { findCrashedRun, finishRun, load, newRun, runDirOf, save } from './lib/state.mjs';

const TEST = process.env.CLAUDE_SETUP_TEST === '1';
const ENGINE = 'sync-engine';
const ENGINE_VERSION = '1.4.0';
const GROUPS = ['rules', 'settings', 'workflow', 'hooks', 'agents', 'skills', 'plugins', 'tools', 'integrations', 'lessons'];
const PACKS = {
  'pack-2026-11-21': {
    rules: {
      'rules/setup-pack/core.md': ['core-rules', 'flags', 'style-and-coding', 'subagents', 'workflow'],
      'rules/setup-pack/accounts.md': ['two-accounts'],
    },
  },
};
const isAbsent = (v) => v && typeof v === 'object' && v.$absent === true;
const iso = () => new Date().toISOString();
const uniq = (a) => [...new Set(a)];
const fill = (text, values) => String(text).replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (m, k) => (values[k] ?? m));

class Stop extends Error {
  constructor(result) {
    super('stop');
    this.result = result;
  }
}
const ok = (data, lines = []) => ({ code: 0, data: { ok: true, ...data }, lines });
const ask = (questions, lines = []) => ({ code: 2, data: { ok: false, status: 'needs-answer', questions }, lines: [...lines, 'Needs an answer:', ...questions.map((q) => `- ${q.text}`)] });
const fail = (message) => ({ code: 1, data: { ok: false, error: message }, lines: [`Error: ${message}`] });

function parseArgs(argv) {
  const BOOL = new Set(['json', 'plan', 'last', 'redo', 'crashed', 'no-fetch', 'update-engine', 'cards']);
  const a = { cmd: null, pos: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) {
      const k = x.slice(2);
      if (BOOL.has(k)) a.flags.set(k, [true]);
      else {
        if (i + 1 >= argv.length) throw new Error(`--${k} needs a value`);
        if (!a.flags.has(k)) a.flags.set(k, []);
        a.flags.get(k).push(argv[++i]);
      }
    } else if (!a.cmd) a.cmd = x;
    else a.pos.push(x);
  }
  return a;
}
const has = (a, k) => a.flags.has(k);
const one = (a, k) => a.flags.get(k)?.at(-1);
const list = (a, k) => (a.flags.get(k) ?? []).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
const pairs = (items, what) => Object.fromEntries(items.map((s) => {
  const i = s.indexOf('=');
  if (i < 1) throw new Error(`${what}: expected key=value, got "${s}"`);
  return [s.slice(0, i), s.slice(i + 1)];
}));

function makeRunner() {
  if (!TEST) return defaultRun;
  const file = process.env.CLAUDE_SETUP_TEST_FAKE || path.join(process.env.CLAUDE_SETUP_TEST_ROOT, 'fake-claude.json');
  return (cmd, args) => {
    const f = readJson(file, {});
    (f.calls ??= []).push([cmd, ...args]);
    f.mcp ??= {};
    const r = { status: 0, stdout: '', stderr: '', error: null };
    const [a0, a1, a2] = args;
    if (cmd !== 'claude') Object.assign(r, { status: null, error: new Error(`test mode: ${cmd} is not available`) });
    else if (a0 === '--version') r.stdout = f.version ?? '2.1.100 (Claude Code)';
    else if (a0 === '-p') {
      if (f.fable === false) Object.assign(r, { status: 1, stderr: 'unrecognized_model' });
      else if (f.fable === 'unknown') Object.assign(r, { status: 1, stderr: 'network down' });
    } else if (a0 === 'mcp' && a1 === 'list') r.stdout = Object.keys(f.mcp).join('\n');
    else if (a0 === 'mcp' && a1 === 'get') {
      if (f.mcp[a2]) r.stdout = a2;
      else Object.assign(r, { status: 1, stderr: `No MCP server found with name: ${a2}` });
    } else if (a0 === 'mcp' && a1 === 'add-json') {
      if (f.mcpFail) Object.assign(r, { status: 1, stderr: 'add failed' });
      else f.mcp[a2] = JSON.parse(args[3]);
    } else if (a0 === 'mcp' && a1 === 'remove') delete f.mcp[a2];
    writeJsonAtomic(file, f);
    return r;
  };
}

function homeDir() {
  return TEST ? process.env.CLAUDE_SETUP_TEST_HOME || path.join(process.env.CLAUDE_SETUP_TEST_ROOT, 'home') : os.homedir();
}

function boot(a, { repo = true } = {}) {
  const cfg = configDir();
  const state = load(cfg);
  let repoPath = null;
  if (repo) {
    repoPath = one(a, 'repo') ? path.resolve(one(a, 'repo')) : state.repo.path;
    if (!repoPath) throw new Error('no clone known yet: pass --repo <path to the claude-setup clone> (or run bootstrap first)');
    try {
      git(['rev-parse', '--git-dir'], repoPath);
    } catch {
      throw new Error(`not a git clone: ${repoPath}`);
    }
  }
  return { a, cfg, state, home: homeDir(), repo: repoPath, run: makeRunner(), facts0: JSON.stringify(state.facts) };
}

function condCtx(b, extraParts = []) {
  const c = defaultCtx({ state: b.state, configDir: b.cfg, home: b.home, run: b.run });
  for (const p of extraParts) c.installedParts.add(p);
  return c;
}

function loadCat(b, commit) {
  const warnings = [];
  const raw = catalogAt(b.repo, commit);
  const ids = new Set(raw.keys());
  const cat = new Map();
  for (const [id, e] of raw) {
    const errs = validateEntry(e, ids);
    if (errs.length) warnings.push(`catalog part ${id} skipped: ${errs[0]}`);
    else cat.set(id, e);
  }
  return { cat, warnings };
}

function proposalsAt(b, commit, ids, warnings) {
  const out = [];
  for (const t of lsTree(b.repo, commit, 'proposals')) {
    const m = /^proposals\/([^/]+)\.md$/.exec(t.path);
    if (!m || m[1] === 'TEMPLATE') continue;
    try {
      const { meta, body } = parseFrontmatter(showFileAt(b.repo, commit, t.path).toString('utf8'));
      const p = { id: meta.id ?? m[1], file: `${m[1]}.md`, meta, body };
      const errs = validateProposal(p, ids);
      if (errs.length) warnings.push(`proposal ${m[1]} skipped: ${errs[0]}`);
      else out.push(p);
    } catch (e) {
      warnings.push(`proposal ${m[1]} skipped: ${e.message}`);
    }
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : 1));
}

const tagMemo = new Map();
const tagAt = (b, sha) => {
  if (!sha) return null;
  if (!tagMemo.has(b.repo)) tagMemo.set(b.repo, listTags(b.repo));
  return tagMemo.get(b.repo).find((t) => t.sha === sha)?.tag ?? null;
};

function crashGuard(b) {
  const c = findCrashedRun(b.state);
  if (!c) return;
  if (one(b.a, 'crash') === 'finish') {
    finishRun(b.state, c, 'done');
    save(b.state, b.cfg);
    return;
  }
  throw new Stop(ask([{ kind: 'crash', run: c.id, run_kind: c.kind, at: c.at, options: ['finish', 'undo'], text: `Run ${c.id} (${c.kind}, ${c.at}) did not finish. Finish it by running this command again with --crash finish, or undo it with: rollback --crashed`, flag: '--crash finish' }]));
}

function pluginSkills(cfg) {
  const out = new Set();
  const enabled = Object.entries(readJson(path.join(cfg, 'settings.json'), {}).enabledPlugins || {}).filter(([, v]) => v).map(([k]) => k.split('@'));
  for (const [name, market] of enabled) {
    const base = path.join(cfg, 'plugins', 'cache', market ?? '', name);
    try {
      for (const ver of fs.readdirSync(base)) {
        for (const e of fs.readdirSync(path.join(base, ver, 'skills'), { withFileTypes: true })) if (e.isDirectory()) out.add(e.name);
      }
    } catch { /* plugin cache not there */ }
  }
  return out;
}

const enabledPlugins = (cfg) => new Set(Object.entries(readJson(path.join(cfg, 'settings.json'), {}).enabledPlugins || {}).filter(([, v]) => v).map(([k]) => k.split('@')[0]));

function baseX(b) {
  const a = b.a;
  const skills = installedSkills(b.cfg, b.state);
  for (const n of pluginSkills(b.cfg)) skills.add(n);
  return {
    values: { ...b.state.values, ...pairs(a.flags.get('values') ?? [], '--values') },
    skills,
    keep: list(a, 'keep'),
    overwrite: list(a, 'overwrite'),
    accept: new Set(list(a, 'accept-settings')),
    confirm: new Set(list(a, 'confirm-risky')),
    questions: [],
  };
}

function withEntries(b, x, entries) {
  if (entries.some((e) => e.values.some((v) => v.key === 'planner_model' || v.key === 'planner_agent_model'))) {
    const f = one(b.a, 'fable');
    if (f) b.state.facts = { ...b.state.facts, fable_access: f === 'yes', checked_at: iso() };
    const access = f ? f === 'yes' : condCtx(b).fableAccess();
    if (access === 'unknown') {
      x.questions.push({ kind: 'fable-unknown', text: 'Could not check whether your plan includes Fable 5.2. Does it? (If not, Opus is used as planner.)', options: ['yes', 'no'], flag: '--fable yes|no' });
    } else if (access === false) x.values = { planner_model: 'Opus 5.5', planner_agent_model: 'opus', ...x.values };
  }
  for (const e of entries) {
    for (const f of e.files) {
      const m = /^skills\/([^/]+)/.exec(f.dest);
      if (m) x.skills.add(m[1]);
    }
  }
  return x;
}

function order(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = [];
  const seen = new Set();
  const visit = (e) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    for (const n of e.needs) if (n.startsWith('part:') && byId.has(n.slice(5))) visit(byId.get(n.slice(5)));
    if (e.id !== 'skill-overrides') out.push(e);
  };
  for (const e of entries) visit(e);
  if (byId.has('skill-overrides')) out.push(byId.get('skill-overrides'));
  return out;
}

const CODE_RE = /\.(js|mjs|cjs|sh|bash|ps1|vbs|py|cmd|bat)$/i;
const MAX_NEW_TEXT = 8;
const CARD_BUDGET = 20000;
const MANY_FILES = 80;
const fileCount = (items) => items.reduce((n, it) => n + (it.files?.length ?? 0), 0);

function displayPlan(plan, installed) {
  const ops = [];
  let shown = 0;
  let omitted = 0;
  for (const o of plan.ops) {
    if (o.kind !== 'write') continue;
    if (!(o.dest in installed) && !CODE_RE.test(o.dest) && ++shown > MAX_NEW_TEXT) omitted++;
    else ops.push({ kind: 'file', dest: o.dest, bytes: o.bytes });
  }
  if (omitted) ops.push({ kind: 'note', text: `${omitted} more new text files are not shown here (every file is listed under "files")` });
  for (const s of plan.settings) for (const o of s.ops) ops.push({ kind: 'settings', op: o.op, pointer: o.pointer, value: o.value, prev: o.prev });
  for (const m of plan.mcp) if (m.action === 'add') ops.push({ kind: 'mcp', name: m.name });
  for (const p of plan.plugins) ops.push({ kind: 'plugin', name: p.name });
  return { ops };
}

function planPartItem(b, head, entry, x) {
  const plan = planPart(entry, { repo: b.repo, commit: head, state: b.state, configDir: b.cfg, home: b.home, merge, values: x.values, installedSkills: x.skills, keep: x.keep, overwrite: x.overwrite });
  const installed = {};
  for (const o of plan.ops) {
    if (o.kind !== 'write') continue;
    try { installed[o.dest] = fs.readFileSync(absOf(b.cfg, o.dest)); } catch { /* new file */ }
  }
  const dplan = displayPlan(plan, installed);
  const questions = plan.conflicts.map((c) => ({
    kind: 'local-edit', dest: c.dest, part: entry.id, options: ['keep', 'overwrite'], flag: '--keep <dest> | --overwrite <dest>',
    text: `You changed ${c.dest} after sync wrote it. Keep your version (sync leaves it alone) or overwrite it with the new one (yours is backed up)?`,
  }));
  const settingsConflicts = plan.settingsConflicts.map((c) => ({ pointer: c.pointer, current: c.current, wanted: c.wanted, accepted: x.accept.has(c.pointer) }));
  const noop = b.state.parts[entry.id]?.installed === true
    && !plan.ops.some((o) => o.kind === 'write' || o.kind === 'hold')
    && !plan.settings.some((f) => f.ops.some((o) => o.op === 'add' || o.op === 'conflict'))
    && !plan.mcp.some((m) => m.action === 'add');
  const files = plan.ops.map((o) => ({ dest: o.dest, action: o.kind, why: o.why }));
  return { entry, plan, dplan, installed, risky: riskyPointers(dplan), questions, settingsConflicts, noop, files };
}

function planRemovalItem(b, entry) {
  const id = entry.id;
  const rp = planRollback(b.state, null, { repo: b.repo, configDir: b.cfg, home: b.home, merge, values: b.state.values });
  const mine = (dest) => b.state.files[dest]?.part === id;
  const rem = {
    ops: rp.ops.filter((o) => mine(o.dest)),
    asks: rp.asks.filter((q) => mine(q.dest)),
    entries: rp.settings.entries.filter((e) => b.state.settings[e.key]?.part === id),
    mcp: rp.mcp.filter((m) => m.part === id),
    problems: rp.problems.filter((p) => mine(p.dest)),
  };
  const ops = [];
  for (const o of rem.ops) {
    if (o.kind === 'put') ops.push({ kind: 'file', dest: o.dest, bytes: o.bytes ?? fs.readFileSync(o.bytesFrom) });
    else if (o.kind === 'delete') ops.push({ kind: 'file', dest: o.dest, action: 'remove' });
  }
  for (const e of rem.entries) ops.push({ kind: 'settings', op: 'change', pointer: e.entry.pointer, value: isAbsent(e.entry.prev) ? '(removed)' : e.entry.prev, prev: e.entry.value });
  const installed = {};
  for (const o of ops) if (o.kind === 'file') { try { installed[o.dest] = fs.readFileSync(absOf(b.cfg, o.dest)); } catch { /* gone */ } }
  const questions = rem.asks.map((q) => ({
    kind: 'local-edit-remove', dest: q.dest, part: id, options: ['keep', 'revert'], flag: '--answers <dest>=keep|revert',
    text: `You changed ${q.dest}. Keep your file (it stays, sync stops managing it) or remove it (yours is backed up)?`,
  }));
  return { entry, rem, plan: { part: id, ops: [], settings: [], mcp: [], plugins: [], conflicts: [], settingsConflicts: [], held: [], warnings: [] }, dplan: { ops }, installed, risky: [], questions, settingsConflicts: [], noop: false, remove: true, problems: rem.problems, files: rem.ops.map((o) => ({ dest: o.dest, action: o.kind, why: o.why })) };
}

const NEED_LABEL = { node: 'Node', python: 'Python', git: 'Git', pwsh: 'PowerShell 7' };
const SKILL_DOC = /^skills\/[^/]+\/(?!(?:SKILL|VENDOR|SOURCES|LICENSE|README)\.md$).+\.md$/;

function footprint(b, head, cat, e) {
  const items = expandFiles(e, b.repo, head, { home: b.home, lenient: true });
  return {
    files: items.filter((i) => !i.rule).length,
    rules: items.filter((i) => i.rule).length,
    settings: uniq(e.settings.flatMap((f) => Object.keys(JSON.parse(showFileAt(b.repo, head, f).toString('utf8'))))),
    mcp: e.mcp.map((m) => m.name),
    plugins: e.plugins.map((x) => x.name),
    outside: e.machine_steps.length,
    user: e.user_steps.length,
    references: items.some((i) => SKILL_DOC.test(i.dest)),
    needs: e.needs.flatMap((n) => (n.startsWith('cmd:') ? [NEED_LABEL[n.slice(4)] ?? n.slice(4)] : n.startsWith('part:') ? [cat.get(n.slice(5))?.title ?? n.slice(5)] : n.startsWith('plugin:') ? [`the ${n.slice(7)} plugin`] : [])),
  };
}

function proposalCard(b, p, item) {
  return card(p, item.dplan, item.installed, { configDir: b.cfg });
}

function syntheticProposal(entry, item) {
  const t = entry.tokens_always_on;
  return {
    id: entry.id,
    meta: {
      id: entry.id, title: entry.title, kind: 'add', level: entry.level, part: entry.id, touches: [...item.dplan.ops.filter((o) => o.kind === 'file').map((o) => o.dest), 'settings.json'],
      tokens_always_on: t.value === null ? 'not measured yet' : t.value, tokens_how: t.how, quality: entry.quality, risk: entry.risk,
    },
    body: `## What changes\n${entry.summary}\n\n## Why\n${entry.benefit ?? 'You chose this part.'}\n`,
  };
}

function riskQuestion(id, item, askAlone, riskText) {
  if (!item.risky.length && !askAlone) return null;
  return {
    kind: 'risky', id, pointers: item.risky, ask_alone: !!askAlone, risk: riskText, flag: '--confirm-risky <id>',
    text: `${id} changes sensitive settings (${item.risky.join(', ') || 'bypass-class'}). ${riskText} The person must type "confirm" before it is applied.`,
  };
}

function stepsOf(b, entry, plan, values) {
  const merged = mergedValues(entry, values);
  const enabled = enabledPlugins(b.cfg);
  const out = [];
  for (const t of entry.user_steps) out.push({ part: entry.id, kind: 'user', text: fill(t, merged) });
  for (const t of entry.machine_steps) out.push({ part: entry.id, kind: 'machine', text: fill(t, merged) });
  for (const p of plan.plugins) if (!enabled.has(p.name)) out.push({ part: entry.id, kind: 'plugin', name: p.name, marketplace: p.marketplace, text: `Install the Claude Code plugin "${p.name}" from the marketplace ${p.marketplace}.` });
  return out;
}

function newRes(run) {
  return { run: run.id, written: [], adopted: [], tracked: [], held: [], removed: [], restored: [], kept: [], settings_written: [], settings_skipped: [], settings_reverted: [], settings_conflicts: [], mcp: [], steps: [], warnings: [] };
}

function execMcp(b, plan, res) {
  for (const m of plan.mcp) {
    if (m.action !== 'add') continue;
    const cmd = `claude mcp add-json ${m.name} '${JSON.stringify(m.config)}' -s user`;
    const got = b.run('claude', ['mcp', 'get', m.name], { timeout: 60000 });
    if (got.error) {
      res.steps.push({ part: m.part, kind: 'machine', text: `Could not run claude (${got.error.message}). Run yourself: ${cmd}` });
      continue;
    }
    if (got.status === 0 && !/No MCP server found/i.test(`${got.stdout}${got.stderr}`)) {
      res.warnings.push(`MCP server ${m.name} already exists; left as it is (its old settings cannot be restored, so sync does not touch it).`);
      continue;
    }
    b.state.mcp[m.name] = { part: m.part, prev: { $absent: true } };
    const add = b.run('claude', ['mcp', 'add-json', m.name, JSON.stringify(m.config), '-s', 'user'], { timeout: 60000 });
    if (add.error || add.status !== 0) {
      delete b.state.mcp[m.name];
      res.warnings.push(`Could not add MCP server ${m.name}: ${add.error?.message || add.stderr.trim() || `exit ${add.status}`}. Run yourself: ${cmd}`);
      continue;
    }
    res.mcp.push({ name: m.name, action: 'added' });
    save(b.state, b.cfg);
  }
}

function execMcpRollback(b, plan, res, config) {
  for (const m of plan.mcp || []) {
    if (m.action === 'remove') {
      const r = b.run('claude', ['mcp', 'remove', m.name, '-s', 'user'], { timeout: 60000 });
      if (r.error || r.status !== 0) {
        res.warnings.push(`Could not remove MCP server ${m.name}: ${r.error?.message || r.stderr.trim() || `exit ${r.status}`}. Run yourself: claude mcp remove ${m.name} -s user`);
        continue;
      }
      delete b.state.mcp[m.name];
      res.mcp.push({ name: m.name, action: 'removed' });
    } else if (m.action === 'add') {
      const cfgJson = config?.(m);
      if (!cfgJson) {
        res.warnings.push(`MCP server ${m.name} was removed by the undone run; add it again by hand if you want it.`);
        continue;
      }
      const r = b.run('claude', ['mcp', 'add-json', m.name, JSON.stringify(cfgJson), '-s', 'user'], { timeout: 60000 });
      if (r.error || r.status !== 0) {
        res.warnings.push(`Could not add MCP server ${m.name} back: ${r.error?.message || r.stderr.trim() || `exit ${r.status}`}.`);
        continue;
      }
      b.state.mcp[m.name] = { part: m.part, prev: { $absent: true } };
      res.mcp.push({ name: m.name, action: 'added' });
    } else res.warnings.push(`MCP server ${m.name}: its earlier settings cannot be restored automatically.`);
  }
  save(b.state, b.cfg);
}

function applyRemoval(b, item, runDir, answers, res) {
  const { cfg, state } = b;
  const sp = path.join(cfg, 'settings.json');
  for (const op of item.rem.ops) {
    const abs = absOf(cfg, op.dest);
    const stateOnly = op.kind === 'untrack';
    const cur = stateOnly ? op.expect : hashFile(abs);
    if (cur !== op.expect) throw new Error(`${op.dest} changed after the plan was made; plan again`);
    if (op.ask && answers[op.dest] !== 'revert') {
      journal(runDir, { ev: 'file', action: 'keep', dest: op.dest, existed: cur !== null, backup: null, hashBefore: cur, hashAfter: cur });
      delete state.files[op.dest];
      res.kept.push(op.dest);
      save(state, cfg);
      continue;
    }
    if (!stateOnly) {
      const backupAbs = cur !== null ? backupFile(runDir, abs, cfg) : null;
      const backup = backupAbs ? relInside(cfg, backupAbs) : null;
      if (op.kind === 'put') {
        journal(runDir, { ev: 'file', action: 'put', dest: op.dest, existed: cur !== null, backup, hashBefore: cur, hashAfter: op.hash });
        writeFileAtomic(abs, op.bytes ?? fs.readFileSync(op.bytesFrom), { exec: op.exec });
        if (hashFile(abs) !== op.hash) throw new Error(`${op.dest}: written file does not match the expected hash`);
        res.restored.push(op.dest);
      } else {
        journal(runDir, { ev: 'file', action: 'delete', dest: op.dest, existed: true, backup, hashBefore: cur, hashAfter: null });
        removeFile(abs, cfg);
        res.removed.push(op.dest);
      }
    }
    delete state.files[op.dest];
    save(state, cfg);
  }
  if (item.rem.entries.length) {
    const backupAbs = fs.existsSync(sp) ? backupFile(runDir, sp, cfg) : null;
    journal(runDir, { ev: 'settings-begin', existed: !!backupAbs, backup: backupAbs ? relInside(cfg, backupAbs) : null, hashBefore: hashFile(sp) });
    const out = merge.revert(sp, item.rem.entries.map((e) => e.entry));
    const bad = new Set(out.conflicts.map((c) => c.pointer));
    for (const e of item.rem.entries) if (!bad.has(e.entry.pointer)) delete state.settings[e.key];
    res.settings_reverted.push(...out.reverted);
    res.settings_conflicts.push(...out.conflicts.map((c) => c.pointer));
    journal(runDir, { ev: 'settings-end', hashAfter: hashFile(sp), reverted: out.reverted });
  }
  for (const m of item.rem.mcp) execMcpRollback(b, { mcp: [m] }, res);
  const left = Object.values(state.files).some((f) => f.part === item.entry.id && f.mode !== 'seed') || Object.values(state.settings).some((s) => s.part === item.entry.id);
  if (!left) delete state.parts[item.entry.id];
  save(state, cfg);
}

function execute(b, head, items, x, { kind = 'apply', proposals = [], answers = {} } = {}) {
  const { state, cfg } = b;
  state.values = x.values;
  const run = newRun(state, kind, state.repo.commit, head, cfg);
  run.proposals = proposals;
  save(state, cfg);
  const runDir = runDirOf(run, cfg);
  const res = newRes(run);
  for (const it of items) {
    if (it.remove) {
      applyRemoval(b, it, runDir, answers, res);
      res.steps.push(...it.entry.plugins.map((p) => ({ part: it.entry.id, kind: 'plugin', name: p.name, text: `The plugin "${p.name}" came with this part. Remove it yourself if you no longer want it.` })));
      continue;
    }
    const r = applyPlan(it.plan, { state, commit: head, configDir: cfg, runDir, merge, acceptSettings: [...x.accept] });
    res.written.push(...r.written);
    res.adopted.push(...r.adopted);
    res.tracked.push(...r.tracked);
    res.held.push(...r.held);
    res.settings_written.push(...r.settings.written);
    res.settings_skipped.push(...r.settings.skipped);
    res.warnings.push(...r.warnings);
    execMcp(b, it.plan, res);
    res.steps.push(...stepsOf(b, it.entry, it.plan, x.values));
    if (it.entry.id === ENGINE) {
      state.engine = { version: ENGINE_VERSION, sha256: hashFile(path.join(cfg, 'tools', 'claude-setup', 'sync')) };
      save(state, cfg);
    }
  }
  return { run, res };
}

function finalize(b, head, run, answerMap, { setCommit = true } = {}) {
  const { state, cfg } = b;
  for (const [id, answer] of Object.entries(answerMap)) state.answers[id] = { answer, at: iso(), commit: head, run: run.id };
  state.repo = setCommit ? { path: b.repo, commit: head, tag: tagAt(b, head) } : { ...state.repo, path: b.repo };
  finishRun(state, run, 'done');
  save(state, cfg);
}

function resLines(res) {
  const l = [];
  const n = (label, arr) => { if (arr.length) l.push(`${label}: ${arr.length}${arr.length <= 8 ? ` (${arr.join(', ')})` : ''}`); };
  n('Files written', res.written);
  n('Files taken over (already matched)', res.adopted);
  n('Files re-tracked', res.tracked);
  n('Files held (your edits kept)', res.held);
  n('Files restored', res.restored);
  n('Files removed', res.removed);
  n('Your edits kept', res.kept);
  n('Settings written', res.settings_written);
  n('Settings skipped (yours differ; ask to accept)', res.settings_skipped);
  n('Settings reverted', res.settings_reverted);
  n('Settings that could not be reverted (you changed them)', res.settings_conflicts);
  for (const m of res.mcp) l.push(`MCP server ${m.name}: ${m.action}`);
  for (const w of res.warnings) l.push(`Warning: ${w}`);
  if (res.steps.length) {
    l.push('Steps for you or your agent (do them only after the person says yes):');
    for (const s of res.steps) l.push(`- [${s.part}] ${s.text}`);
  }
  return l;
}

function engineItem(b, head, cat, x) {
  const e = cat.get(ENGINE);
  if (!e || !b.state.parts[ENGINE]?.installed) return null;
  const item = planPartItem(b, head, e, x);
  const files = item.plan.ops.filter((o) => o.kind === 'write').map((o) => o.dest);
  return files.length || item.plan.conflicts.length ? { item, files } : null;
}

function pendingList(b, head, cat, proposals, cctx = condCtx(b)) {
  const pend = pending(b.state, proposals, { check: (n) => check(n, cctx) });
  const hidden = { ...pend.hidden, not_installed: 0 };
  const visible = [];
  for (const p of pend.pending) {
    const id = p.meta.part.replace(/^new:/, '');
    const entry = cat.get(id);
    const installed = b.state.parts[id]?.installed === true;
    if (!entry || (!installed && p.meta.kind !== 'add' && !p.meta.part.startsWith('new:'))) { hidden.not_installed++; continue; }
    if (!installed && entry.needs.some((n) => !n.startsWith('part:') && check(n, cctx) === false)) { hidden.needs++; continue; }
    visible.push(p);
  }
  return { visible, hidden, unknown: pend.unknown };
}

function itemFor(b, head, cat, p, x) {
  const entry = cat.get(p.meta.part.replace(/^new:/, ''));
  if (p.meta.kind === 'remove') return planRemovalItem(b, entry);
  return planPartItem(b, head, entry, x);
}

function fetchHead(b) {
  if (has(b.a, 'no-fetch')) return { from: headCommit(b.repo), to: headCommit(b.repo), fetched: false };
  try {
    return { ...fetchAndUpdate(b.repo), fetched: true };
  } catch (e) {
    throw new Error(`could not update the clone (${String(e.stderr || e.message).trim().split('\n')[0]}). Check the network, or use --no-fetch to work with the clone as it is.`);
  }
}

function cmdApply(b, dryFlag) {
  const a = b.a;
  crashGuard(b);
  const fetched = fetchHead(b);
  const head = fetched.to;
  const { cat, warnings } = loadCat(b, head);
  const proposals = proposalsAt(b, head, new Set(cat.keys()), warnings);
  const x = baseX(b);
  const acceptIds = new Set([...list(a, 'proposals')]);
  const answers = pairs(list(a, 'answers'), '--answers');
  const proposalAnswers = {};
  const fileAnswers = {};
  for (const [k, v] of Object.entries(answers)) (['accept', 'skip', 'later'].includes(v) ? proposalAnswers : fileAnswers)[k] = v;
  for (const [k, v] of Object.entries(proposalAnswers)) if (v === 'accept') acceptIds.add(k);
  for (const id of acceptIds) if (proposalAnswers[id] && proposalAnswers[id] !== 'accept') throw new Error(`${id} is listed in --proposals but answered ${proposalAnswers[id]}`);
  const dry = dryFlag || has(a, 'plan');
  const wantsApply = !dry && (acceptIds.size > 0 || Object.keys(proposalAnswers).length > 0 || has(a, 'update-engine'));

  const eng = engineItem(b, head, cat, x);
  if (has(a, 'update-engine')) return updateEngine(b, head, cat, proposals, x, eng, fetched);
  if (eng) {
    const p = syntheticProposal(eng.item.entry, eng.item);
    const text = card(p, eng.item.dplan, eng.item.installed, { configDir: b.cfg });
    const engine = { update: true, files: eng.files, questions: eng.item.questions, card: text };
    if (wantsApply) return ask([{ kind: 'engine-update', text: 'The sync tool itself has an update. Install it first with: apply --update-engine, then run apply again.', flag: 'apply --update-engine' }], []);
    return ok({ command: 'apply', mode: 'plan', repo: { path: b.repo, from: fetched.from, head, tag: tagAt(b, head) }, engine, pending: [], hidden: {}, warnings, note: 'The sync tool has an update. Install it alone with: apply --update-engine. The rest is handled on the next run by the new tool.' },
      ['The sync tool itself has an update (engine update). It is installed alone; run: apply --update-engine, then apply again.', ...eng.files.map((f) => `- ${f}`)]);
  }

  const { visible, hidden, unknown } = pendingList(b, head, cat, proposals);
  const byId = new Map(visible.map((p) => [p.id, p]));
  for (const id of [...acceptIds, ...Object.keys(proposalAnswers)]) if (!byId.has(id)) throw new Error(`${id} is not pending (answered already, hidden, or unknown)`);
  const only = list(a, 'proposals');
  const shown = wantsApply ? visible.filter((p) => acceptIds.has(p.id)) : (dry && only.length ? visible.filter((p) => only.includes(p.id)) : visible);

  withEntries(b, x, shown.map((p) => cat.get(p.meta.part.replace(/^new:/, ''))).filter(Boolean));
  const items = [];
  const questions = [...x.questions];
  for (const p of shown) {
    let item;
    try {
      item = itemFor(b, head, cat, p, x);
    } catch (e) {
      if (wantsApply) throw new Error(`${p.id}: ${e.message}`);
      items.push({ p, error: e.message });
      continue;
    }
    item.p = p;
    items.push(item);
    const rq = riskQuestion(p.id, item, p.meta.ask_alone === true, p.meta.risk);
    if (rq && !(wantsApply && x.confirm.has(p.id))) item.questions.push(rq);
    if (wantsApply) questions.push(...item.questions.filter((q) => !(q.kind === 'local-edit-remove' && fileAnswers[q.dest])));
  }

  if (!wantsApply) {
    const want = has(a, 'cards') || only.length > 0;
    const texts = want || fileCount(items) <= MANY_FILES ? items.map((it) => (it.error ? '' : proposalCard(b, it.p, it))) : [];
    const cards = want || (texts.length > 0 && texts.reduce((n, s) => n + s.length, 0) <= CARD_BUDGET);
    const out = items.map((it, i) => (it.error
      ? { id: it.p.id, title: it.p.meta.title, error: it.error }
      : {
        id: it.p.id, title: it.p.meta.title, kind: it.p.meta.kind, level: it.p.meta.level, part: it.p.meta.part, ask_alone: it.p.meta.ask_alone === true,
        risky: it.risky, noop: it.noop, unknown_needs: unknown[it.p.id] ?? [], questions: it.questions, settings_conflicts: it.settingsConflicts,
        held: it.plan.held, files: it.files, steps: stepsOf(b, it.entry, it.plan, x.values), ...(cards ? { card: texts[i] } : {}),
        ...(b.state.parts[it.entry.id]?.installed ? {} : { part_card: partCard(it.entry, footprint(b, head, cat, it.entry)) }),
      }));
    const lines = out.flatMap((o, i) => (o.error ? [`${i + 1}. ${o.title}: could not plan (${o.error})`] : [`--- ${i + 1}/${out.length}: ${o.id}${o.noop ? ' (changes nothing on this PC)' : ''}`, o.card ?? `${o.title} (${o.files.length} file changes; run plan --proposals ${o.id} for the full card)`]));
    if (!out.length) lines.push('Nothing new to look at.');
    return ok({ command: 'apply', mode: 'plan', repo: { path: b.repo, from: fetched.from, head, tag: tagAt(b, head) }, engine: { update: false }, pending: out, cards_omitted: !cards && out.length > 0, hidden, warnings, questions: x.questions }, lines);
  }

  const targets = new Map();
  for (const it of items) {
    const id = it.entry.id;
    if (targets.has(id) && targets.get(id).remove !== !!it.remove) throw new Error(`conflicting proposals for part ${id} (change and remove)`);
    if (!targets.has(id)) targets.set(id, it);
  }
  if (questions.length) return ask(questions);

  const targetItems = [...targets.values()];
  const ordered = order(targetItems.filter((i) => !i.remove).map((i) => i.entry)).map((e) => targetItems.find((i) => i.entry.id === e.id));
  const final = [...targetItems.filter((i) => i.remove), ...ordered];
  const { run, res } = execute(b, head, final, x, { proposals: [...new Set([...acceptIds, ...Object.keys(proposalAnswers)])], answers: fileAnswers });
  const map = {};
  for (const id of acceptIds) map[id] = 'accept';
  for (const [id, v] of Object.entries(proposalAnswers)) map[id] = v;
  finalize(b, head, run, map);
  const count = (v) => Object.values(map).filter((m) => m === v).length;
  return ok({ command: 'apply', mode: 'applied', run: run.id, head, tag: tagAt(b, head), accepted: [...acceptIds], skipped: Object.keys(proposalAnswers).filter((k) => proposalAnswers[k] === 'skip'), later: Object.keys(proposalAnswers).filter((k) => proposalAnswers[k] === 'later'), result: res, warnings },
    [`Applied ${count('accept')}, skipped ${count('skip')}, postponed ${count('later')}.`, ...resLines(res)]);
}

function updateEngine(b, head, cat, proposals, x, eng, fetched) {
  if (!eng) return ok({ command: 'apply', mode: 'engine', updated: false, repo: { head } }, ['The sync tool is already up to date.']);
  const open = eng.item.questions.filter((q) => !x.keep.includes(q.dest) && !x.overwrite.includes(q.dest));
  if (open.length) return ask(open);
  const cctx = condCtx(b);
  const pend = pending(b.state, proposals, { check: (n) => check(n, cctx) }).pending.filter((p) => p.meta.part === ENGINE);
  const { run, res } = execute(b, head, [eng.item], x, { proposals: pend.map((p) => p.id) });
  for (const p of pend) b.state.answers[p.id] = { answer: 'accept', at: iso(), commit: head, run: run.id };
  finishRun(b.state, run, 'done');
  save(b.state, b.cfg);
  return ok({ command: 'apply', mode: 'engine', updated: true, run: run.id, result: res, next: 'Run apply again: the new sync tool handles the rest.' }, ['The sync tool was updated. Run apply again: the new tool handles the rest.', ...resLines(res)]);
}

function cmdInstall(b, dry) {
  const a = b.a;
  if (!dry) crashGuard(b);
  const head = headCommit(b.repo);
  const { cat, warnings } = loadCat(b, head);
  const ids = uniq(list(a, 'parts'));
  if (!ids.length) throw new Error('install needs --parts a,b');
  const unknownIds = ids.filter((id) => !cat.has(id));
  if (unknownIds.length) throw new Error(`unknown part(s): ${unknownIds.join(', ')}`);
  const entries = ids.map((id) => cat.get(id));
  const missing = [];
  for (const e of entries) for (const n of e.needs) if (n.startsWith('part:') && !ids.includes(n.slice(5)) && !b.state.parts[n.slice(5)]?.installed) missing.push({ part: e.id, requires: n.slice(5) });
  if (missing.length) return ask([{ kind: 'missing-parts', missing, text: `Also needed: ${uniq(missing.map((m) => m.requires)).join(', ')} (${missing.map((m) => `${m.part} needs ${m.requires}`).join('; ')}). Add them to --parts.`, flag: '--parts' }]);
  const cctx = condCtx(b, ids);
  const unmet = [];
  const unknown = [];
  for (const e of entries) for (const n of e.needs) {
    const r = check(n, cctx);
    if (r === false) unmet.push(`${e.id}: needs ${n}`);
    else if (r === 'unknown') unknown.push(`${e.id}: could not check ${n}`);
  }
  if (unmet.length) throw new Error(`cannot install: ${unmet.join('; ')}`);
  const x = withEntries(b, baseX(b), entries);
  const items = [];
  const questions = [...x.questions];
  for (const e of order(entries)) {
    const item = planPartItem(b, head, e, x);
    items.push(item);
    const rq = riskQuestion(e.id, item, e.ask_alone, e.risk);
    questions.push(...item.questions);
    if (rq && !x.confirm.has(e.id)) questions.push(rq);
  }
  const base = { command: dry ? 'plan' : 'install', head, warnings: [...warnings, ...unknown] };
  if (dry) {
    const want = has(a, 'cards');
    const texts = want || fileCount(items) <= MANY_FILES ? items.map((it) => card(syntheticProposal(it.entry, it), it.dplan, it.installed, { configDir: b.cfg })) : [];
    const cards = want || (texts.length > 0 && texts.reduce((n, s) => n + s.length, 0) <= CARD_BUDGET);
    const out = items.map((it, i) => ({
      id: it.entry.id, title: it.entry.title, level: it.entry.level, ask_alone: it.entry.ask_alone, risky: it.risky, questions: it.questions, settings_conflicts: it.settingsConflicts, held: it.plan.held,
      files: it.files, steps: stepsOf(b, it.entry, it.plan, x.values), ...(cards ? { card: texts[i] } : {}),
    }));
    return ok({ ...base, mode: 'plan', parts: out, cards_omitted: !cards, questions: x.questions }, out.flatMap((o, i) => [`--- ${i + 1}/${out.length}: ${o.id}${o.risky.length ? ` (risky: ${o.risky.join(', ')})` : ''}`, o.card ?? `${o.title}: ${o.files.length} file changes`]));
  }
  if (questions.length) return ask(questions);
  const firstRun = Object.keys(b.state.answers).length === 0;
  const { run, res } = execute(b, head, items, x, {});
  const proposals = proposalsAt(b, head, new Set(cat.keys()), warnings);
  const answers = {};
  for (const p of proposals) {
    const cur = b.state.answers[p.id]?.answer;
    const mine = ids.includes(p.meta.part.replace(/^new:/, ''));
    if (firstRun ? !cur : mine && (!cur || cur === 'later' || cur === 'rolled-back')) answers[p.id] = 'baseline';
  }
  finalize(b, head, run, answers);
  return ok({ ...base, mode: 'applied', run: run.id, tag: tagAt(b, head), parts: ids, baseline: Object.keys(answers), result: res },
    [`Installed ${ids.length} part(s): ${ids.join(', ')}.`, `${Object.keys(answers).length} existing proposal(s) recorded as already included.`, ...resLines(res)]);
}

function cmdBootstrap(b) {
  crashGuard(b);
  if (!one(b.a, 'repo')) throw new Error('bootstrap needs --repo <path to the clone>');
  const head = headCommit(b.repo);
  const { cat } = loadCat(b, head);
  const entry = cat.get(ENGINE);
  if (!entry) throw new Error(`this clone has no ${ENGINE} part`);
  const cctx = condCtx(b);
  const unmet = entry.needs.filter((n) => check(n, cctx) === false);
  if (unmet.length) throw new Error(`cannot set up: this PC lacks ${unmet.join(', ')}`);
  const x = baseX(b);
  const item = planPartItem(b, head, entry, x);
  const open = item.questions.filter((q) => !x.keep.includes(q.dest) && !x.overwrite.includes(q.dest));
  if (open.length) return ask(open);
  const { run, res } = execute(b, head, [item], x, {});
  finalize(b, head, run, {}, { setCommit: false });
  const sync = path.join(b.cfg, 'tools', 'claude-setup', 'sync', 'sync.mjs');
  return ok({ command: 'bootstrap', repo: b.repo, head, engine: sync, skill: path.join(b.cfg, 'skills', 'claude-setup-sync', 'SKILL.md'), run: run.id, result: res },
    ['Sync engine and skill installed. Nothing else was changed.', `Engine: ${sync}`, 'Next: start the claude-setup-sync skill for the first-run menu.', ...resLines(res)]);
}

function cmdCatalog(b) {
  const head = headCommit(b.repo);
  const { cat, warnings } = loadCat(b, head);
  const cctx = condCtx(b);
  const memo = new Map();
  const nonPart = (e) => e.needs.filter((n) => !n.startsWith('part:')).map((n) => ({ need: n, ok: check(n, cctx) }));
  const avail = (id, stack = []) => {
    if (memo.has(id)) return memo.get(id);
    const e = cat.get(id);
    if (!e || stack.includes(id)) return false;
    const r = nonPart(e).every((n) => n.ok !== false) && e.needs.filter((n) => n.startsWith('part:')).every((n) => b.state.parts[n.slice(5)]?.installed || avail(n.slice(5), [...stack, id]));
    memo.set(id, r);
    return r;
  };
  const detail = new Set(list(b.a, 'parts'));
  const SENSITIVE = /^(env|permissions|hooks|apiKeyHelper|mcpServers)$/;
  const sensitive = (e) => e.ask_alone || e.mcp.length > 0 || e.settings.some((s) => Object.keys(JSON.parse(showFileAt(b.repo, head, s).toString('utf8'))).some((k) => SENSITIVE.test(k)));
  const groups = [];
  const hidden = [];
  for (const g of GROUPS) {
    const parts = [];
    for (const e of [...cat.values()].filter((p) => p.group === g && p.id !== ENGINE).sort((p, q) => p.title.localeCompare(q.title))) {
      const needs = nonPart(e);
      if (!avail(e.id)) { hidden.push({ id: e.id, title: e.title, unmet: needs.filter((n) => n.ok === false).map((n) => n.need) }); continue; }
      const installed = b.state.parts[e.id]?.installed === true;
      const row = {
        id: e.id, title: e.title, summary: e.summary, benefit: e.benefit ?? null, level: e.level, use: e.use, trigger: e.trigger, ticked: e.level === 'recommended' && !installed, installed, ask_alone: e.ask_alone,
        unknown_needs: needs.filter((n) => n.ok === 'unknown').map((n) => n.need), requires_parts: e.needs.filter((n) => n.startsWith('part:')).map((n) => n.slice(5)),
      };
      if (detail.has(e.id)) {
        Object.assign(row, {
          card: partCard(e, footprint(b, head, cat, e)), solves: e.solves ?? null, use_cases: e.use_cases ?? [], tokens_on_use: e.tokens_on_use ?? null,
          details: e.details, changes: sensitive(e) ? e.risk : null, quality: e.quality, tokens: e.tokens_always_on, needs, values: e.values.map((v) => ({ key: v.key, ask: v.ask, default: v.default })),
          user_steps: e.user_steps, machine_steps: e.machine_steps.map((s) => fill(s, mergedValues(e, b.state.values))), plugins: e.plugins, mcp: e.mcp.map((m) => m.name),
        });
      }
      parts.push(row);
    }
    if (parts.length) groups.push({ group: g, parts });
  }
  const firstRun = Object.keys(b.state.answers).length === 0 && !Object.keys(b.state.parts).some((p) => p !== ENGINE);
  const lines = groups.flatMap((g) => [`${g.group}:`, ...g.parts.map((p) => `  [${p.installed ? 'installed' : p.ticked ? 'x' : ' '}] ${p.id} - ${p.title}${p.ask_alone ? ' (asks alone)' : ''}`)]);
  return ok({ command: 'catalog', head, tag: tagAt(b, head), first_run: firstRun, groups, hidden, warnings }, lines);
}

function summarizePlan(plan, b) {
  return {
    kind: plan.kind, from: plan.from, target: plan.target, target_tag: tagAt(b, plan.target),
    files: plan.ops.map((o) => ({ dest: o.dest, action: o.kind, why: o.why, ask: !!o.ask })),
    asks: plan.asks, problems: plan.problems,
    settings: { mode: plan.settings?.mode ?? null, pointers: (plan.settings?.entries ?? []).map((e) => e.entry.pointer) },
    mcp: plan.mcp, reopened_proposals: plan.answers, undone_runs: plan.runs, parts_removed: plan.parts.remove,
  };
}

function cmdRollback(b) {
  const a = b.a;
  const rctx = { repo: b.repo, configDir: b.cfg, state: b.state, home: b.home, merge };
  let plan;
  if (has(a, 'to')) {
    let sha;
    try { sha = resolveVersion(b.repo, one(a, 'to')); } catch { throw new Error(`unknown version: ${one(a, 'to')}`); }
    plan = planRollback(b.state, sha, rctx);
  } else if (has(a, 'crashed')) {
    const c = findCrashedRun(b.state);
    if (!c) throw new Error('no crashed run found');
    const active = b.state.runs.filter((r) => r.status !== 'rolled-back');
    plan = planUndo(b.state, rctx, { runs: active.length - active.indexOf(c) });
  } else if (has(a, 'runs')) plan = planUndo(b.state, rctx, { runs: Number(one(a, 'runs')) });
  else if (has(a, 'last') || has(a, 'redo')) {
    const active = b.state.runs.filter((r) => r.status !== 'rolled-back');
    const i = has(a, 'redo') ? active.length - 1 : active.findLastIndex((r) => r.kind !== 'rollback');
    if (has(a, 'redo') && active[i]?.kind !== 'rollback') throw new Error('nothing to redo: the last run is not a rollback');
    if (i < 0) throw new Error('no run to roll back');
    plan = planUndo(b.state, rctx, { runs: active.length - i });
  } else throw new Error('rollback needs --last, --redo, --runs N, --to <tag|sha> or --crashed');

  const sum = summarizePlan(plan, b);
  const lines = [
    plan.kind === 'undo' ? `Undo ${plan.runs.length} run(s): ${plan.runs.join(', ') || 'none'}` : `Go back to ${sum.target_tag ?? plan.target ?? 'before the first sync'}`,
    ...sum.files.map((f) => `- ${f.dest}: ${f.action}${f.ask ? ' (you edited it: keep or revert?)' : ''}`),
    ...sum.settings.pointers.map((p) => `- setting ${p}: revert`),
    ...plan.mcp.map((m) => `- MCP server ${m.name}: ${m.action}`),
    ...plan.problems.map((p) => `! ${p.dest}: ${p.reason}`),
  ];
  if (sum.reopened_proposals.length) lines.push(`Offered again at the next sync: ${sum.reopened_proposals.join(', ')}`);
  if (!lines.length) lines.push('Nothing to change.');
  if (has(a, 'plan')) return ok({ command: 'rollback', mode: 'plan', plan: sum }, lines);

  const answers = pairs(list(a, 'answers'), '--answers');
  const open = plan.asks.filter((q) => !q.options.includes(answers[q.dest]));
  if (open.length) {
    return ask(open.map((q) => ({ kind: 'rollback-ask', dest: q.dest, reason: q.reason, options: q.options, flag: '--answers <dest>=<option>', text: `${q.dest}: ${q.reason === 'local-edit' ? 'you edited it' : 'it changed since the run'}. Choose ${q.options.join(' or ')}.` })), lines);
  }
  const res = applyRollback(plan, rctx, answers);
  const out = newRes({ id: res.run });
  Object.assign(out, { written: res.written, removed: res.removed, restored: res.restored, kept: res.kept, settings_reverted: res.settings.reverted, settings_conflicts: res.settings.conflicts.map((c) => c.pointer) });
  const cfgOf = (m) => {
    const snap = plan.snapshot?.repo?.commit;
    return snap ? catalogAt(b.repo, snap).get(m.part)?.mcp?.find((x) => x.name === m.name)?.config : null;
  };
  execMcpRollback(b, plan, out, cfgOf);
  for (const p of res.problems) out.warnings.push(`${p.dest}: ${p.reason}`);
  return ok({ command: 'rollback', mode: 'applied', run: res.run, result: out, plan: sum, tag: b.state.repo.tag, commit: b.state.repo.commit },
    ['Rolled back.', ...resLines(out), 'Changes you rolled back are offered again at the next sync.']);
}

function cmdVersions(b) {
  const tags = listTags(b.repo).map((t) => ({ ...t, current: t.sha === b.state.repo.commit }));
  const runs = b.state.runs.map((r) => ({ id: r.id, kind: r.kind, at: r.at, status: r.status, from_tag: tagAt(b, r.from), to_tag: tagAt(b, r.to), proposals: r.proposals ?? [] }));
  return ok({ command: 'versions', current: { commit: b.state.repo.commit, tag: b.state.repo.tag }, tags, runs },
    [...tags.map((t) => `${t.current ? '*' : ' '} ${t.tag}  ${t.message}`), 'Your runs:', ...runs.map((r) => `  ${r.id} ${r.kind} ${r.status}${r.to_tag ? ` -> ${r.to_tag}` : ''}${r.proposals.length ? ` (${r.proposals.join(', ')})` : ''}`)]);
}

function cmdStatus(b) {
  const s = b.state;
  const data = { command: 'status', repo: { path: s.repo.path, commit: s.repo.commit, tag: s.repo.tag }, parts: Object.keys(s.parts).filter((p) => s.parts[p].installed).length, held: Object.entries(s.files).filter(([, f]) => f.held).map(([d]) => d), crashed: null, pending: null, engine_update: null, warnings: [] };
  const c = findCrashedRun(s);
  if (c) data.crashed = { run: c.id, kind: c.kind, at: c.at, options: ['finish (run the command again with --crash finish)', 'undo (rollback --crashed)'] };
  data.files_check = s.runs.some((r) => r.kind === 'adopt' && r.status === 'done') ? (s.files_checked === ENGINE_VERSION ? 'done' : 'pending') : null;
  const last = s.runs.at(-1);
  if (last) data.last_run = { id: last.id, kind: last.kind, status: last.status, at: last.at };
  if (b.repo) {
    try {
      git(['rev-parse', '--git-dir'], b.repo);
      const head = headCommit(b.repo);
      const { cat, warnings } = loadCat(b, head);
      data.head = { commit: head, tag: tagAt(b, head) };
      const props = proposalsAt(b, head, new Set(cat.keys()), warnings);
      const cctx = condCtx(b);
      cctx.fableAccess = () => s.facts.fable_access ?? 'unknown';
      data.pending = pendingList(b, head, cat, props, cctx).visible.length;
      const eng = cat.get(ENGINE);
      data.engine_update = !!(eng && s.parts[ENGINE]?.installed && planPartItem(b, head, eng, baseX(b)).plan.ops.some((o) => o.kind === 'write'));
      data.warnings.push(...warnings);
    } catch (e) {
      data.warnings.push(`could not read the clone at ${b.repo}: ${e.message}`);
    }
  }
  const lines = [
    s.repo.path ? `Clone: ${s.repo.path}` : 'Not set up yet (no clone known).',
    `Version: ${s.repo.tag ?? s.repo.commit ?? 'none applied yet'}${data.head && data.head.commit !== s.repo.commit ? ` (clone is at ${data.head.tag ?? data.head.commit.slice(0, 8)})` : ''}`,
    `Parts installed: ${data.parts}`,
    `Pending proposals: ${data.pending ?? 'unknown'}`,
    `Held files (your edits kept): ${data.held.length}${data.held.length ? ` (${data.held.join(', ')})` : ''}`,
  ];
  if (data.engine_update) lines.push('The sync tool has an update (apply --update-engine).');
  if (data.files_check === 'pending') lines.push('The files of the parts taken over from the old pack are not checked yet (repair --plan).');
  if (data.crashed) lines.push(`A previous run did not finish: ${data.crashed.run}. Finish it (run the command again with --crash finish) or undo it (rollback --crashed).`);
  return ok(data, lines);
}

function cmdValues(b) {
  const head = headCommit(b.repo);
  const { cat } = loadCat(b, head);
  const defs = new Map();
  for (const e of cat.values()) for (const v of e.values) {
    if (!defs.has(v.key)) defs.set(v.key, { key: v.key, ask: v.ask, default: v.default, parts: [], current: b.state.values[v.key] ?? null });
    defs.get(v.key).parts.push(e.id);
  }
  if (b.a.pos[0] === 'set') {
    const kv = pairs(b.a.pos.slice(1), 'values set');
    if (!Object.keys(kv).length) throw new Error('values set needs key=value');
    const bad = Object.keys(kv).filter((k) => !defs.has(k));
    if (bad.length) throw new Error(`unknown value key(s): ${bad.join(', ')}`);
    Object.assign(b.state.values, kv);
    save(b.state, b.cfg);
    const users = uniq(Object.keys(kv).flatMap((k) => defs.get(k).parts)).filter((p) => b.state.parts[p]?.installed);
    return ok({ command: 'values', set: kv, apply_with: users }, [`Stored: ${Object.keys(kv).join(', ')}.`, users.length ? `Takes effect when these parts are next updated, or now with: install --parts ${users.join(',')}` : 'No installed part uses them yet.']);
  }
  const all = [...defs.values()];
  return ok({ command: 'values', values: all }, all.map((v) => `${v.key} = ${v.current ?? `(default: ${v.default})`}  [${v.parts.join(', ')}]  ${v.ask}`));
}

function cmdVerify(b) {
  const head = headCommit(b.repo);
  const { cat } = loadCat(b, head);
  const results = [];
  const notes = [];
  const hooks = readJson(path.join(b.cfg, 'settings.json'), {}).hooks ?? {};
  const registered = new Set(Object.values(hooks).flat().flatMap((g) => g?.hooks ?? []).map((h) => h?.command));
  for (const id of Object.keys(b.state.parts).filter((p) => b.state.parts[p].installed)) {
    const e = cat.get(id);
    const files = Object.keys(b.state.files).filter((d) => b.state.files[d].part === id && b.state.files[d].mode !== 'seed');
    if (files.length) {
      const missing = files.filter((d) => !fs.existsSync(absOf(b.cfg, d)));
      results.push({ part: id, cmd: 'installed files exist', pass: !missing.length, output: missing.length ? `missing: ${missing.join(', ')}` : '' });
    }
    for (const src of e?.settings ?? []) {
      const frag = JSON.parse(showFileAt(b.repo, head, src).toString('utf8'));
      for (const [event, groups] of Object.entries(frag.hooks ?? {})) {
        for (const h of groups.flatMap((g) => g.hooks ?? [])) {
          const command = fill(h.command, mergedValues(e, b.state.values));
          if (!registered.has(command)) notes.push(`[${id}] the ${event} hook is not in settings.json: ${command}. Add it with: install --parts ${id}. Ignore this if you removed it yourself.`);
        }
      }
    }
    for (const cmd of e?.verify ?? []) {
      if (TEST && /\bclaude\b/.test(cmd)) { results.push({ part: id, cmd, pass: true, skipped: true }); continue; }
      const r = runVerify(cmd, { cfg: b.cfg, repo: b.repo });
      const pass = !r.error && r.status === 0;
      results.push({ part: id, cmd, pass, status: r.status, error: r.error?.message ?? null, output: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-5).join('\n') });
    }
  }
  const failed = results.filter((r) => !r.pass);
  return { code: failed.length ? 1 : 0, data: { ok: !failed.length, command: 'verify', results, notes }, lines: [`${results.length - failed.length}/${results.length} checks passed.`, ...notes.map((n) => `Note ${n}`), ...failed.map((r) => `FAIL [${r.part}] ${r.cmd}${r.error ? `: ${r.error}` : ''}${r.output ? `\n${r.output}` : ''}`)] };
}

function cmdAdopt(b) {
  crashGuard(b);
  const from = one(b.a, 'from') || 'pack-2026-11-21';
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(from)) throw new Error(`bad pack name: ${from}`);
  const head = headCommit(b.repo);
  let mig;
  try { mig = JSON.parse(showFileAt(b.repo, head, `migrations/${from}.json`).toString('utf8')); } catch { throw new Error(`no migration map migrations/${from}.json in the clone`); }
  const { cat } = loadCat(b, head);
  const { state, cfg } = b;
  const bySrc = new Map();
  for (const e of cat.values()) for (const it of expandFiles(e, b.repo, head, { home: b.home, lenient: true })) bySrc.set(it.src, { entry: e, item: it });

  const rep = { managed: [], held: [], seed: [], unmatched: [], already: [] };
  const found = [];
  const had = new Set();
  for (const m of mig) {
    if (!m.installed_at || !m.repo || m.installed_at.startsWith('rules/setup-pack/')) continue;
    const dest = m.installed_at.replace('<encoded-home>', encodeHome(b.home));
    let abs;
    try { abs = absOf(cfg, dest); } catch { rep.unmatched.push(dest); continue; }
    if (!fs.existsSync(abs)) continue;
    const hit = bySrc.get(m.repo);
    if (!hit || hit.item.dest !== dest) rep.unmatched.push(dest);
    else if (state.files[dest]) { rep.already.push(dest); had.add(hit.entry.id); }
    else { found.push({ dest, hit, m, cur: hashFile(abs) }); had.add(hit.entry.id); }
  }
  const packDir = path.join(cfg, 'rules', 'setup-pack');
  const packFiles = fs.existsSync(packDir) ? walk(packDir).map((r) => `rules/setup-pack/${r}`) : [];
  for (const [file, ids] of Object.entries(PACKS[from]?.rules ?? {})) if (packFiles.includes(file)) for (const id of ids) if (cat.has(id)) had.add(id);
  const enabled = enabledPlugins(cfg);
  for (const e of cat.values()) if (e.plugins.length && e.plugins.every((p) => enabled.has(p.name))) had.add(e.id);

  const hadEntries = [...cat.values()].filter((e) => had.has(e.id));
  const x = withEntries(b, baseX(b), hadEntries);
  if (x.questions.length) return ask(x.questions);

  const record = (st) => {
    for (const { dest, hit, m, cur } of found) {
      const same = hit.item.mode === 'seed' || cur === m.sha256_lf;
      st.files[dest] = { commit: head, part: hit.entry.id, mode: hit.item.mode, existed_before: false, backup: null, hash: same ? cur : m.sha256_lf, held: !same };
    }
  };
  for (const { dest, hit, m, cur } of found) (hit.item.mode === 'seed' ? rep.seed : cur === m.sha256_lf ? rep.managed : rep.held).push(dest);

  const draft = structuredClone(state);
  record(draft);
  const entries = order(hadEntries);
  const own = [];
  const settingsNot = [];
  const plans = entries.map((e) => {
    const part = { ...e, mcp: [], plugins: [] };
    const ctx = { repo: b.repo, commit: head, state: draft, configDir: cfg, home: b.home, merge, values: x.values, installedSkills: x.skills, keep: [], overwrite: [] };
    let plan = planPart(part, ctx);
    if (plan.conflicts.length) plan = planPart(part, { ...ctx, keep: plan.conflicts.map((c) => c.dest) });
    const mine = plan.ops.filter((o) => o.kind === 'write' && o.why === 'replaces-user-file');
    own.push(...mine.map((o) => ({ dest: o.dest, part: e.id, mode: o.mode, hash: o.hash })));
    const pointers = plan.settings.flatMap((f) => f.ops.filter((o) => o.op === 'add' || o.op === 'conflict').map((o) => o.pointer));
    if (pointers.length) settingsNot.push({ part: e.id, pointers });
    return { ...plan, ops: plan.ops.filter((o) => !mine.includes(o)), settings: [] };
  });
  rep.held.push(...plans.flatMap((p) => p.ops.filter((o) => o.kind === 'hold').map((o) => o.dest)));
  const writes = (rule) => plans.flatMap((p, i) => p.ops.filter((o) => o.kind === 'write' && entries[i].rules.includes(o.src) === rule).map((o) => o.dest)).sort();
  const filesWritten = writes(false);
  const rulesWritten = writes(true);
  const ownKept = own.map((o) => o.dest).sort();
  const listed = (label, arr) => (arr.length ? [`${label}: ${arr.length}${arr.length <= 8 ? ` (${arr.join(', ')})` : ''}`] : []);
  const settingsLine = settingsNot.length ? [`Settings the new version would add or change were left as they are: ${settingsNot.map((s) => `${s.part} (${s.pointers.join(', ')})`).join('; ')}. Add them with: install --parts ${settingsNot.map((s) => s.part).join(',')}`] : [];
  const partList = entries.map((e, i) => ({ id: e.id, title: e.title, summary: e.summary, files_written: plans[i].ops.filter((o) => o.kind === 'write').length }));
  const out = { from, head, report: rep, files_written: filesWritten, rules_written: rulesWritten, own_files_kept: ownKept, settings_not_applied: settingsNot, rules_removed: packFiles, parts: [...had], part_list: partList };
  if (has(b.a, 'plan')) {
    return ok({ command: 'adopt', mode: 'plan', ...out }, [
      `Adopt would take over from ${from}: ${rep.managed.length} files managed, ${rep.held.length} held (your edits kept), ${rep.seed.length} seed file(s).`,
      ...listed('Files it would add or bring up to date', filesWritten),
      ...listed('Rule files it would write', rulesWritten),
      ...(ownKept.length ? [`Your own files at part paths it would keep: ${ownKept.join(', ')}`] : []),
      ...settingsLine,
      packFiles.length ? `It would back up and remove rules/setup-pack (${packFiles.length} files).` : 'No rules/setup-pack folder found.',
      'Nothing was changed.',
    ]);
  }

  const run = newRun(state, 'adopt', state.repo.commit, head, cfg);
  save(state, cfg);
  const runDir = runDirOf(run, cfg);
  record(state);
  for (const o of own) state.files[o.dest] = { hash: o.hash, commit: head, part: o.part, mode: o.mode, existed_before: true, backup: relInside(cfg, backupFile(runDir, absOf(cfg, o.dest), cfg)), held: true };
  save(state, cfg);

  const packHash = new Map(mig.filter((m) => m.installed_at).map((m) => [m.installed_at, m.sha256]));
  const covered = new Set(Object.entries(PACKS[from]?.rules ?? {}).filter(([, ids]) => ids.some((id) => cat.has(id))).map(([file]) => file));
  const editedRules = [];
  const keptRules = [];
  for (const dest of packFiles) {
    const abs = absOf(cfg, dest);
    const keepDest = `rules/${path.basename(dest)}`;
    const keepAbs = absOf(cfg, keepDest);
    if (!covered.has(dest) && dest.endsWith('.md') && !fs.existsSync(keepAbs)) {
      const bytes = fs.readFileSync(abs);
      writeFileAtomic(keepAbs, bytes);
      journal(runDir, { ev: 'file', action: 'put', dest: keepDest, existed: false, backup: null, hashBefore: null, hashAfter: hashFile(keepAbs) });
      keptRules.push(keepDest);
    }
    const raw = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    const backupAbs = backupFile(runDir, abs, cfg);
    journal(runDir, { ev: 'file', action: 'delete', dest, existed: true, backup: relInside(cfg, backupAbs), hashBefore: hashFile(abs), hashAfter: null });
    if (packHash.has(dest) && packHash.get(dest) !== raw) editedRules.push(dest);
    removeFile(abs, cfg);
  }

  state.values = x.values;
  for (const plan of plans) applyPlan(plan, { repo: b.repo, commit: head, state, configDir: cfg, home: b.home, merge, runDir });
  state.repo = { ...state.repo, path: b.repo };
  state.files_checked = ENGINE_VERSION;
  finishRun(state, run, 'done');
  save(state, cfg);
  const defaults = uniq(hadEntries.flatMap((e) => e.values.filter((v) => state.values[v.key] === undefined).map((v) => v.key)));
  const lines = [
    `Taken over from ${from}: ${rep.managed.length} files now managed, ${rep.held.length} held (your edits kept), ${rep.seed.length} seed file(s).`,
    ...listed('Files added or brought up to date', filesWritten),
    ...(ownKept.length ? [`Your own files at part paths were kept, and updates leave them alone: ${ownKept.join(', ')}.`] : []),
    ...settingsLine,
    ...(rep.unmatched.length ? [`Not matched to any part (left alone): ${rep.unmatched.length}`] : []),
    packFiles.length ? `Old rules folder rules/setup-pack backed up and removed (${packFiles.length} files); flat rules written: ${rulesWritten.length}.` : 'No rules/setup-pack folder found.',
    ...(keptRules.length ? [`Rules no part covers any more were kept as your own files: ${keptRules.join(', ')}.`] : []),
    ...(editedRules.length ? [`You edited ${editedRules.join(', ')}; your version is in the run backup (${relInside(cfg, runDir)}). Copy anything you want to keep into your own CLAUDE.md.`] : []),
    ...(defaults.length ? [`Rendered rules used default fill-in values for: ${defaults.join(', ')}. Set yours with "values set key=value", then install --parts <part>.`] : []),
  ];
  return ok({ command: 'adopt', mode: 'applied', ...out, run: run.id, kept_rules: keptRules, edited_rules: editedRules, default_values: defaults }, lines);
}

const REPAIR_WHY = new Set(['new', 'restore-missing', 'update', 'seed']);

function cmdRepair(b) {
  crashGuard(b);
  const { state, cfg } = b;
  const adopted = new Set(state.runs.filter((r) => r.kind === 'adopt' && r.status === 'done').map((r) => r.to));
  const x = baseX(b);
  const cats = new Map();
  const items = [];
  const warnings = [];
  for (const [id, p] of Object.entries(state.parts)) {
    if (!p.installed || id === ENGINE || !adopted.has(p.at_commit)) continue;
    if (!cats.has(p.at_commit)) {
      try {
        cats.set(p.at_commit, catalogAt(b.repo, p.at_commit));
      } catch (e) {
        cats.set(p.at_commit, new Map());
        warnings.push(`version ${p.at_commit.slice(0, 8)} is not in the clone, its parts were not checked: ${e.message}`);
      }
    }
    const e = cats.get(p.at_commit).get(id);
    if (!e) continue;
    const plan = planPart({ ...e, settings: [], mcp: [], plugins: [] }, { repo: b.repo, commit: p.at_commit, state, configDir: cfg, home: b.home, merge, values: x.values, installedSkills: x.skills, keep: [], overwrite: [] });
    const ops = plan.ops.filter((o) => o.kind === 'write' && REPAIR_WHY.has(o.why));
    if (ops.length) items.push({ id, commit: p.at_commit, plan: { ...plan, ops, conflicts: [], held: [] } });
  }
  const files = items.flatMap((it) => it.plan.ops.map((o) => ({ part: it.id, dest: o.dest, why: o.why })));
  const checked = () => {
    if (warnings.length) return;
    state.files_checked = ENGINE_VERSION;
    save(state, cfg);
  };
  if (!files.length) {
    checked();
    return ok({ command: 'repair', mode: has(b.a, 'plan') ? 'plan' : 'applied', files, warnings }, ['Nothing to repair: the parts taken over from the old pack have all their files.', ...warnings.map((w) => `Warning: ${w}`)]);
  }
  if (has(b.a, 'plan')) {
    return ok({ command: 'repair', mode: 'plan', files, parts: uniq(items.map((it) => it.id)), warnings }, [`Missing or outdated files: ${files.length}`, ...files.map((f) => `- [${f.part}] ${f.dest} (${f.why})`), ...warnings.map((w) => `Warning: ${w}`)]);
  }
  const run = newRun(state, 'repair', state.repo.commit, state.repo.commit, cfg);
  save(state, cfg);
  const runDir = runDirOf(run, cfg);
  const res = newRes(run);
  for (const it of items) res.written.push(...applyPlan(it.plan, { state, commit: it.commit, configDir: cfg, runDir, merge }).written);
  res.warnings.push(...warnings);
  finishRun(state, run, 'done');
  checked();
  return ok({ command: 'repair', mode: 'applied', run: run.id, files, result: res, warnings }, ['Repaired.', ...resLines(res)]);
}

const COMMANDS = {
  status: (b) => cmdStatus(b),
  catalog: (b) => cmdCatalog(b),
  plan: (b) => (has(b.a, 'parts') ? cmdInstall(b, true) : cmdApply(b, true)),
  install: (b) => cmdInstall(b, false),
  apply: (b) => cmdApply(b, false),
  rollback: (b) => cmdRollback(b),
  versions: (b) => cmdVersions(b),
  adopt: (b) => cmdAdopt(b),
  repair: (b) => cmdRepair(b),
  verify: (b) => cmdVerify(b),
  values: (b) => cmdValues(b),
  bootstrap: (b) => cmdBootstrap(b),
};

function main(argv) {
  let a;
  let json = argv.includes('--json');
  let result;
  try {
    a = parseArgs(argv);
    json = has(a, 'json');
    if (!a.cmd || !COMMANDS[a.cmd]) {
      result = fail(`usage: sync.mjs <${Object.keys(COMMANDS).join('|')}> [--json] [options]`);
    } else {
      const b = boot(a, { repo: a.cmd !== 'status' ? true : false });
      if (a.cmd === 'status') {
        try { b.repo = one(a, 'repo') ? path.resolve(one(a, 'repo')) : b.state.repo.path; } catch { /* status is read-only */ }
      }
      try {
        result = COMMANDS[a.cmd](b);
      } finally {
        if (JSON.stringify(b.state.facts) !== b.facts0) save(b.state, b.cfg);
      }
    }
  } catch (e) {
    result = e instanceof Stop ? e.result : fail(e.message);
  }
  process.stdout.write(json ? `${JSON.stringify(result.data)}\n` : `${result.lines.join('\n')}\n`);
  process.exitCode = result.code;
}

main(process.argv.slice(2));
