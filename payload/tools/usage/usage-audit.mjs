#!/usr/bin/env node
// Usage audit: per-account API-equivalent cost of Claude Code transcripts in a time window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const START = Date.parse(opt('--start', new Date(Date.now() - 7 * 864e5).toISOString()));
const END = Date.parse(opt('--end', new Date().toISOString()));
const OUT = opt('--out');
const ROOT = path.join(os.homedir(), '.claude', 'projects');
let accounts = [];
try {
  const cfg = JSON.parse(fs.readFileSync(process.env.CLAUDE_USAGE_CONFIG || path.join(os.homedir(), '.claude', 'tools', 'usage-config.json'), 'utf8'));
  if (Array.isArray(cfg.accounts)) accounts = cfg.accounts;
} catch {}
const labelOfOrg = (org, none) => accounts.find((a) => a.orgPrefix && org.startsWith(a.orgPrefix))?.label ?? none;
const FOCUS = accounts[0]?.label ?? 'unknown';
const HOME_PROJECT_RE = new RegExp('^' + os.homedir().replace(/[^A-Za-z0-9]/g, '-') + '-?');

// $ per million tokens: in, out, cacheRead, write5m, write1h
const PRICE = {
  fable: [8, 40, 0.2, 10, 16],
  opus: [4, 20, 0.2, 5, 8],
  sonnet: [2, 10, 0.1, 2.5, 4],
  haiku: [0.1, 0.5, 0.01, 0.125, 0.2],
};
const fam = (m) => (/fable|mythos/.test(m) ? 'fable' : /opus/.test(m) ? 'opus' : /sonnet/.test(m) ? 'sonnet' : /haiku/.test(m) ? 'haiku' : 'other');
const costOf = (model, u) => {
  const p = PRICE[fam(model)];
  if (!p) return { inp: 0, out: 0, read: 0, write: 0, total: 0 };
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - w1h);
  const c = {
    inp: (u.input_tokens || 0) * p[0] / 1e6,
    out: (u.output_tokens || 0) * p[1] / 1e6,
    read: (u.cache_read_input_tokens || 0) * p[2] / 1e6,
    write: (w5m * p[3] + w1h * p[4]) / 1e6,
  };
  c.total = c.inp + c.out + c.read + c.write;
  return c;
};

// account by history.jsonl session ids
const histIds = (f) => {
  const s = new Set();
  try {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = /"sessionId":"([0-9a-f-]{36})"/.exec(line);
      if (m) s.add(m[1]);
    }
  } catch {}
  return s;
};
const hist = accounts.map((a) => ({ label: a.label, ids: histIds(path.join(os.homedir(), a.configDir, 'history.jsonl')) }));

const walk = (dir, out = []) => {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= START) out.push(p); } catch {}
    }
  }
  return out;
};
const files = walk(ROOT);
const SUB_RE = /^(.*)[\\/]([0-9a-f-]{36})[\\/]subagents[\\/](.+)\.jsonl$/;

const seen = new Set();
const sessions = new Map();
const calls = [];
const orgOfMain = new Map();
const firstLines = new Map();

const getSess = (id) => {
  if (!sessions.has(id)) sessions.set(id, { id, project: '', org: null, files: 0, subFiles: 0, agentTypes: {}, names: new Set() });
  return sessions.get(id);
};

