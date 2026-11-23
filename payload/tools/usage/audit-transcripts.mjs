#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = 'usage: node audit-transcripts.mjs --since YYYY-MM-DD --until YYYY-MM-DD [--out <file.json>] [--root <projects dir>]';
const parseDay = (s, plusDays) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) {
    console.error(usage);
    process.exit(2);
  }
  return new Date(+m[1], +m[2] - 1, +m[3] + plusDays).getTime();
};
const sinceMs = parseDay(opt('--since'), 0);
const untilMs = parseDay(opt('--until'), 1);
const outFile = opt('--out');
const root = opt('--root') || path.join(os.homedir(), '.claude', 'projects');
if (untilMs <= sinceMs) {
  console.error(usage);
  process.exit(2);
}

let accounts = [];
try {
  const cfg = JSON.parse(fs.readFileSync(process.env.CLAUDE_USAGE_CONFIG || path.join(os.homedir(), '.claude', 'tools', 'usage-config.json'), 'utf8'));
  if (Array.isArray(cfg.accounts)) accounts = cfg.accounts;
} catch {}
const labelOfOrg = (org, none) => accounts.find((a) => a.orgPrefix && org.startsWith(a.orgPrefix))?.label ?? none;

const THRESHOLDS = [200e3, 400e3, 600e3, 800e3];
const ACCOUNTS = [...accounts.map((a) => a.label), 'unknown'];
const SCOPES = ['main', 'sub'];
const WALL_MAX_MS = 600000;

const accountOf = (org) => labelOfOrg(org, 'unknown');

const newAgg = () => ({
  sessions: 0,
  calls: 0,
  zeroCtxCalls: 0,
  ctx: [],
  firstCtx: [],
  tokIn: 0,
  tokCacheCreate: 0,
  tokCacheRead: 0,
  tokOut: 0,
  over: THRESHOLDS.map(() => ({ calls: 0, tokens: 0 })),
  tools: {},
  errCats: {},
  pyUnicode: 0,
  heredoc: 0,
  planRejections: 0,
  interrupts: 0,
  prompts: 0,
  images: 0,
  hookWall: [],
  hookWallExcluded: 0,
  hooks: {},
});

const mergeCounts = (dst, src) => {
  for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] || 0) + v;
};
const pushAll = (dst, src) => {
  for (const v of src) dst.push(v);
};

const merge = (d, s) => {
  d.sessions += s.sessions;
  d.calls += s.calls;
  d.zeroCtxCalls += s.zeroCtxCalls;
  pushAll(d.ctx, s.ctx);
  pushAll(d.firstCtx, s.firstCtx);
  d.tokIn += s.tokIn;
  d.tokCacheCreate += s.tokCacheCreate;
  d.tokCacheRead += s.tokCacheRead;
  d.tokOut += s.tokOut;
  s.over.forEach((o, i) => {
    d.over[i].calls += o.calls;
    d.over[i].tokens += o.tokens;
  });
  for (const [name, t] of Object.entries(s.tools)) {
    const e = (d.tools[name] ||= { calls: 0, errors: 0 });
    e.calls += t.calls;
    e.errors += t.errors;
  }
  mergeCounts(d.errCats, s.errCats);
  d.pyUnicode += s.pyUnicode;
  d.heredoc += s.heredoc;
  d.planRejections += s.planRejections;
  d.interrupts += s.interrupts;
  d.prompts += s.prompts;
  d.images += s.images;
  pushAll(d.hookWall, s.hookWall);
  d.hookWallExcluded += s.hookWallExcluded;
  for (const [k, v] of Object.entries(s.hooks)) pushAll((d.hooks[k] ||= []), v);
};

const sortNum = (a) => [...a].sort((x, y) => x - y);
const pctOfSorted = (s, q) => {
  if (!s.length) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
};
const dist = (arr) => {
  const s = sortNum(arr);
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, median: pctOfSorted(s, 0.5), p25: pctOfSorted(s, 0.25), p75: pctOfSorted(s, 0.75), p90: pctOfSorted(s, 0.9), mean: s.length ? Math.round(sum / s.length) : 0, sum };
};

const walk = (dir, out) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
};

const SUB_RE = /^(.*)[\\/]([^\\/]+)[\\/]subagents[\\/]/;
const isSubPath = (p) => SUB_RE.test(p);
const parentOf = (p) => {
  const m = SUB_RE.exec(p);
  return m ? path.join(m[1], m[2] + '.jsonl') : null;
};

