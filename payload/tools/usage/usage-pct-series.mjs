#!/usr/bin/env node
// Extract weekly-% observations ("Weekly stop point: X% (now N%)") from transcripts, with account and timestamp.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

let accounts = [];
try {
  const cfg = JSON.parse(fs.readFileSync(process.env.CLAUDE_USAGE_CONFIG || path.join(os.homedir(), '.claude', 'tools', 'usage-config.json'), 'utf8'));
  if (Array.isArray(cfg.accounts)) accounts = cfg.accounts;
} catch {}
const labelOfOrg = (org, none) => accounts.find((a) => a.orgPrefix && org.startsWith(a.orgPrefix))?.label ?? none;
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const SINCE = Date.parse('2026-11-12T13:00:00Z');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents') walk(p, out); }
    else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= SINCE) out.push(p);
  }
  return out;
};
const localIso = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString();
const obs = new Map();
for (const f of walk(ROOT)) {
  let org = null;
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(f, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.includes('credential_org')) { const m = /"organizationUuid":"([0-9a-f]{8})/.exec(line); if (m) org = m[1]; }
    if (!line.includes('(now ')) continue;
    if (!/Weekly stop point|No stop point|Away mode/.test(line)) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'assistant') continue;
    const s = JSON.stringify(j.attachment ?? j.message ?? j);
    const re = /\(now (\d+)%\)/g; let m;
    if (j.timestamp) while ((m = re.exec(s))) rows.push({ ts: j.timestamp, pct: +m[1] });
  }
  const acct = org ? labelOfOrg(org, 'unknown') : 'unknown';
  for (const r of rows) obs.set(acct + '|' + r.ts + '|' + r.pct, { acct, ts: r.ts, pct: r.pct, sess: path.basename(f).slice(0, 8) });
}
const list = [...obs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
for (const o of list) console.log(o.acct.padEnd(8), localIso(Date.parse(o.ts)).slice(0, 16).replace('T', ' '), String(o.pct).padStart(3) + '%', o.sess);
