import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAllowed, backupFile, configDir, hashBuffer, hashFile, journal, readJournal, readJson, relInside, removeFile, writeFileAtomic } from './fsx.mjs';
import { isAfter, listTags, lsTree, showFileAt } from './repo.mjs';
import { absOf, bytesFor, defaultMerge, expandFiles, mergedValues, revertEntry } from './install.mjs';
import { finishRun, newRun, runDirOf, save } from './state.mjs';

const isAbsentMark = (v) => v && typeof v === 'object' && v.$absent === true;

export function catalogAt(repo, commit) {
  const out = new Map();
  if (!commit) return out;
  for (const t of lsTree(repo, commit, 'catalog')) {
    if (!/^catalog\/[^/]+\.json$/.test(t.path)) continue;
    const e = JSON.parse(showFileAt(repo, commit, t.path).toString('utf8'));
    out.set(e.id, e);
  }
  return out;
}

const withBytes = (op, bytes) => {
  Object.defineProperty(op, 'bytes', { value: bytes, enumerable: false });
  return op;
};

const newPlan = (kind, target, from) => ({
  kind, target, from, ops: [], asks: [], settings: null, mcp: [], problems: [], parts: { remove: [], update: [] }, answers: [], runs: [], suffix: [], unchanged: 0,
});

export function planRollback(state, targetCommit, ctx) {
  const { repo } = ctx;
  const cfg = ctx.configDir ?? configDir();
  const home = ctx.home ?? os.homedir();
  const target = targetCommit || null;
  const after = (c) => (target ? isAfter(repo, c, target) : !!c);
  const tcat = catalogAt(repo, target);
  const plan = newPlan('rollback', target, state.repo.commit);
  plan.settings = { mode: 'revert', entries: [] };

  const cache = new Map();
  const expected = (partId) => {
    if (!cache.has(partId)) {
      const m = new Map();
      const e = tcat.get(partId);
      if (e && state.parts[partId]?.installed !== false) {
        const values = mergedValues(e, ctx.values ?? state.values);
        for (const item of expandFiles(e, repo, target, { home, lenient: true })) {
          if (item.mode === 'seed') continue;
          const bytes = bytesFor(e, item, repo, target, values, [], home);
          m.set(item.dest, { item, bytes, hash: hashBuffer(bytes) });
        }
      }
      cache.set(partId, m);
    }
    return cache.get(partId);
  };

  for (const [dest, tr] of Object.entries(state.files)) {
    if (tr.mode === 'seed') continue;
    const cur = hashFile(absOf(cfg, dest));
    const exp = expected(tr.part).get(dest);
    const edited = cur !== null && cur !== tr.hash;
    const ask = (action) => {
      plan.asks.push({ dest, reason: 'local-edit', action, current: cur, installed: tr.hash, options: ['keep', 'revert'] });
      return true;
    };
    if (exp) {
      if (cur === exp.hash) {
        if (tr.hash !== exp.hash || tr.held) plan.ops.push({ kind: 'track', dest, why: 'matches-target', expect: cur, next: { ...tr, hash: exp.hash, commit: target, held: false } });
        else plan.unchanged++;
        continue;
      }
      const next = { ...tr, hash: exp.hash, commit: target, held: false };
      const op = withBytes({ kind: 'put', dest, why: 'target-content', expect: cur, hash: exp.hash, exec: exp.item.exec, next }, exp.bytes);
      if (edited) op.ask = ask('revert-to-target');
      plan.ops.push(op);
    } else if (tr.existed_before) {
      const from = tr.backup ? (path.isAbsolute(tr.backup) ? tr.backup : absOf(cfg, tr.backup)) : null;
      if (!from || !fs.existsSync(from)) {
        plan.problems.push({ dest, reason: 'backup-missing', backup: tr.backup });
        continue;
      }
      const op = { kind: 'put', dest, why: 'restore-original', expect: cur, hash: hashFile(from), bytesFrom: from, next: null };
      if (edited) op.ask = ask('restore-original');
      plan.ops.push(op);
    } else {
      const op = { kind: cur === null ? 'untrack' : 'delete', dest, why: 'not-in-target', expect: cur, hash: null, next: null };
      if (edited) op.ask = ask('remove');
      plan.ops.push(op);
    }
  }

  for (const [key, e] of Object.entries(state.settings)) {
    const run = state.runs.find((r) => r.id === e.run);
    if (!run || !after(run.to)) continue;
    const h = [...(e.history || [])].reverse().find((x) => {
      const r = state.runs.find((y) => y.id === x.run);
      return r && !after(r.to);
    });
    if (h) plan.settings.entries.push({ key, entry: { ...revertEntry(e), prev: h.value }, next: { ...e, value: h.value, run: h.run, history: e.history.slice(0, e.history.indexOf(h)) } });
    else plan.settings.entries.push({ key, entry: revertEntry(e), next: null });
  }

  for (const [name, m] of Object.entries(state.mcp)) {
    if (!tcat.get(m.part)?.mcp?.some((x) => x.name === name)) plan.mcp.push({ name, part: m.part, action: isAbsentMark(m.prev) ? 'remove' : 'restore', prev: m.prev });
  }
  for (const id of Object.keys(state.parts)) (tcat.has(id) ? plan.parts.update : plan.parts.remove).push(id);
  for (const [pid, a] of Object.entries(state.answers)) if (after(a.commit)) plan.answers.push(pid);
  for (const r of state.runs) if (r.kind !== 'rollback' && r.status === 'done' && after(r.to)) plan.runs.push(r.id);
  return plan;
}