async function* lineIter(p) {
  let rest = '';
  for await (const chunk of fs.createReadStream(p, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop();
    for (const l of parts) yield l.endsWith('\r') ? l.slice(0, -1) : l;
  }
  if (rest) yield rest;
}

const findOrg = async (p) => {
  let org = null;
  for await (const line of lineIter(p)) {
    if (!line.includes('credential_org')) continue;
    try {
      const j = JSON.parse(line);
      if (j.attachment?.type === 'credential_org' && j.attachment.organizationUuid) {
        org = j.attachment.organizationUuid;
        break;
      }
    } catch {}
  }
  return org;
};

const blockText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n') : '');
const NOT_PROMPT_RE = /^<(command|local-command|system-reminder|task-notification|bash-)/;
const PY_RE = /UnicodeEncodeError|UnicodeDecodeError|charmap/;
const DASH_RE = new RegExp('['+String.fromCharCode(0x2013)+String.fromCharCode(0x2014)+']','g');
const dash = (s) => s.replace(DASH_RE, '-');
const normPath = (s) => dash(s).replace(/[A-Za-z]:[\\/][^\s'"]+|\/[\w./-]+/g, '<path>').replace(/\d+/g, 'N');
const normHook = (s) =>
  dash(String(s || '?'))
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '<plugin>')
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/]+/gi, '~')
    .replace(/\s+/g, ' ')
    .slice(0, 110);

const state = {
  seenCalls: new Set(),
  crossFileDupes: 0,
  filesScanned: 0,
  filesSkippedMtime: 0,
  badLines: 0,
};

const processFile = async (p, scope, getOrg) => {
  const a = newAgg();
  const idName = Object.create(null);
  const seenToolUse = new Set();
  const seenLocal = new Set();
  let org = null;
  let firstCallSeen = false;
  let lastAssistantTs = null;
  let hasCallInRange = false;

  for await (const line of lineIter(p)) {
    const isSummary = line.includes('"subtype":"stop_hook_summary"');
    const isAsst = line.includes('"type":"assistant"');
    const isUser = line.includes('"type":"user"');
    const isCred = org === null && line.includes('credential_org');
    if (!(isSummary || isAsst || isUser || isCred)) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      state.badLines++;
      continue;
    }
    if (isCred && j.attachment?.type === 'credential_org' && j.attachment.organizationUuid) org = j.attachment.organizationUuid;
    const ts = j.timestamp ? Date.parse(j.timestamp) : NaN;
    const inRange = ts >= sinceMs && ts < untilMs;

    if (j.type === 'system' && j.subtype === 'stop_hook_summary') {
      if (inRange) {
        if (lastAssistantTs !== null) {
          const wall = ts - lastAssistantTs;
          if (wall >= 0 && wall < WALL_MAX_MS) a.hookWall.push(wall);
          else a.hookWallExcluded++;
        }
        for (const h of j.hookInfos || []) {
          const d = h.durationMs;
          if (typeof d === 'number') (a.hooks[normHook(h.command || h.name)] ||= []).push(d);
        }
      }
      continue;
    }

    if (j.type === 'assistant' && j.message) {
      if (!Number.isNaN(ts)) lastAssistantTs = ts;
      const m = j.message;
      const u = m.usage;
      if (u) {
        const key = (m.id || '') + '|' + (j.requestId || '');
        const first = !firstCallSeen;
        const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        if (key === '|') {
          firstCallSeen = true;
        } else if (seenLocal.has(key)) {
          firstCallSeen = true;
        } else if (state.seenCalls.has(key)) {
          seenLocal.add(key);
          firstCallSeen = true;
          state.crossFileDupes++;
        } else {
          state.seenCalls.add(key);
          seenLocal.add(key);
          firstCallSeen = true;
          if (inRange) {
            hasCallInRange = true;
            a.calls++;
            a.tokIn += u.input_tokens || 0;
            a.tokCacheCreate += u.cache_creation_input_tokens || 0;
            a.tokCacheRead += u.cache_read_input_tokens || 0;
            a.tokOut += u.output_tokens || 0;
            if (ctx === 0) a.zeroCtxCalls++;
            else {
              a.ctx.push(ctx);
              THRESHOLDS.forEach((t, i) => {
                if (ctx > t) {
                  a.over[i].calls++;
                  a.over[i].tokens += ctx;
                }
              });
            }
          }
          if (first && scope === 'main' && inRange && ctx > 0) a.firstCtx.push(ctx);
        }
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type !== 'tool_use') continue;
        idName[b.id] = b.name;
        if (inRange && !seenToolUse.has(b.id)) {
          seenToolUse.add(b.id);
          (a.tools[b.name] ||= { calls: 0, errors: 0 }).calls++;
        }
      }
      continue;
    }

    if (j.type === 'user' && j.message) {
      if (!inRange) continue;
      const c = j.message.content;
      const blocks = Array.isArray(c) ? c : [];
      const hasResult = blocks.some((b) => b?.type === 'tool_result');
      if (hasResult) {
        for (const b of blocks) {
          if (b?.type !== 'tool_result') continue;
          if (Array.isArray(b.content)) for (const x of b.content) if (x?.type === 'image') a.images++;
          if (!b.is_error) continue;
          const name = idName[b.tool_use_id] || '?';
          (a.tools[name] ||= { calls: 0, errors: 0 }).errors++;
          const text = blockText(b.content);
          if (name === 'ExitPlanMode' && /doesn['’]t want to proceed/.test(text)) a.planRejections++;
          if (PY_RE.test(text)) a.pyUnicode++;
          if (text.includes('unexpected EOF')) a.heredoc++;
          const first = text.replace(/<[^>]+>/g, '').split('\n').map((s) => s.trim()).find((s) => s) || '(empty)';
          const cat = name + ' | ' + normPath(first).slice(0, 90);
          a.errCats[cat] = (a.errCats[cat] || 0) + 1;
        }
      }
      const txt = typeof c === 'string' ? c : blocks.filter((b) => b?.type === 'text').map((b) => b.text || '').join(' ');
      if (txt.includes('[Request interrupted by user')) {
        a.interrupts++;
      } else if (!hasResult && !j.isMeta && !j.isCompactSummary && txt.trim() && !NOT_PROMPT_RE.test(txt.trim())) {
        a.prompts++;
      }
    }
  }

  if (hasCallInRange) a.sessions = 1;
  return { a, org };
};