for (const f of files) {
  const sm = SUB_RE.exec(f);
  const isSub = !!sm;
  const sessId = isSub ? sm[2] : path.basename(f, '.jsonl');
  const project = path.basename(isSub ? sm[1] : path.dirname(f));
  const s = getSess(sessId);
  s.project = project;
  if (isSub) s.subFiles++; else s.files++;
  let agentType = isSub ? 'sub' : 'main';
  if (isSub) {
    const meta = f.replace(/\.jsonl$/, '.meta.json');
    try { const j = JSON.parse(fs.readFileSync(meta, 'utf8')); agentType = j.agentType || j.subagent_type || j.type || 'sub'; } catch {}
  }
  const rl = readline.createInterface({ input: fs.createReadStream(f, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (line.includes('credential_org')) {
      try {
        const j = JSON.parse(line);
        if (j.attachment?.organizationUuid && !isSub) {
          s.org = j.attachment.organizationUuid;
          (s.orgEvents ||= []).push({ ts: Date.parse(j.timestamp) || 0, org: j.attachment.organizationUuid });
        }
      } catch {}
    }
    if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message?.usage) continue;
    const ts = Date.parse(j.timestamp);
    if (!(ts >= START && ts <= END)) continue;
    const key = (j.requestId || '') + '|' + (j.message.id || j.uuid);
    if (seen.has(key)) continue;
    seen.add(key);
    const u = j.message.usage;
    const model = j.message.model || j.requestedModel || '?';
    if (model === '<synthetic>') continue;
    const its = Array.isArray(u.iterations) ? u.iterations : [];
    const adv = its.filter((x) => x.type === 'advisor_message');
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    let maxIterCtx = 0;
    for (const it of its) if (it.type === 'message') maxIterCtx = Math.max(maxIterCtx, (it.input_tokens || 0) + (it.cache_read_input_tokens || 0) + (it.cache_creation_input_tokens || 0));
    const c = costOf(model, u);
    const advCalls = adv.map((a) => ({ model: a.model || 'fable', u: a, cost: costOf(a.model || 'fable', a) }));
    calls.push({
      sess: sessId, file: path.basename(f), isSub, agentType, ts, model, effort: j.effort || '',
      inp: u.input_tokens || 0, read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0,
      w1h: u.cache_creation?.ephemeral_1h_input_tokens || 0, out: u.output_tokens || 0, think: u.output_tokens_details?.thinking_tokens || 0,
      ctx: maxIterCtx || ctx, iters: its.filter((x) => x.type === 'message').length || 1,
      cost: c, adv: advCalls, speed: u.speed || '', cacheTtl: j.promptCacheRequested || '',
    });
  }
}

// account resolution
for (const s of sessions.values()) {
  const h = hist.find((x) => x.ids.has(s.id));
  s.account = s.org ? labelOfOrg(s.org, 'other')
    : h ? h.label + '?' : 'unknown';
  if (s.orgEvents) s.orgEvents.sort((a, b) => a.ts - b.ts);
}
const acctOfOrg = (o) => labelOfOrg(o, 'other');
for (const c of calls) {
  const s = sessions.get(c.sess);
  if (!s.orgEvents?.length) { c.acct = s.account; continue; }
  let o = s.orgEvents[0].org;
  for (const e of s.orgEvents) if (e.ts <= c.ts) o = e.org;
  c.acct = acctOfOrg(o);
}

const r2 = (x) => Math.round(x * 100) / 100;
const agg = () => ({ calls: 0, inp: 0, read: 0, write: 0, out: 0, think: 0, cost: 0, costInp: 0, costOut: 0, costRead: 0, costWrite: 0, advCalls: 0, advInp: 0, advOut: 0, advCost: 0 });
const add = (a, c) => {
  a.calls++; a.inp += c.inp; a.read += c.read; a.write += c.write; a.out += c.out; a.think += c.think;
  a.cost += c.cost.total; a.costInp += c.cost.inp; a.costOut += c.cost.out; a.costRead += c.cost.read; a.costWrite += c.cost.write;
  for (const v of c.adv) { a.advCalls++; a.advInp += (v.u.input_tokens || 0) + (v.u.cache_read_input_tokens || 0) + (v.u.cache_creation_input_tokens || 0); a.advOut += v.u.output_tokens || 0; a.advCost += v.cost.total; }
};

const byAcct = {};
const bySess = {};
const byHour = {};
const byModel = {};
const byScopeModel = {};
const byAgentType = {};
const ctxBuckets = {};
const bigWrites = [];
for (const c of calls) {
  const s = sessions.get(c.sess);
  const acct = c.acct;
  (byAcct[acct] ||= agg()); add(byAcct[acct], c);
  if (!acct.startsWith(FOCUS)) continue;
  (bySess[c.sess] ||= { main: agg(), sub: agg() }); add(bySess[c.sess][c.isSub ? 'sub' : 'main'], c);
  const hr = new Date(c.ts + 4 * 3600e3).toISOString().slice(5, 13).replace('T', ' ') + ':00';
  (byHour[hr] ||= agg()); add(byHour[hr], c);
  const mk = fam(c.model) + (c.effort ? '/' + c.effort : '');
  (byModel[mk] ||= agg()); add(byModel[mk], c);
  const sk = (c.isSub ? 'sub' : 'main') + ':' + fam(c.model);
  (byScopeModel[sk] ||= agg()); add(byScopeModel[sk], c);
  (byAgentType[c.agentType] ||= agg()); add(byAgentType[c.agentType], c);
  if (!c.isSub) {
    const b = c.ctx < 100e3 ? '<100k' : c.ctx < 200e3 ? '100-200k' : c.ctx < 300e3 ? '200-300k' : c.ctx < 400e3 ? '300-400k' : c.ctx < 600e3 ? '400-600k' : '600k+';
    (ctxBuckets[b] ||= agg()); add(ctxBuckets[b], c);
  }
  if (c.write >= 50e3) bigWrites.push({ sess: c.sess.slice(0, 8), isSub: c.isSub, ts: new Date(c.ts + 4 * 3600e3).toISOString().slice(11, 19), model: fam(c.model), write: c.write, w1h: c.w1h, read: c.read, cost: r2(c.cost.write) });
}

const fmtA = (a) => ({ calls: a.calls, inM: r2(a.inp / 1e6), readM: r2(a.read / 1e6), writeM: r2(a.write / 1e6), outM: r2(a.out / 1e6), thinkM: r2(a.think / 1e6), cost: r2(a.cost), costIn: r2(a.costInp), costRead: r2(a.costRead), costWrite: r2(a.costWrite), costOut: r2(a.costOut), adv: a.advCalls, advInM: r2(a.advInp / 1e6), advOutM: r2(a.advOut / 1e6), advCost: r2(a.advCost), totalWithAdv: r2(a.cost + a.advCost) });

const sessRows = Object.entries(bySess).map(([id, v]) => {
  const s = sessions.get(id);
  const ts = calls.filter((c) => c.sess === id && c.acct.startsWith(FOCUS)).map((c) => c.ts);
  const advMain = v.main.advCalls, advSub = v.sub.advCalls;
  return {
    id, acct: s.account, project: s.project.replace(HOME_PROJECT_RE, '~/'), subFiles: s.subFiles,
    from: new Date(Math.min(...ts) + 4 * 3600e3).toISOString().slice(5, 16).replace('T', ' '),
    to: new Date(Math.max(...ts) + 4 * 3600e3).toISOString().slice(5, 16).replace('T', ' '),
    mainCalls: v.main.calls, subCalls: v.sub.calls, mainCost: r2(v.main.cost), subCost: r2(v.sub.cost),
    advCalls: advMain + advSub, advCost: r2(v.main.advCost + v.sub.advCost),
    total: r2(v.main.cost + v.sub.cost + v.main.advCost + v.sub.advCost),
    maxCtx: Math.max(0, ...calls.filter((c) => c.sess === id && !c.isSub && c.acct.startsWith(FOCUS)).map((c) => c.ctx)),
  };
}).sort((a, b) => b.total - a.total);

const advList = calls.filter((c) => c.adv.length && c.acct === FOCUS).flatMap((c) => c.adv.map((a) => ({
  sess: c.sess.slice(0, 8), isSub: c.isSub, ts: new Date(c.ts + 4 * 3600e3).toISOString().slice(5, 16).replace('T', ' '),
  inK: Math.round(((a.u.input_tokens || 0) + (a.u.cache_read_input_tokens || 0)) / 1e3), cachedK: Math.round((a.u.cache_read_input_tokens || 0) / 1e3), outK: Math.round((a.u.output_tokens || 0) / 1e3), cost: r2(a.cost.total),
})));

const result = {
  window: { start: new Date(START).toISOString(), end: new Date(END).toISOString() },
  files: files.length, sessions: sessions.size,
  accounts: Object.fromEntries(Object.entries(byAcct).map(([k, v]) => [k, fmtA(v)])),
  personal: {
    byScopeModel: Object.fromEntries(Object.entries(byScopeModel).map(([k, v]) => [k, fmtA(v)])),
    byModelEffort: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, fmtA(v)])),
    byAgentType: Object.fromEntries(Object.entries(byAgentType).map(([k, v]) => [k, fmtA(v)])),
    byHourLocal: Object.fromEntries(Object.entries(byHour).sort().map(([k, v]) => [k, fmtA(v)])),
    mainCtxBuckets: Object.fromEntries(Object.entries(ctxBuckets).map(([k, v]) => [k, fmtA(v)])),
    sessions: sessRows,
    advisorCalls: advList,
    bigCacheWrites: bigWrites.sort((a, b) => b.write - a.write).slice(0, 40),
    bigWriteCount: bigWrites.length, bigWriteCost: r2(bigWrites.reduce((x, y) => x + y.cost, 0)),
  },
  unknownSessions: [...sessions.values()].filter((s) => s.account === 'unknown').map((s) => s.id + ' ' + s.project),
};
const txt = JSON.stringify(result, null, 1);
if (OUT) fs.writeFileSync(OUT, txt);
console.log(txt);
