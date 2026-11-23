const fs = require('fs');
const os = require('os');
const path = require('path');

const MB = 1024 * 1024;
const MIN_COMPACTIONS = 2;
const CHUNK = 32 * MB;
const COOLDOWN_MS = 3 * 60 * 1000;
const envPct = Number(process.env.HANDOFF_PROMPT_PCT);
const PCT = envPct > 0 && envPct <= 1 ? envPct : 0.8;
const BOUNDARY = Buffer.from('"subtype":"compact_boundary"');
const ASSISTANT = Buffer.from('"type":"assistant"');

const parse = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
};

const sum = (u) => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);

function contextOf(usage) {
  const own = Array.isArray(usage.iterations) ? usage.iterations.filter((x) => x && x.type === 'message') : [];
  return own.length ? sum(own[own.length - 1]) : sum(usage);
}

function digest(chunk, st) {
  let tail = 0;
  let at = chunk.indexOf(BOUNDARY);
  while (at !== -1) {
    const start = chunk.lastIndexOf(10, at) + 1;
    let end = chunk.indexOf(10, at);
    if (end === -1) end = chunk.length;
    const rec = parse(chunk.toString('utf8', start, end));
    if (rec && rec.type === 'system' && rec.subtype === 'compact_boundary' && !rec.isSidechain) {
      st.count++;
      st.used = 0;
      tail = end;
    }
    at = chunk.indexOf(BOUNDARY, end);
  }
  let end = chunk.length;
  while (end > tail) {
    const nl = chunk.lastIndexOf(10, end - 1);
    const start = nl < tail ? tail : nl + 1;
    const line = chunk.subarray(start, end);
    if (line.includes(ASSISTANT)) {
      const rec = parse(line.toString('utf8'));
      if (rec && rec.type === 'assistant' && !rec.isSidechain && rec.message && rec.message.usage) {
        const used = contextOf(rec.message.usage);
        if (used > 0) {
          st.used = used;
          st.model = rec.message.model;
          st.entrypoint = rec.entrypoint;
          return;
        }
      }
    }
    end = start - 1;
  }
}