const t0 = Date.now();
const all = [];
walk(root, all);
all.sort();
const mains = all.filter((p) => !isSubPath(p));
const subs = all.filter(isSubPath);

const result = {};
for (const acct of ACCOUNTS) {
  result[acct] = {};
  for (const sc of SCOPES) result[acct][sc] = newAgg();
}
const orgByMain = new Map();
let unknownAccountSessions = 0;

const mtimeOk = (p) => {
  try {
    return fs.statSync(p).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
};

for (const p of mains) {
  if (!mtimeOk(p)) {
    state.filesSkippedMtime++;
    continue;
  }
  state.filesScanned++;
  const { a, org } = await processFile(p, 'main');
  orgByMain.set(p, org);
  const acct = org ? accountOf(org) : 'unknown';
  if (acct === 'unknown' && a.sessions) unknownAccountSessions++;
  merge(result[acct].main, a);
}

const parentAcct = async (parent) => {
  if (!parent) return 'unknown';
  if (!orgByMain.has(parent)) {
    let org = null;
    if (fs.existsSync(parent)) org = await findOrg(parent);
    orgByMain.set(parent, org);
  }
  const org = orgByMain.get(parent);
  return org ? accountOf(org) : 'unknown';
};

for (const p of subs) {
  if (!mtimeOk(p)) {
    state.filesSkippedMtime++;
    continue;
  }
  state.filesScanned++;
  const acct = await parentAcct(parentOf(p));
  const { a } = await processFile(p, 'sub');
  merge(result[acct].sub, a);
}

const finalize = (g) => {
  const ctxD = dist(g.ctx);
  const nCtxCalls = g.ctx.length;
  const toolNames = Object.keys(g.tools).sort();
  const tools = {};
  let toolCalls = 0;
  let toolErrors = 0;
  for (const n of toolNames) {
    const t = g.tools[n];
    toolCalls += t.calls;
    toolErrors += t.errors;
    tools[n] = { calls: t.calls, errors: t.errors, errorRate: t.calls ? +(t.errors / t.calls).toFixed(4) : null };
  }
  const topErrorCategories = Object.entries(g.errCats)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));
  const hooks = {};
  for (const k of Object.keys(g.hooks).sort()) {
    const d = dist(g.hooks[k]);
    hooks[k] = { n: d.n, medianMs: d.median, p90Ms: d.p90 };
  }
  const wall = dist(g.hookWall);
  return {
    sessions: g.sessions,
    calls: g.calls,
    zeroContextCalls: g.zeroCtxCalls,
    firstCallContext: (() => {
      const d = dist(g.firstCtx);
      return { n: d.n, median: d.median, p25: d.p25, p75: d.p75 };
    })(),
    contextPerCall: { n: ctxD.n, median: ctxD.median, mean: ctxD.mean, sum: ctxD.sum },
    tokens: { input: g.tokIn, cacheCreation: g.tokCacheCreate, cacheRead: g.tokCacheRead, output: g.tokOut },
    aboveThreshold: THRESHOLDS.map((t, i) => ({
      threshold: t,
      calls: g.over[i].calls,
      shareOfCalls: nCtxCalls ? +(g.over[i].calls / nCtxCalls).toFixed(4) : 0,
      contextTokens: g.over[i].tokens,
      shareOfContextTokens: ctxD.sum ? +(g.over[i].tokens / ctxD.sum).toFixed(4) : 0,
    })),
    tools,
    toolCallsTotal: toolCalls,
    toolErrorsTotal: toolErrors,
    topErrorCategories,
    counters: { pythonUnicode: g.pyUnicode, heredocUnexpectedEOF: g.heredoc },
    planRejections: g.planRejections,
    interrupts: g.interrupts,
    userPrompts: g.prompts,
    hookWaitPerTurn: { n: wall.n, medianMs: wall.median, p90Ms: wall.p90, excludedOutOfRange: g.hookWallExcluded },
    perHook: hooks,
    imageToolResults: g.images,
  };
};