export function planUndo(state, ctx, { runs = 1 } = {}) {
  const cfg = ctx.configDir ?? configDir();
  const activeIdx = state.runs.map((r, i) => (r.status === 'rolled-back' ? -1 : i)).filter((i) => i >= 0);
  if (activeIdx.length < runs) throw new Error(`only ${activeIdx.length} run(s) can be undone`);
  const suffix = state.runs.slice(activeIdx[activeIdx.length - runs]);
  const snapshot = readJson(path.join(runDirOf(suffix[0], cfg), 'state-before.json'), null);
  if (!snapshot) throw new Error(`no saved state for run ${suffix[0].id}`);

  const first = new Map();
  const last = new Map();
  let begin = null;
  let end = null;
  for (const r of suffix) {
    for (const ev of readJournal(runDirOf(r, cfg))) {
      if (ev.ev === 'file' && ev.dest === 'settings.json') {
        if (ev.hashBefore !== ev.hashAfter) {
          begin ??= ev;
          end = ev;
        }
      } else if (ev.ev === 'file' && ev.hashBefore !== ev.hashAfter) {
        if (!first.has(ev.dest)) first.set(ev.dest, ev);
        last.set(ev.dest, ev);
      } else if (ev.ev === 'settings-begin') {
        begin ??= ev;
        end = null;
      } else if (ev.ev === 'settings-end') {
        end = ev;
      }
    }
  }

  const plan = newPlan('undo', snapshot.repo?.commit ?? null, state.repo.commit);
  plan.suffix = suffix.map((r) => r.id);
  plan.runs = suffix.filter((r) => r.status !== 'rolled-back').map((r) => r.id);
  Object.defineProperty(plan, 'snapshot', { value: snapshot, enumerable: false });

  const problem = (dest, backup) => plan.problems.push({ dest, reason: 'backup-missing', backup });

  for (const [dest, pre] of first) {
    const cur = hashFile(absOf(cfg, dest));
    if (cur === pre.hashBefore) continue;
    const op = { kind: pre.existed ? 'put' : 'delete', dest, why: 'undo-run', expect: cur, hash: pre.hashBefore };
    if (pre.existed) {
      const from = pre.backup ? absOf(cfg, pre.backup) : null;
      if (!from || !fs.existsSync(from)) {
        problem(dest, pre.backup);
        continue;
      }
      op.bytesFrom = from;
    }
    const post = last.get(dest);
    if (cur !== post.hashAfter) {
      op.ask = true;
      plan.asks.push({ dest, reason: 'local-edit', action: 'undo-run', current: cur, installed: post.hashAfter, options: ['keep', 'revert'] });
    }
    plan.ops.push(op);
  }

  if (begin) {
    const sp = path.join(cfg, 'settings.json');
    const cur = hashFile(sp);
    const backup = begin.backup ? absOf(cfg, begin.backup) : null;
    if (cur !== begin.hashBefore) {
      if (begin.existed && (!backup || !fs.existsSync(backup))) {
        problem('settings.json', begin.backup);
      } else if (end && cur === end.hashAfter) {
        const op = { kind: begin.existed ? 'put' : 'delete', dest: 'settings.json', why: 'undo-run', expect: cur, hash: begin.hashBefore };
        if (backup) op.bytesFrom = backup;
        plan.ops.push(op);
      } else {
        const ids = new Set(plan.suffix);
        const mine = Object.entries(state.settings).filter(([, e]) => ids.has(e.run));
        plan.asks.push({ dest: 'settings.json', reason: 'changed-since-run', action: 'undo-run', current: cur, installed: end?.hashAfter ?? null, options: mine.length ? ['keep', 'revert-entries'] : ['keep'] });
        plan.settings = { mode: 'entries', entries: mine.map(([key, e]) => ({ key, entry: revertEntry(e), next: null })) };
      }
    }
  }

  for (const [name, m] of Object.entries(state.mcp)) if (!snapshot.mcp?.[name]) plan.mcp.push({ name, part: m.part, action: isAbsentMark(m.prev) ? 'remove' : 'restore', prev: m.prev });
  for (const [name, m] of Object.entries(snapshot.mcp || {})) if (!state.mcp[name]) plan.mcp.push({ name, part: m.part, action: 'add' });
  return plan;
}

