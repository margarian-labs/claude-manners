const fs = require('fs');
const os = require('os');
const path = require('path');
const { liveState, weekly, timerNote } = require('./away-mode.js');

const TAIL = 2 * 1024 * 1024;
const LIMIT = /^\s*\[?\s*usage limit reached/i;
const RELEASE = /usage-limit notes no longer apply/i;
const NUDGE = 'Usage limit reached and no wake-up timer is running. If work is left, start the timer now, before anything else: Bash tool, run_in_background true, command: node "$HOME/.claude/tools/away-wait.mjs" , description: "Wake-up timer: the usage limit has reset, continue the unfinished task". Do not stop that task. Then say in a line or two what is left and end the turn; its completion notification wakes you after the reset. If nothing is left to do, start no timer and just end the turn.';
const REASON ='Away mode: the usage limit was reached and no wake-up timer is running. Start it now, before anything else: Bash tool, run_in_background true, command: node "$HOME/.claude/tools/away-wait.mjs" , description: "Away wake-up timer: the usage limit has reset, continue the away task from progress.md". Never stop that task. Then end the turn; its completion notification wakes you to continue from progress.md.';

const isTimer = (cmd) => typeof cmd === 'string' && cmd.includes('away-wait') && !cmd.includes('--dry-run');
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n') : '');

function tail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

function pending(file, countTimers, strict) {
  let open = false;
  let cli = false;
  const timerIds = new Set();
  const finished = (text) => {
    if (!/^\s*<task-notification>/.test(text) || !/<status>completed<\/status>/.test(text)) return false;
    const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text);
    return (id && timerIds.has(id[1].trim())) || !!timerNote(text);
  };
  for (const line of tail(file).split('\n')) {
    if (!line.includes('isMeta') && !line.includes('away-wait') && !line.includes('task-notification') && !line.includes('"kind":"human"')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || r.isSidechain) continue;
    if (r.type === 'attachment' && r.attachment && r.attachment.type === 'queued_command') {
      if (finished(textOf(r.attachment.prompt))) open = false;
      continue;
    }
    if (!r.message) continue;
    const c = r.message.content;
    if (r.type === 'user' && r.isMeta === true) {
      const text = textOf(c);
      if (r.usageLimitNote === 'wrap_up' || (!r.usageLimitNote && LIMIT.test(text))) {
        open = true;
        cli = r.entrypoint === 'cli';
      } else if (r.usageLimitNote === 'release' || RELEASE.test(text)) open = false;
    } else if (r.type === 'user') {
      if (finished(textOf(c)) || (strict && r.origin && r.origin.kind === 'human')) open = false;
    } else if (r.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (!b || b.type !== 'tool_use' || !b.input || !isTimer(b.input.command)) continue;
        if (b.id) timerIds.add(String(b.id));
        if (countTimers) open = false;
      }
    }
  }
  return { open, cli };
}

function run(raw) {
  const i = JSON.parse(raw);
  if (i.stop_hook_active || i.agent_id || !i.transcript_path) return;
  const state = liveState(i.session_id || process.env.CLAUDE_CODE_SESSION_ID);
  if (state && state.stopped) return;
  if (state && state.cap) {
    const w = weekly();
    if (w && w.pct >= state.cap) return;
  }
  const bg = Array.isArray(i.background_tasks) ? i.background_tasks : null;
  if (bg && bg.some((t) => t && (isTimer(t.command) || /^(?:away )?wake-up timer:/i.test(String(t.description || ''))))) return;
  let file = String(i.transcript_path);
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  const p = pending(file, !bg, !state);
  if (!p.open) return;
  if (state) process.stdout.write(JSON.stringify({ decision: 'block', reason: REASON }) + '\n');
  else if (p.cli) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: NUDGE } }) + '\n');
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  try { run(data); } catch {}
});