const report = {
  meta: {
    since: opt('--since'),
    until: opt('--until'),
    rangeLocalStartMs: sinceMs,
    rangeLocalEndExclusiveMs: untilMs,
    root,
    filesScanned: state.filesScanned,
    filesSkippedByMtime: state.filesSkippedMtime,
    crossFileDuplicateCallsDropped: state.crossFileDupes,
    unparsableLines: state.badLines,
    unknownAccountMainSessions: unknownAccountSessions,
  },
  accounts: {},
};
for (const acct of ACCOUNTS) {
  report.accounts[acct] = {};
  for (const sc of SCOPES) report.accounts[acct][sc] = finalize(result[acct][sc]);
}

if (outFile) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
}

const k = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
const pc = (x) => (x * 100).toFixed(1) + '%';
const lines = [];
lines.push(`range ${opt('--since')} .. ${opt('--until')} (local days, inclusive) | files scanned ${state.filesScanned}, skipped by mtime ${state.filesSkippedMtime}, cross-file dup calls ${state.crossFileDupes}`);
for (const acct of ACCOUNTS) {
  for (const sc of SCOPES) {
    const r = report.accounts[acct][sc];
    if (!r.calls && !r.sessions && !r.userPrompts && !r.toolCallsTotal) continue;
    const tag = `[${acct}/${sc}]`.padEnd(18);
    lines.push(`${tag}sessions ${r.sessions}  calls ${r.calls}  ctx median ${k(r.contextPerCall.median)} mean ${k(r.contextPerCall.mean)} sum ${k(r.contextPerCall.sum)}  out ${k(r.tokens.output)}`);
    if (sc === 'main') lines.push(`${''.padEnd(18)}first-call ctx n=${r.firstCallContext.n} median ${k(r.firstCallContext.median)} p25 ${k(r.firstCallContext.p25)} p75 ${k(r.firstCallContext.p75)}`);
    lines.push(`${''.padEnd(18)}above ` + r.aboveThreshold.map((o) => `${o.threshold / 1000}k: ${pc(o.shareOfCalls)} calls/${pc(o.shareOfContextTokens)} tok`).join('  |  '));
    lines.push(`${''.padEnd(18)}tool calls ${r.toolCallsTotal}  errors ${r.toolErrorsTotal} (${r.toolCallsTotal ? pc(r.toolErrorsTotal / r.toolCallsTotal) : '0%'})  planRej ${r.planRejections}  interrupts ${r.interrupts}  prompts ${r.userPrompts}  images ${r.imageToolResults}  pyUnicode ${r.counters.pythonUnicode}  heredoc ${r.counters.heredocUnexpectedEOF}`);
    if (r.hookWaitPerTurn.n) lines.push(`${''.padEnd(18)}hook wait/turn n=${r.hookWaitPerTurn.n} median ${r.hookWaitPerTurn.medianMs}ms p90 ${r.hookWaitPerTurn.p90Ms}ms`);
  }
}
if (unknownAccountSessions) lines.push(`note: ${unknownAccountSessions} main session(s) with in-range calls had no credential_org line (account unknown)`);
lines.push(`runtime ${((Date.now() - t0) / 1000).toFixed(1)}s` + (outFile ? `  -> ${outFile}` : ''));
console.log(lines.join('\n'));
