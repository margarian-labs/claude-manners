import fs from 'node:fs';
import path from 'node:path';
import { assertAllowed, backupFile, hashBuffer, hashFile, inside, journal, relInside, removeFile, writeFileAtomic } from './fsx.mjs';
import { load, newRun, runDirOf, save, stateFile } from './state.mjs';

const OLD_STATE = 'state/claude-setup';
const NEW_STATE = 'state/claude-manners';
const NEW_ENGINE = 'tools/claude-manners/sync/sync.mjs';
const FORWARDER = 'tools/claude-setup/sync/sync.mjs';
const OLD_RULE = /^rules\/claude-setup--/;
const NEW_RULE = /^rules\/claude-manners--/;
const OLD_ENGINE = /^(tools\/claude-setup\/sync|skills\/claude-setup-sync)\//;
const MENTION = /claude-setup(--|-sync)|(tools|state)[\\/]+claude-setup/;

// Only the header lines the payload itself wrote: a person's fill-in values in a rule may hold the old name too.
const header = (name) => new RegExp(`^(<!-- |# |Installed by )${name}(?= part: | rules: | into ~/\\.claude/rules/)`, 'gm');
const swap = (from, to) => (bytes) => Buffer.from(bytes.toString('latin1').replace(header(from), `$1${to}`), 'latin1');
export const renameBytes = swap('claude-setup', 'claude-manners');
const unrenameBytes = swap('claude-manners', 'claude-setup');

export const aliasRule = (dest) => dest.replace(OLD_RULE, 'rules/claude-manners--');
export const isForwarderSrc = (src) => src.startsWith('payload/legacy/');
export const beforeRename = (engineEntry) => !engineEntry?.files?.some((f) => f.dest.startsWith('tools/claude-manners/'));
export const NO_WAY_BACK = 'This setup was renamed from claude-setup to claude-manners, and rollback cannot go back past the rename. Files from before it are in state/claude-manners/backups. To close a run that did not finish before the rename, use --crash finish.';

const at = (cfg, key) => path.join(cfg, ...key.split('/'));

function move(from, to) {
  assertAllowed(from);
  assertAllowed(to);
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}

function moveStateFolder(cfg) {
  const from = at(cfg, OLD_STATE);
  const to = at(cfg, NEW_STATE);
  if (!fs.existsSync(path.join(from, 'state.json'))) return;
  if (fs.existsSync(to)) throw new Error(`two sync folders found: ${from} and ${to}. Nothing was changed. Keep the one whose state.json has your parts, move the other one out of the state folder, then run this again.`);
  try {
    move(from, to);
  } catch (e) {
    throw new Error(`could not rename ${from} to claude-manners (${e.code}). Nothing was changed. Close programs that have it open, then run this again.`);
  }
}

function newBackupPath(cfg, p) {
  if (typeof p !== 'string') return p;
  if (p.startsWith(`${OLD_STATE}/`)) return NEW_STATE + p.slice(OLD_STATE.length);
  const old = at(cfg, OLD_STATE) + path.sep;
  return path.isAbsolute(p) && path.normalize(p).startsWith(old) ? path.join(at(cfg, NEW_STATE), path.normalize(p).slice(old.length)) : p;
}

const fromBefore = (state) => Object.entries(state.files).some(([k, f]) => OLD_RULE.test(k) || OLD_ENGINE.test(k) || f.backup?.startsWith?.(`${OLD_STATE}/`))
  || state.runs.some((r) => r.backup?.startsWith?.(`${OLD_STATE}/`));

const isForwarder = (file) => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('../../claude-manners/sync/sync.mjs');