function applyOp(op, state, cfg, runDir, answers, res) {
  const abs = absOf(cfg, op.dest);
  const stateOnly = op.kind === 'track' || op.kind === 'untrack';
  const cur = stateOnly ? op.expect : hashFile(abs);
  if (cur !== op.expect) throw new Error(`${op.dest} changed after the plan was made; plan again`);
  const setState = () => {
    if (op.next === null) delete state.files[op.dest];
    else if (op.next) state.files[op.dest] = op.next;
  };
  if (op.ask && answers[op.dest] !== 'revert') {
    if (state.files[op.dest]) state.files[op.dest] = { ...state.files[op.dest], held: true };
    journal(runDir, { ev: 'file', action: 'keep', dest: op.dest, existed: cur !== null, backup: null, hashBefore: cur, hashAfter: cur });
    res.kept.push(op.dest);
    return;
  }
  if (stateOnly) {
    journal(runDir, { ev: 'file', action: op.kind, dest: op.dest, existed: false, backup: null, hashBefore: cur, hashAfter: cur });
    return setState();
  }
  assertAllowed(abs);
  const backupAbs = cur !== null ? backupFile(runDir, abs, cfg) : null;
  const backup = backupAbs ? relInside(cfg, backupAbs) : null;
  if (op.kind === 'put') {
    const bytes = op.bytes ?? fs.readFileSync(op.bytesFrom);
    journal(runDir, { ev: 'file', action: 'put', dest: op.dest, existed: cur !== null, backup, hashBefore: cur, hashAfter: op.hash });
    writeFileAtomic(abs, bytes, { exec: op.exec });
    if (hashFile(abs) !== op.hash) throw new Error(`${op.dest}: written file does not match the expected hash`);
    (op.why === 'target-content' ? res.written : res.restored).push(op.dest);
  } else {
    journal(runDir, { ev: 'file', action: 'delete', dest: op.dest, existed: true, backup, hashBefore: cur, hashAfter: null });
    removeFile(abs, cfg);
    res.removed.push(op.dest);
  }
  setState();
}