function advance(file, size, st) {
  if (st.offset >= size) return;
  const fd = fs.openSync(file, 'r');
  try {
    let want = CHUNK;
    while (st.offset < size) {
      const len = Math.min(want, size - st.offset);
      const buf = Buffer.allocUnsafe(len);
      const got = fs.readSync(fd, buf, 0, len, st.offset);
      if (got <= 0) break;
      const chunk = buf.subarray(0, got);
      const lastNl = chunk.lastIndexOf(10);
      if (lastNl === -1) {
        if (st.offset + got >= size) break;
        want *= 2;
        continue;
      }
      digest(chunk.subarray(0, lastNl + 1), st);
      st.offset += lastNl + 1;
      want = CHUNK;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function toTokens(value) {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(String(value == null ? '' : value).trim());
  if (!m) return 0;
  const unit = m[2].toLowerCase();
  return Math.round(Number(m[1]) * (unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1));
}

function compactWindow(model) {
  const fromEnv = toTokens(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (fromEnv > 0) return Math.min(1000000, Math.max(100000, fromEnv));
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settings = parse(readText(path.join(dir, 'settings.json'))) || {};
  const perModel = settings.modelSettings && model && settings.modelSettings[model] ? settings.modelSettings[model].autoCompactWindow : undefined;
  const value = perModel !== undefined ? perModel : settings.autoCompactWindow;
  return typeof value === 'number' && value >= 100000 && value <= 1000000 ? value : 0;
}

function stateFiles(input) {
  const files = [];
  if (input.scratchpad_dir) files.push(path.join(String(input.scratchpad_dir), '.handoff-prompt.json'));
  const sid = String(input.session_id || '').replace(/[^0-9A-Za-z_-]/g, '');
  if (sid) files.push(path.join(os.homedir(), '.claude', 'hooks', 'state', `handoff-prompt-${sid}.json`));
  return files;
}

function loadState(files, size) {
  let st = null;
  for (const file of files) {
    st = parse(readText(file));
    if (st && typeof st === 'object') break;
    st = null;
  }
  st = st || {};
  if (!Number.isInteger(st.offset) || st.offset < 0 || st.offset > size || !Number.isInteger(st.count)) {
    st.offset = 0;
    st.count = 0;
    st.used = 0;
    delete st.model;
    delete st.entrypoint;
  }
  if (!Number.isInteger(st.askedAtCompactions)) st.askedAtCompactions = -1;
  return st;
}

function saveState(files, st) {
  for (const file of files) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(st));
      return true;
    } catch {}
  }
  return false;
}

function startDir(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(256 * 1024);
      const got = fs.readSync(fd, buf, 0, buf.length, 0);
      const m = /"cwd":("(?:[^"\\]|\\.)*")/.exec(buf.toString('utf8', 0, got));
      return m ? JSON.parse(m[1]) : '';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function message(m) {
  const k = (n) => `${Math.round(n / 1000)}K`;
  const facts = `Context is at ${k(m.used)} of the ${k(m.win)} compact window and this session has compacted ${m.count} times`;
  const line = '━'.repeat(70);
  const dir = m.cwd ? `\`${m.cwd}\`` : 'the folder this session was started in';
  const fresh = `open a new terminal in ${dir}, run \`claude\`, type \`/status\` and copy the Session ID`;
  return [
    `Handoff check from the user's Stop hook (~/.claude/hooks/handoff-prompt.js). This is not an error. ${facts}. The user wants to be asked at this point whether to hand off to a fresh session. Do the steps below now and start no other work first.`,
    '',
    'STEP 1. Start a 60 second timer first: call the Bash tool with the command `sleep 60` and run_in_background set to true. Remember the task id it returns. Write no text before this call.',
    '',
    'STEP 2. Then ask in plain text, NOT with AskUserQuestion. The user approved this one exception to their "always use AskUserQuestion" rule: a pending AskUserQuestion blocks the turn, so the 1 minute timer could not work. The question must be the last thing on screen, so it is not lost: write exactly the block below, from the first thick line to the last thick line (keep both thick lines, the blank line before the last one, the red circle, bold and bullets), write nothing after it and end your turn. Do not wait in the foreground.',
    '',
    line,
    '\u{1F534} **ANSWER NEEDED (1 min): hand off to a fresh session?**',
    `${facts}.`,
    '- **yes**: hand off now (Recommended)',
    '- **no**: keep going here',
    '- **paste a session id**: hand off straight to that session',
    '',
    `**Fresh session:** ${fresh}, then paste it here.`,
    'Need more than a minute? Reply **yes** first, it stops the clock.',
    'No answer = keep going.',
    '',
    line,
    '',
    'STEP 3. Act on what comes first:',
    '- The user answers yes: stop the timer with the TaskStop tool and that task id, then do STEP 4.',
    '- The user pastes a session id (a UUID, alone or with "yes"): stop the timer, skip STEP 4 and invoke the handoff skill (Skill tool, skill name "handoff") with that id as the target session.',
    `- The user answers no: stop the timer with TaskStop, confirm in one short line that you will ask again when context nears the next auto-compaction, and carry on with any unfinished work. Do not ask again yourself. The hook asks again by itself at the next trigger.`,
    '- The user writes something else: stop the timer, treat it as "No: keep going" and do what they asked.',
    `- The timer ends first (you are told the background sleep finished and the user has not answered): write the one line "No answer in 1 minute, continuing as 'keep going'." and carry on with any unfinished work. If there is none, just stop.`,
    '- Other background work wakes you before an answer or the timer: carry on with that work. The timer still decides.',
    '- The user pastes a session id after the timer ended: it still counts. Hand off to it as above, even if you already carried on.',
    '- A timer notice that arrives after the user answered: ignore it. If TaskStop is not available, let the timer run out and ignore its notice.',
    '',
    'STEP 4. Only after a yes. Ask one question with AskUserQuestion (the user is present, so no timer):',
    `- Question: "Which session gets the handoff? Fresh session: ${fresh.replace(/`/g, '')}, then paste it in Other."`,
    '- Option "No new session", description "Write the handoff and give me the start line to paste into a new session."',
    '- Option "Cancel, keep going", description "Do not hand off. Stay in this session."',
    'Then act on the answer:',
    '- A session id (typed in Other): invoke the handoff skill (Skill tool, skill name "handoff") with that id as the target session. The skill first checks that this session can reach it, then writes the handoff and sends it there itself.',
    '- "No new session": invoke the handoff skill with no target session. It writes the handoff and gives the start line.',
    '- "Cancel, keep going": confirm in one short line and carry on.',
    'After a handoff, start no new work in this session.',
  ].join('\n');
}

function run(raw) {
  const input = parse(raw);
  if (!input || input.stop_hook_active || input.permission_mode === 'plan' || !input.transcript_path) return;
  let file = String(input.transcript_path);
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  const size = fs.statSync(file).size;
  const files = stateFiles(input);
  const st = loadState(files, size);
  advance(file, size, st);
  const win = st.used ? compactWindow(st.model) : 0;
  const byContext = win > 0 && st.count >= MIN_COMPACTIONS && st.used >= win * PCT && st.askedAtCompactions !== st.count;
  const cooling = Date.now() - Date.parse(st.askedAt || '') < COOLDOWN_MS;
  const ask = (st.entrypoint === 'cli' || process.env.HANDOFF_PROMPT_ANY_ENTRYPOINT === '1') && !cooling && byContext;
  if (ask) {
    st.askedAtCompactions = st.count;
    st.askedAt = new Date().toISOString();
  }
  if (!saveState(files, st) || !ask) return;
  const text = message({ used: st.used, win, count: st.count, cwd: startDir(file) });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } }));
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => {});
process.stdin.on('data', (chunk) => (data += chunk));
process.stdin.on('end', () => {
  try { run(data); } catch {}
});