function mentions(cfg, state) {
  const rules = at(cfg, 'rules');
  const own = fs.existsSync(rules) ? fs.readdirSync(rules).filter((n) => n.endsWith('.md')).map((n) => `rules/${n}`).filter((k) => !state.files[k]) : [];
  const out = [];
  for (const key of ['CLAUDE.md', 'settings.json', 'settings.local.json', ...own]) {
    let text;
    try { text = fs.readFileSync(at(cfg, key), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => { if (MENTION.test(line)) out.push(`${key}:${i + 1}`); });
  }
  return out;
}

// Every step saves the state before the next one and can be repeated, so a crash anywhere is picked up by the next command.
function moveRules(ctx) {
  const { cfg, state, runDir, note } = ctx;
  for (const key of Object.keys(state.files).filter((k) => OLD_RULE.test(k)).sort()) {
    const to = aliasRule(key);
    const mine = state.files[key];
    const known = state.files[to];
    const from = at(cfg, key);
    const dest = at(cfg, to);
    const cur = hashFile(from);
    const there = hashFile(dest);
    const intent = state.renamed.moving;
    let next = cur === null && intent?.from === key ? intent.next : known ?? mine;
    const begin = (value) => {
      next = value;
      note('rules_moved', to);
      state.renamed.moving = { from: key, next };
      save(state, cfg);
    };
    if (cur !== null && there === null) {
      begin(mine);
      journal(runDir, { ev: 'rename', from: key, to, hash: cur });
      move(from, dest);
    } else if (cur !== null) {
      const edited = cur !== there && (mine.held || cur !== mine.hash);
      const own = !known && there !== mine.hash && there !== hashBuffer(renameBytes(fs.readFileSync(from)));
      const loser = edited ? dest : from;
      begin(edited || own ? { ...next, held: true } : next);
      journal(runDir, { ev: 'rename', from: key, to, hash: cur, replaced: edited, backup: relInside(cfg, backupFile(runDir, loser, cfg)) });
      if (edited) move(from, dest);
      else removeFile(from, cfg);
    }
    state.files[to] = next;
    delete state.files[key];
    delete state.renamed.moving;
    save(state, cfg);
  }
}

function renameRuleText(ctx) {
  const { cfg, state, runDir, note } = ctx;
  for (const key of Object.keys(state.files).filter((k) => NEW_RULE.test(k)).sort()) {
    const file = at(cfg, key);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    const cur = hashBuffer(bytes);
    const tracked = state.files[key];
    if (!tracked.held && cur !== tracked.hash && hashBuffer(unrenameBytes(bytes)) === tracked.hash) {
      tracked.hash = cur;
      save(state, cfg);
      continue;
    }
    const next = renameBytes(bytes);
    if (next.equals(bytes)) continue;
    if (tracked.held || cur !== tracked.hash) {
      note('edited_text_kept', key);
      continue;
    }
    const backup = relInside(cfg, backupFile(runDir, file, cfg));
    journal(runDir, { ev: 'file', action: 'put', dest: key, existed: true, backup, hashBefore: cur, hashAfter: hashBuffer(next) });
    writeFileAtomic(file, next);
    tracked.hash = hashBuffer(next);
    save(state, cfg);
  }
}

function removeOldEngine(ctx) {
  const { cfg, state, runDir, note } = ctx;
  for (const key of Object.keys(state.files).filter((k) => OLD_ENGINE.test(k)).sort()) {
    const file = at(cfg, key);
    const cur = hashFile(file);
    if (key !== FORWARDER || !isForwarder(file)) {
      if (cur !== null && !state.files[key].held && cur === state.files[key].hash) {
        const backup = relInside(cfg, backupFile(runDir, file, cfg));
        journal(runDir, { ev: 'file', action: 'delete', dest: key, existed: true, backup, hashBefore: cur, hashAfter: null });
        removeFile(file, cfg);
      } else if (cur !== null) note('old_files_left', key);
      else removeFile(file, cfg);
    }
    delete state.files[key];
    save(state, cfg);
  }
}

function dropForwarder(cfg, self) {
  const file = at(cfg, FORWARDER);
  if (process.env.CLAUDE_SETUP_LEGACY_ENTRY === '1' || !self || !inside(at(cfg, 'tools/claude-manners'), self) || !isForwarder(file)) return false;
  removeFile(file, cfg);
  return true;
}

export function migrate(cfg, { self } = {}) {
  moveStateFolder(cfg);
  if (!fs.existsSync(stateFile(cfg))) return null;
  const state = load(cfg);
  if (state.renamed?.done) return dropForwarder(cfg, self) ? state.renamed.report : null;
  if (!state.renamed) {
    if (!fromBefore(state)) return null;
    for (const f of Object.values(state.files)) f.backup = newBackupPath(cfg, f.backup);
    for (const r of state.runs) r.backup = newBackupPath(cfg, r.backup);
    const run = newRun(state, 'rename', state.repo.commit, state.repo.commit, cfg);
    run.status = 'done';
    state.renamed = { done: false, run: run.id, report: { rules_moved: [], edited_text_kept: [], old_files_left: [], mentions: [] } };
    save(state, cfg);
  }
  const { report } = state.renamed;
  const ctx = {
    cfg, state, report,
    runDir: runDirOf(state.runs.find((r) => r.id === state.renamed.run), cfg),
    note: (list, item) => { if (!report[list].includes(item)) report[list].push(item); },
  };
  moveRules(ctx);
  renameRuleText(ctx);
  if (!fs.existsSync(at(cfg, NEW_ENGINE))) return { ...report, note: 'The setup is now called claude-manners. The sync tool is not installed under the new name yet: follow START.md in the clone, step 1.' };
  removeOldEngine(ctx);
  report.mentions = mentions(cfg, state);
  report.note = 'The setup is now called claude-manners. Its rules, sync tool, skill and state folder were moved to the new name on this PC, nothing else changed. Tell the person this, name what is in edited_text_kept, old_files_left and mentions (lines of their own that still use an old path), and ask them to start a new Claude Code session so the renamed rules and the skill claude-manners-sync load.';
  state.renamed.done = true;
  save(state, cfg);
  dropForwarder(cfg, self);
  return report;
}