export function applyRollback(plan, ctx, answers = {}) {
  const { state } = ctx;
  const cfg = ctx.configDir ?? configDir();
  assertAllowed(cfg);
  const open = plan.asks.filter((a) => !a.options.includes(answers[a.dest]));
  if (open.length) throw new Error(`no answer for: ${open.map((a) => a.dest).join(', ')}`);

  const run = newRun(state, 'rollback', plan.from, plan.target, cfg);
  run.undoes = [...plan.runs];
  save(state, cfg);
  const runDir = runDirOf(run, cfg);
  const res = { run: run.id, written: [], removed: [], restored: [], kept: [], settings: { reverted: [], conflicts: [] }, mcp: plan.mcp, problems: plan.problems };

  try {
    for (const op of plan.ops) {
      applyOp(op, state, cfg, runDir, answers, res);
      save(state, cfg);
    }

    const entries = plan.settings?.entries || [];
    const doRevert = entries.length && (plan.settings.mode === 'revert' || answers['settings.json'] === 'revert-entries');
    if (doRevert) {
      const merge = ctx.merge ?? defaultMerge;
      if (!merge) throw new Error('settings-merge.mjs is not available');
      const sp = path.join(cfg, 'settings.json');
      assertAllowed(sp);
      const backupAbs = fs.existsSync(sp) ? backupFile(runDir, sp, cfg) : null;
      journal(runDir, { ev: 'settings-begin', existed: !!backupAbs, backup: backupAbs ? relInside(cfg, backupAbs) : null, hashBefore: hashFile(sp) });
      const out = merge.revert(sp, entries.map((e) => e.entry));
      const bad = new Set(out.conflicts.map((c) => c.pointer));
      for (const e of entries) {
        if (bad.has(e.entry.pointer)) continue;
        if (e.next) state.settings[e.key] = e.next;
        else delete state.settings[e.key];
      }
      res.settings = { reverted: out.reverted, conflicts: out.conflicts };
      journal(runDir, { ev: 'settings-end', hashAfter: hashFile(sp), reverted: out.reverted });
      save(state, cfg);
    }

    if (plan.kind === 'undo') {
      const snap = plan.snapshot;
      for (const k of ['repo', 'parts', 'answers', 'files']) state[k] = structuredClone(snap[k]);
      state.settings = structuredClone(snap.settings);
      for (const dest of res.kept) if (state.files[dest]) state.files[dest].held = true;
      const inSuffix = new Set(plan.suffix);
      for (const id of plan.suffix) {
        const r = state.runs.find((x) => x.id === id);
        if (!r) continue;
        r.status = 'rolled-back';
        for (const u of r.undoes || []) {
          const ru = state.runs.find((x) => x.id === u);
          if (ru && !inSuffix.has(u) && ru.status === 'rolled-back') ru.status = 'done';
        }
      }
    } else {
      for (const id of plan.parts.remove) {
        const used = Object.values(state.files).some((f) => f.part === id && f.mode !== 'seed') || Object.values(state.settings).some((s) => s.part === id);
        if (!used) delete state.parts[id];
      }
      for (const id of plan.parts.update) if (state.parts[id]) state.parts[id] = { installed: true, at_commit: plan.target };
      for (const pid of plan.answers) state.answers[pid] = { answer: 'rolled-back', at: new Date().toISOString(), commit: plan.target, run: run.id };
      for (const id of plan.runs) finishRun(state, id, 'rolled-back');
      const tag = plan.target ? (listTags(ctx.repo).find((t) => t.sha === plan.target) ?? {}).tag ?? null : null;
      state.repo = { ...state.repo, commit: plan.target, tag: ctx.tag ?? tag };
    }
    finishRun(state, run, 'done');
  } finally {
    save(state, cfg);
  }
  return res;
}
