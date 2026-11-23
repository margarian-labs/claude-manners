// Extracts, in order and verbatim, every message the user typed in a session (including messages sent while Claude
// was working) and every answer they gave (AskUserQuestion answers, plan approvals or rejections), from the session's
// transcript. Skips system reminders, task notifications, hook output and messages from sub-agents. Read-only on the
// transcript; writes one markdown file.
// node extract-user-messages.mjs --session <session-id> --out <file.md>
// node extract-user-messages.mjs --transcript <path.jsonl> --out <file.md>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const configDirs = () => {
  const home = os.homedir();
  let extra = [];
  try { extra = fs.readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('.claude-')).map((e) => path.join(home, e.name)); } catch {}
  return [path.join(home, '.claude'), ...extra];
};

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const out = arg('--out');
let src = arg('--transcript');
const sid = arg('--session');
if (!src && sid) {
  for (const root of configDirs().map((d) => path.join(d, 'projects'))) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) { const f = path.join(root, d, sid + '.jsonl'); if (fs.existsSync(f)) { src = f; break; } }
    if (src) break;
  }
}
if (!src || !out || !fs.existsSync(src)) { console.log('usage: --session <id> | --transcript <path>, and --out <file.md> (transcript not found)'); process.exit(1); }

const strip = (s) => s.replace(/<system-reminder>[^]*?<\/system-reminder>/g, '').replace(/<task-notification>[^]*?<\/task-notification>/g, '').trim();
const ANSWER_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const isAnswer = (t) => /^\s*(your questions? ha(ve|s) been answered|(the )?user (has |have )?(answered|approved|rejected|declined|denied)|(the )?user (doesn.t|does not|didn.t|did not) want to proceed)/i.test(t);
const cleanAnswer = (t) => {
  t = t.replace(/\s*(Read the answers carefully|You can now continue with)[\s\S]*$/, '').trim();
  if (/^(the )?user (doesn.t|does not|didn.t|did not) want to proceed/i.test(t)) {
    const m = t.match(/the user said:\s*([\s\S]*?)\s*(\n\s*Note: The user.s next message[\s\S]*)?$/i);
    return m && m[1] ? `REJECTED, the user said: ${m[1]}` : 'REJECTED (no reason given; see the next message)';
  }
  if (/^(the )?user (has )?approved/i.test(t) && t.includes('## Approved Plan:')) {
    const file = (t.match(/saved to: (\S+)/) || [])[1];
    return `PLAN APPROVED${file ? ` (plan file: ${file})` : ''}`;
  }
  return t;
};
const skipText = (t) => !t || /^(Caveat:|<local-command|\[Request interrupted|This session is being continued|<agent-message|<cross-session-message|<task-notification>|\[SYSTEM NOTIFICATION)/.test(t);
const seen = new Set();
const rows = [];
const toolNames = new Map();
const count = { message: 0, answer: 0, asked: 0, askedGot: 0 };
const missed = [];
const add = (ts, kind, text, id) => {
  const key = id ? 'id|' + id : kind + '|' + text.slice(0, 300);
  if (seen.has(key)) return false;
  seen.add(key);
  count[kind.startsWith('answer') ? 'answer' : 'message']++;
  rows.push(`### ${(ts || '').replace('T', ' ').slice(0, 16)} UTC (${kind})\n${text}\n`);
  return true;
};

for (const l of fs.readFileSync(src, 'utf8').split('\n')) {
  if (!l) continue;
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'attachment' && o.attachment?.type === 'queued_command') {
    const p = String(o.attachment.prompt || '').trim();
    if (!skipText(p)) add(o.timestamp, 'message sent while Claude worked', p);
    continue;
  }
  if (o.type === 'assistant' && !o.isSidechain && Array.isArray(o.message?.content)) {
    for (const p of o.message.content) {
      if (p.type !== 'tool_use' || toolNames.has(p.id)) continue;
      toolNames.set(p.id, p.name);
      if (ANSWER_TOOLS.has(p.name)) count.asked++;
    }
    continue;
  }
  if (o.type !== 'user' || !o.message || o.isMeta || o.isCompactSummary || o.isSidechain) continue;
  const c = o.message.content;
  const parts = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  for (const p of parts) {
    if (p.type === 'text') { const t = strip(p.text || ''); if (!skipText(t)) add(o.timestamp, 'message', t); }
    else if (p.type === 'tool_result') {
      const raw = (typeof p.content === 'string' ? p.content : Array.isArray(p.content) ? p.content.map((x) => x.text || '').join('\n') : '').trim();
      const name = toolNames.get(p.tool_use_id);
      const asked = ANSWER_TOOLS.has(name);
      if (isAnswer(raw) ? (asked || p.is_error || !name) : (asked && !p.is_error)) {
        if (add(o.timestamp, asked || !name ? 'answer' : `answer: ${name} call rejected`, cleanAnswer(raw), p.tool_use_id) && asked) count.askedGot++;
      } else if (asked) missed.push(raw.slice(0, 80));
    }
  }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, (`# Every user message and answer, in order\nSession transcript: ${src}\nThe user's own words, verbatim, extracted by ~/.claude/skills/handoff/scripts/extract-user-messages.mjs. Times are UTC. Claude Code's wrapper text around answers is removed; a plan approval with Claude Code's standard heading shows only the plan file path, any other approval keeps its full text; long dashes are written as hyphens. Not included: messages from sub-agents or other sessions, system and hook text.\n\n` + rows.join('\n')).replace(/[\u2013\u2014]/g, '-'));
const gap = count.asked - count.askedGot;
console.log(`rows ${rows.length} (messages ${count.message}, answers ${count.answer}) -> ${out}`);
console.log(`check: ${count.asked} questions and plans asked, ${count.askedGot} results extracted${gap ? ` - ${gap} MISSING (no result yet, or new wording): ${missed.join(' | ') || 'no result in the transcript'}` : ' - ok'}`);
