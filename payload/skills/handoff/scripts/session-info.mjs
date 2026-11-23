// Finds a Claude Code session's transcript by its session id and prints what identifies it to ListAgents:
// path, size, first and last timestamp, and its names (agent name, custom title, AI title). Read-only.
// node session-info.mjs <session-id>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const configDirs = () => {
  const home = os.homedir();
  let extra = [];
  try { extra = fs.readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('.claude-')).map((e) => path.join(home, e.name)); } catch {}
  return [path.join(home, '.claude'), ...extra];
};

const id = (process.argv[2] || '').trim();
if (!/^[0-9a-f-]{8,}$/i.test(id)) { console.log('usage: node session-info.mjs <session-id>'); process.exit(1); }
const roots = configDirs().map((d) => path.join(d, 'projects')).filter((r) => fs.existsSync(r));
const hits = new Set();
for (const root of roots) for (const dir of fs.readdirSync(root)) {
  const f = path.join(root, dir, id + '.jsonl');
  if (fs.existsSync(f)) hits.add(fs.realpathSync(f));
}
if (!hits.size) { console.log(`NOT FOUND: no transcript ${id}.jsonl under ${roots.join(' or ')}`); process.exit(2); }
for (const f of hits) {
  const st = fs.statSync(f);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  let first = null, last = null, userMsgs = 0, cwd = null;
  const names = new Set();
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.timestamp) { first ??= o.timestamp; last = o.timestamp; }
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.type === 'user' && o.message && !o.isMeta) userMsgs++;
    if (['agent-name', 'custom-title', 'ai-title'].includes(o.type)) {
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && !['type', 'sessionId', 'leafUuid'].includes(k)) names.add(`${o.type}: ${v}`);
    }
  }
  console.log(`transcript: ${f}`);
  console.log(`size: ${(st.size / 1048576).toFixed(1)} MB | records: ${lines.length} | user records: ${userMsgs}`);
  console.log(`first record: ${first || 'none'} | last record: ${last || 'none'} | file last written: ${st.mtime.toISOString()}`);
  console.log(`cwd: ${cwd || 'unknown'}`);
  console.log(`names: ${names.size ? [...names].join(' | ') : 'none (a new or unnamed session: match it in ListAgents by start time)'}`);
}
