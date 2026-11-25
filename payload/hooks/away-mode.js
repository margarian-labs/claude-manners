const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'state', 'away');
const TTL_MS = 72 * 60 * 60 * 1000;
const LEAD = /^\s*(?:-[a-z]+[\s,]+)*-away(?:[\s,]+(\d{1,3})%?)?(?=[\s,]|\.(?!\d)|$)/;
const TRAIL = /(?:^|[\s,])-away(?:[\s,]+(\d{1,3})%?)?(?:[\s,]+-[a-z]+)*[\s,.]*$/;
const BACK_LEAD = /^\s*(?:-[a-z]+[\s,]+)*-back(?=[\s,]|\.(?!\d)|$)/;
const BACK_TRAIL = /(?:^|[\s,])-back(?:[\s,]+-[a-z]+)*[\s,.]*$/;
const PLAN = /(?:^|[\s,])-p(?=[\s,.]|$)/;
const NOT_THE_USER = /^(?:continue$|<|another claude session sent|your claude\.ai usage |you can continue now\.)/i;
const RULES = 'Invoke the away-mode skill now if its text is not already in your context, and follow it. Not without the user: push, merge, deploy, production DB changes and messages to people, unless the task asked for them.';
const WAKE = 'Wake-up timer finished: the usage limit window has reset. Continue the work the limit stopped; what was left is in your last message before the stop. If the user has written in this session since the limit note, or nothing is left, do not resume on your own: say so in one line. If you are already continuing, carry on.';

function timerNote(text) {
  if (typeof text !== 'string' || !/^\s*<task-notification>/.test(text)) return null;
  const summary = /<summary>([^<]*)<\/summary>/.exec(text);
  const quoted = summary && /^[^"]*"((?:away )?wake-up timer:[^"]*)"/i.exec(summary[1]);
  if (!quoted) return null;
  return { away: /^away /i.test(quoted[1]), done: /<status>completed<\/status>/.test(text) };
}

const fileFor = (sid) => path.join(DIR, `${String(sid).replace(/[^\w-]/g, '_')}.json`);

function liveState(sid) {
  if (!sid) return null;
  try {
    const state = JSON.parse(fs.readFileSync(fileFor(sid), 'utf8'));
    return Date.now() - Date.parse(state.since) < TTL_MS ? state : null;
  } catch {
    return null;
  }
}

function save(sid, state) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileFor(sid), JSON.stringify(state) + '\n');
}

function drop(file) {
  try { fs.unlinkSync(file); } catch {}
}

function prune() {
  try {
    for (const name of fs.readdirSync(DIR)) {
      const file = path.join(DIR, name);
      if (Date.now() - fs.statSync(file).mtimeMs > TTL_MS) drop(file);
    }
  } catch {}
}

function weekly() {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const file = process.env.CLAUDE_AWAY_USAGE_FILE || path.join(dir, 'usage-weekly.txt');
    const parts = fs.readFileSync(file, 'utf8').trim().split(/\s+/);
    const [pct, resetsAt] = parts.map(Number);
    if (!parts[0] || !Number.isFinite(pct)) return null;
    return { pct: resetsAt > 0 && resetsAt * 1000 <= Date.now() ? 0 : pct };
  } catch {
    return null;
  }
}

function capText(state) {
  if (!state.cap) return '';
  if (state.stopped) return ` Weekly stop point ${state.cap}% was reached at ${state.stopped}: start nothing new. When running work has finished, update the progress note, give the final report and end the turn. Only -back or a new -away from the user restarts work.`;
  const w = weekly();
  return ` Weekly stop point: ${state.cap}% (now ${w ? `${w.pct}%` : 'unknown'}).`;
}

function run(input) {
  let i;
  try { i = JSON.parse(input); } catch { return; }
  const sid = i.session_id || process.env.CLAUDE_CODE_SESSION_ID;
  if (!sid || i.agent_id || typeof i.prompt !== 'string') return;
  prune();
  const prompt = i.prompt.trim();
  const file = fileFor(sid);
  const lead = LEAD.exec(prompt);
  const trail = TRAIL.exec(prompt);

  if (lead || trail) {
    const state = { since: new Date().toISOString(), cwd: i.cwd || '', cap: null, plan: PLAN.test(prompt) };
    const num = (lead && lead[1]) || (trail && trail[1]);
    let note = '';
    if (num) {
      const n = Number(num);
      const w = weekly();
      if (n < 1 || n > 100) {
        note = ` The number ${n} after -away was ignored: a weekly stop point must be 1-100.`;
      } else if (w && w.pct >= n) {
        note = ` No stop point set: weekly usage is already ${w.pct}%, at or past ${n}%. Tell the user in your first-round questions.`;
      } else {
        state.cap = n;
        note = `${capText(state)} The number belongs to the flag, it is not task text.`;
      }
    }
    save(sid, state);
    console.log(`Away mode ON: the user is leaving the desk. ${RULES} Ask every question now in one AskUserQuestion round, then never wait for the user. Only -back from the user ends away mode.${note}`);
    return;
  }
  const state = liveState(sid);
  if (!state) {
    drop(file);
    const timer = timerNote(prompt);
    if (timer && timer.away) console.log('Away mode is OFF (the user came back), so this wake-up timer is stale: do not resume the away task on your own. Just say in one line that the timer finished.');
    else if (timer && timer.done) console.log(WAKE);
    return;
  }
  if (NOT_THE_USER.test(prompt)) {
    console.log(`Away mode still ON (since ${state.since}): the user is still away. Do not ask or wait. ${RULES}${capText(state)}`);
    return;
  }
  if (BACK_LEAD.test(prompt) || BACK_TRAIL.test(prompt)) {
    drop(file);
    console.log('Away mode OFF: the user is back (-back). Normal rules apply again. If an away wake-up timer (away-wait) is running, stop it with TaskStop. Report what you decided for them and what needs them.');
    return;
  }
  console.log(`Away mode still ON (since ${state.since}): the user wrote without -back. Answer this message or do what it says${state.stopped ? ' as far as the stop point allows' : ', then carry on with the unfinished work'}. Do not ask or wait. If they seem to be staying, tell them -back ends away mode. ${RULES}${capText(state)}`);
}

module.exports = { liveState, save, weekly, capText, timerNote, RULES };

if (require.main === module) {
  let data = '';
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => {
    try { run(data); } catch {}
  });
}
