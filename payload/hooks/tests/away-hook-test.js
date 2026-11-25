const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const real = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const home = path.join(__dirname, 'away-test-home');
const hooks = path.join(home, '.claude', 'hooks');
const dir = path.join(home, '.claude', 'state', 'away');
const cfg = path.join(home, 'cfg');
const usageFile = path.join(cfg, 'usage-weekly.txt');
const usage5File = path.join(cfg, 'usage-5h.txt');
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(hooks, { recursive: true });
fs.mkdirSync(cfg, { recursive: true });
for (const f of ['away-mode.js', 'away-guard.js', 'away-guard.sh', 'compact-recovery.js', 'away-stop.js', 'away-stop.sh'])
  fs.copyFileSync(path.join(real, 'hooks', f), path.join(hooks, f));
const env = { ...process.env, USERPROFILE: home, HOME: home.replace(/\\/g, '/'), CLAUDE_CONFIG_DIR: cfg };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CLAUDE_AWAY_USAGE_FILE;

const sec = Math.floor(Date.now() / 1000);
const nowSec = () => Math.floor(Date.now() / 1000);
const usage = (pct, resetIn = 86400) => fs.writeFileSync(usageFile, `${pct} ${nowSec() + resetIn} ${nowSec()}\n`);
const usage5 = (pct, resetIn = 3600) => fs.writeFileSync(usage5File, `${pct} ${nowSec() + resetIn} ${nowSec()}\n`);
const node = (script, input) =>
  spawnSync(process.execPath, [path.join(hooks, script)], { input: JSON.stringify(input), env, encoding: 'utf8' }).stdout;
const prompt = (sid, text, extra) => node('away-mode.js', { session_id: sid, prompt: text, cwd: 'C:/x', ...extra });
const tool = (sid, tool_name, tool_input = {}, extra) => node('away-guard.js', { session_id: sid, tool_name, tool_input, ...extra });
const sh = (input, script = 'away-guard.sh') =>
  spawnSync('bash', [path.join(hooks, script).replace(/\\/g, '/')], { input: JSON.stringify(input), env, encoding: 'utf8' });
const state = (sid) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${sid}.json`), 'utf8')); } catch { return null; } };
const denied = (out) => { try { return JSON.parse(out).hookSpecificOutput.permissionDecision === 'deny'; } catch { return false; } };
let n = 0, bad = 0;
const check = (name, ok) => { n++; if (!ok) bad++; if (!ok || process.argv.includes('-v')) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };

usage(11);
const caps = [
  ['-away do X', null], ['do X -away', null], ['do X, -nc -away', null], ['-p -away do X', null], ['-p, -away', null],
  ['-away 85 do X', 85], ['do X -away 85', 85], ['-away 85, -nc', 85], ['-nc -away 85 do X', 85], ['do X -away 85 -nc', 85],
  ['-away 85% do X', 85], ['-away 100', 100], ['-away do 85 things', null], ['fix 3 bugs -away', null],
  ['-away 85x do X', null], ['-away 0 do X', null], ['-away 150 do X', null], ['-away 3 files need fixing', null],
  ['do X -away 85.', 85], ['do X -away 85...', 85], ['-away 85... do X', 85], ['-away 85. do X', 85],
  ['-away 85.5 do X', null], ['do X -away.', null], ['do X... -away', null],
];
caps.forEach(([p, want], k) => {
  const out = prompt(`cap${k}`, p);
  const s = state(`cap${k}`);
  check(`ON ${JSON.stringify(p)} -> ${want}`, out.startsWith('Away mode ON') && !!s && s.cap === want
    && (want === null || out.includes(`Weekly stop point: ${want}% (now 11%)`)));
});
check('out of range is named', prompt('r1', '-away 150 do X').includes('was ignored'));
check('already past is named', prompt('r2', '-away 3 files need fixing').includes('No stop point set'));

const off = ['talk about -away flag', '-awayx', 'do X --away', '-AWAY do X', 'do X -away 85.x', '-away85 do X', 'talk about -away 85 flag', 'continue please', 'hello'];
off.forEach((p, k) => {
  check(`quiet ${JSON.stringify(p)}`, prompt(`off${k}`, p) === '' && !state(`off${k}`));
  prompt(`off${k}`, '-away go');
  const out = prompt(`off${k}`, p);
  check(`STAY  ${JSON.stringify(p)}`, out.startsWith('Away mode still ON') && out.includes('-back') && !!state(`off${k}`));
});
const back = ['-back', 'thanks -back', '-back, -nc', '-nc -back what now', 'ok -back.', '-back what did you do?', '-rc, -back'];
back.forEach((p, k) => {
  check(`quiet ${JSON.stringify(p)}`, prompt(`back${k}`, p) === '' && !state(`back${k}`));
  prompt(`back${k}`, '-away go');
  check(`BACK  ${JSON.stringify(p)}`, prompt(`back${k}`, p).startsWith('Away mode OFF') && !state(`back${k}`));
});
['talk about -back flag', '-backup', '--back', '-BACK', '-back-end is slow', 'roll -back 3 commits', 'go back'].forEach((p, k) => {
  prompt(`nob${k}`, '-away go');
  check(`STAY  ${JSON.stringify(p)}`, prompt(`nob${k}`, p).startsWith('Away mode still ON') && !!state(`nob${k}`));
});
check('-back -away 85: away wins', prompt('both', '-back -away 85 go').startsWith('Away mode ON') && state('both').cap === 85);
check('agent -back is ignored', (prompt('ab', '-away go'), prompt('ab', '-back', { agent_id: 'a1' })) === '' && !!state('ab'));
const keep = ['continue', 'Continue ', 'CONTINUE', '<task-notification> x', '<channel source="telegram">hi',
  'Another Claude session sent a message', 'Your claude.ai usage limit has reset. Continue the task you were working on'];
keep.forEach((p, k) => {
  prompt(`keep${k}`, '-away go');
  check(`KEEP  ${JSON.stringify(p)}`, prompt(`keep${k}`, p).startsWith('Away mode still ON') && !!state(`keep${k}`));
});
prompt('agent', '-away go');
check('agent prompt is ignored', prompt('agent', 'hello', { agent_id: 'a1' }) === '' && !!state('agent'));
check('compact line when live', node('compact-recovery.js', { session_id: 'agent' }).includes('Away mode is still ON'));
check('no compact line when off', !node('compact-recovery.js', { session_id: 'nobody' }).includes('Away mode'));
check('compact base line kept', node('compact-recovery.js', { session_id: 'nobody' }).startsWith('Context was just compacted.'));
fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ since: new Date(Date.now() - 73 * 3600e3).toISOString(), cwd: '', cap: 85 }));
check('expired: no compact line', !node('compact-recovery.js', { session_id: 'old' }).includes('Away mode'));
check('expired: guard allows', tool('old', 'Bash') === '');
check('expired: silent and removed', prompt('old', 'hello') === '' && !state('old'));

usage(50);
prompt('g1', '-away 85 go');
check('under cap: allowed', tool('g1', 'Bash') === '' && !state('g1').stopped);
usage(85);
check('at cap: sub-agent allowed', tool('g1', 'Bash', {}, { agent_id: 'a1' }) === '' && !state('g1').stopped);
check('at cap: denied and latched', denied(tool('g1', 'Bash')) && !!state('g1').stopped);
for (const t of ['Read', 'Grep', 'Glob', 'ToolSearch', 'ListAgents'])
  check(`wrap-up ${t} allowed`, tool('g1', t) === '');
const note = path.join(home, '.claude', 'handoffs', 'x', 'progress.md');
check('Write under handoffs allowed', tool('g1', 'Write', { file_path: note }) === '');
check('Edit under handoffs allowed', tool('g1', 'Edit', { file_path: note }) === '');
check('Write outside handoffs denied', denied(tool('g1', 'Write', { file_path: path.join(home, 'a.md') })));
check('Write through .. denied', denied(tool('g1', 'Write', { file_path: `${path.join(home, '.claude', 'handoffs')}${path.sep}..${path.sep}settings.json` })));
check('Agent denied', denied(tool('g1', 'Agent', { prompt: 'x' })));
check('SendMessage denied', denied(tool('g1', 'SendMessage', { to: 'x' })));
usage(10);
check('still denied after usage drops', denied(tool('g1', 'Bash')));
check('continue after stop says so', prompt('g1', 'continue').includes('was reached'));
check('compact line carries the stop', node('compact-recovery.js', { session_id: 'g1' }).includes('was reached'));
check('stopped: a plain message keeps the stop', /still ON[\s\S]*was reached[\s\S]*-back/.test(prompt('g1', 'hello')) && denied(tool('g1', 'Bash')));
check('stopped: deny reason names -back', tool('g1', 'Bash').includes('-back'));
check('stopped: question denied with the stop reason', tool('g1', 'AskUserQuestion').includes('stop point'));
check('stopped: -back ends it', prompt('g1', '-back').startsWith('Away mode OFF') && tool('g1', 'Bash') === '');

const ASK = { questions: [{ header: 'Pick', question: 'Which one?' }] };
const HANDOFF = { questions: [{ header: 'Handoff', question: 'Which session gets the handoff? Fresh session: open a new terminal' }] };
usage(10); prompt('q1', '-away go');
check('ask: first dialog allowed and latched', tool('q1', 'AskUserQuestion', ASK) === '' && !!state('q1').asked);
check('ask: second denied', denied(tool('q1', 'AskUserQuestion', ASK)) && tool('q1', 'AskUserQuestion', ASK).includes('recommended'));
check('ask: other tools still allowed', tool('q1', 'Bash') === '' && tool('q1', 'ExitPlanMode') === '');
check('ask: handoff dialog passes', tool('q1', 'AskUserQuestion', HANDOFF) === '');
check('ask: sub-agent passes', tool('q1', 'AskUserQuestion', ASK, { agent_id: 'a1' }) === '');
prompt('q1', 'how is it going?');
check('ask: still denied after a plain message', denied(tool('q1', 'AskUserQuestion', ASK)));
prompt('q1', '-away go on');
check('ask: allowed once again after a new -away', tool('q1', 'AskUserQuestion', ASK) === '' && denied(tool('q1', 'AskUserQuestion', ASK)));
prompt('q1', '-back');
check('ask: allowed after -back', tool('q1', 'AskUserQuestion', ASK) === '');
prompt('q2', '-away go');
check('ask: handoff dialog does not use the allowance', tool('q2', 'AskUserQuestion', HANDOFF) === '' && !state('q2').asked);
const aged = (min) => fs.writeFileSync(path.join(dir, 'q3.json'), JSON.stringify({ since: new Date(Date.now() - min * 60e3).toISOString(), cwd: '', cap: null }));
aged(29); check('ask: first dialog at 29 min allowed', tool('q3', 'AskUserQuestion', ASK) === '');
aged(31); check('ask: first dialog at 31 min denied', denied(tool('q3', 'AskUserQuestion', ASK)));
aged(73 * 60); check('ask: expired state allows', tool('q3', 'AskUserQuestion', ASK) === '');
check('ask: no state allows', tool('nobody', 'AskUserQuestion', ASK) === '' && tool('nobody', 'EnterPlanMode') === '');
prompt('p1', '-away go');
check('plan mode denied', denied(tool('p1', 'EnterPlanMode')));
for (const [k, p] of ['-p -away go', '-away go -p', 'go -nc -p, -away'].entries())
  check(`plan mode allowed with ${JSON.stringify(p)}`, (prompt(`pp${k}`, p), tool(`pp${k}`, 'EnterPlanMode')) === '');
check('plan mode: -pa is not -p', (prompt('p2', '-away fix -pa thing'), denied(tool('p2', 'EnterPlanMode'))));

usage(50); prompt('g2', '-away 85 go'); usage(90);
check('over cap: denied', denied(tool('g2', 'Bash')));
usage(50); prompt('g3', '-away 85 go'); usage(95, -60);
check('reset passed: allowed', tool('g3', 'Bash') === '');
usage(50); prompt('g4', '-away go'); usage(99);
check('no stop point: allowed', tool('g4', 'Bash') === '');
check('no state: allowed', tool('nobody', 'Bash') === '');
usage(50); prompt('g5', '-away 85 go'); fs.rmSync(usageFile);
check('no usage file: allowed', tool('g5', 'Bash') === '');

const waitTool = path.join(real, 'tools', 'away-wait.mjs');
const wait = (...args) => spawnSync(process.execPath, [waitTool, ...args], { env, encoding: 'utf8' });
const dry = (...args) => {
  const m = /\((\d+) s\).*window: ([\w-]+)\./.exec(wait('--dry-run', ...args).stdout);
  return m ? { secs: Number(m[1]), win: m[2] } : { secs: -1, win: '' };
};
const about = (got, want) => Math.abs(got - want) <= 5;
let d;
usage(50); usage5(100, 3600); d = dry();
check('wait: 5h reset ahead', d.win === '5h' && about(d.secs, 3720));
usage(100, 86400); d = dry();
check('wait: weekly at 100 wins', d.win === 'weekly' && about(d.secs, 86520));
usage(99.4, 86400); d = dry();
check('wait: weekly under 100 -> 5h', d.win === '5h' && about(d.secs, 3720));
usage(100, -60); d = dry();
check('wait: weekly reset passed -> 5h', d.win === '5h' && about(d.secs, 3720));
usage(50); usage5(100, 30); d = dry();
check('wait: reset very close -> at least 60 s', d.win === '5h' && about(d.secs, 150));
usage5(100, -60); d = dry();
check('wait: 5h reset passed -> 15 min', d.win === 'fallback' && d.secs === 900);
fs.rmSync(usage5File); d = dry();
check('wait: no 5h file -> 15 min', d.win === 'fallback' && d.secs === 900);
fs.rmSync(usageFile); d = dry();
check('wait: no files -> 15 min', d.win === 'fallback' && d.secs === 900);
fs.writeFileSync(usage5File, 'garbage\n'); d = dry();
check('wait: bad file -> 15 min', d.win === 'fallback' && d.secs === 900);
d = dry('--seconds', '30');
check('wait: --seconds wins', d.win === 'manual' && d.secs === 30);
check('wait: dry run prints one line', wait('--dry-run', '--seconds', '30').stdout.trim().split('\n').length === 1);
check('wait: bad --seconds exits 2', wait('--seconds', 'x').status === 2);
const ran = wait('--seconds', '1');
check('wait: real run ends with the wake line', ran.status === 0 && ran.stdout.trim().split('\n').length === 2
  && ran.stdout.trim().endsWith('Usage window reset: continue the unfinished task (away mode: from progress.md)'));
check('wait: first line names the generic timer', ran.stdout.startsWith('Wake-up timer: waiting'));

const sl = (input) => spawnSync('bash', [path.join(real, 'statusline.sh').replace(/\\/g, '/')], { input: JSON.stringify(input), env, encoding: 'utf8' });
fs.rmSync(usage5File, { force: true });
sl({ rate_limits: { seven_day: { used_percentage: 35, resets_at: sec + 86400 } } });
check('statusline: no 5h data, no 5h file', !fs.existsSync(usage5File));
sl({ rate_limits: { five_hour: { used_percentage: 42.5, resets_at: sec + 3600 }, seven_day: { used_percentage: 35, resets_at: sec + 86400 } } });
const five = fs.existsSync(usage5File) ? fs.readFileSync(usage5File, 'utf8').trim().split(' ') : [];
check('statusline: 5h file written', five[0] === '42.5' && Number(five[1]) === sec + 3600 && Number(five[2]) >= sec);
check('statusline: weekly file still written', fs.existsSync(usageFile) && fs.readFileSync(usageFile, 'utf8').startsWith('35 '));

const badge = (sid) => sl({ session_id: sid, model: { display_name: 'Opus 5.5' } }).stdout.replace(/\x1b\[[0-9;]*m/g, '');
usage(11); prompt('b1', '-away go'); prompt('b2', '-away 85 go'); prompt('b3', '-away go'); prompt('b3', '-back');
fs.writeFileSync(path.join(dir, 'b4.json'), JSON.stringify({ since: new Date(Date.now() - 73 * 3600e3).toISOString(), cwd: '', cap: 85 }));
check('badge: away without a stop point', /rc  \|  away  \|  Opus/.test(badge('b1')));
check('badge: away with a stop point', /rc  \|  away 85%  \|  Opus/.test(badge('b2')));
for (const s of ['b3', 'b4', 'nobody', '', undefined]) check(`badge: hidden for ${s}`, !badge(s).includes('away') && badge(s).includes('Opus'));

const tdir = path.join(home, 't');
fs.mkdirSync(tdir, { recursive: true });
const meta = (content, usageLimitNote) => ({ type: 'user', isMeta: true, ...(usageLimitNote ? { usageLimitNote } : {}), message: { role: 'user', content } });
const LIMIT_TEXT = '[Usage limit reached; a short grace allowance remains, then this turn is cut off without warning.]';
const NOTE = meta(LIMIT_TEXT, 'wrap_up');
const RELEASE = meta("[Earlier usage-limit notes no longer apply. Continue working normally. Don't mention this to the user.]", 'release');
const cmd = (command, name = 'Bash', id = 'toolu_timer1') => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: { command, run_in_background: true } }] } });
const TIMER_CMD = 'node "$HOME/.claude/tools/away-wait.mjs"';
const TIMER = cmd(TIMER_CMD);
const SAID = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Usage limit reached, stopping.' }] } };
let tn = 0;
const transcript = (...recs) => {
  const file = path.join(tdir, `t${tn++}.jsonl`);
  fs.writeFileSync(file, recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return file;
};
const stop = (sid, file, extra) => node('away-stop.js', { session_id: sid, transcript_path: file, hook_event_name: 'Stop', stop_hook_active: false, ...extra });
const blocked = (out) => { try { const o = JSON.parse(out); return o.decision === 'block' && o.reason.includes('away-wait.mjs'); } catch { return false; } };
const PENDING = transcript(NOTE, SAID);
usage(50); prompt('s1', '-away go');
check('stop: note pending -> block', blocked(stop('s1', PENDING)));
check('stop: reason lets an empty task end', stop('s1', PENDING).includes('nothing is left'));
check('stop: note by text only -> block', blocked(stop('s1', transcript(meta(LIMIT_TEXT), SAID))));
check('stop: note then timer -> silent', stop('s1', transcript(NOTE, TIMER, SAID)) === '');
check('stop: timer via PowerShell -> silent', stop('s1', transcript(NOTE, cmd(TIMER_CMD, 'PowerShell'), SAID)) === '');
check('stop: note then release -> silent', stop('s1', transcript(NOTE, SAID, RELEASE)) === '');
check('stop: second note after timer -> block', blocked(stop('s1', transcript(NOTE, TIMER, NOTE, SAID))));
check('stop: second note after release -> block', blocked(stop('s1', transcript(NOTE, RELEASE, NOTE, SAID))));
check('stop: dry run is not a timer -> block', blocked(stop('s1', transcript(NOTE, cmd(`${TIMER_CMD} --dry-run`), SAID))));
check('stop: no note -> silent', stop('s1', transcript(SAID)) === '');
check('stop: near-limit note -> silent', stop('s1', transcript(meta('[Usage limit approaching. Checkpoint now.]', 'near_limit'), SAID)) === '');
check('stop: user typed the words -> silent', stop('s1', transcript({ type: 'user', message: { role: 'user', content: LIMIT_TEXT } }, SAID)) === '');
check('stop: request blob copy -> silent', stop('s1', transcript({ type: 'api-request-blob', message: { role: 'user', content: [{ type: 'text', text: LIMIT_TEXT }] } }, SAID)) === '');
check('stop: sidechain note -> silent', stop('s1', transcript({ ...NOTE, isSidechain: true }, SAID)) === '');
check('stop: broken lines are skipped', blocked(stop('s1', transcript('{"isMeta":true,', NOTE, 'not json away-wait'))));
check('stop: stop_hook_active -> silent', stop('s1', PENDING, { stop_hook_active: true }) === '');
check('stop: agent_id -> silent', stop('s1', PENDING, { agent_id: 'a1' }) === '');
check('stop: no away state, note without cli entrypoint -> silent', stop('nobody', PENDING) === '');
fs.writeFileSync(path.join(dir, 'old2.json'), JSON.stringify({ since: new Date(Date.now() - 73 * 3600e3).toISOString(), cwd: '', cap: null }));
check('stop: expired state -> silent', stop('old2', PENDING) === '');
check('stop: timer in background_tasks -> silent', stop('s1', PENDING, { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: TIMER_CMD }] }) === '');
check('stop: timer found by description -> silent', stop('s1', PENDING, { background_tasks: [{ id: 'b1', description: 'Away wake-up timer: the usage limit has reset' }] }) === '');
check('stop: other background task -> block', blocked(stop('s1', PENDING, { background_tasks: [{ id: 'b2', type: 'shell', status: 'running', command: 'sleep 60' }] })));
check('stop: timer started then stopped -> block', blocked(stop('s1', transcript(NOTE, TIMER, SAID), { background_tasks: [] })));
const notifText = (status, desc = 'Away wake-up timer: the usage limit has reset, continue the away task from progress.md', id = 'toolu_timer1') =>
  `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>Background command "${desc}" ${status} (exit code 0)</summary>\n</task-notification>`;
const notif = (status, desc, id) => ({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: notifText(status, desc, id) } });
const queued = (status, desc, id) => ({ type: 'attachment', attachment: { type: 'queued_command', prompt: notifText(status, desc, id) } });
check('stop: finished timer found by tool-use-id, other description -> silent', stop('s1', transcript(NOTE, TIMER, SAID, notif('completed', 'wait for reset'), SAID), { background_tasks: [] }) === '');
check('stop: finished timer delivered mid-turn (queued) -> silent', stop('s1', transcript(NOTE, TIMER, queued('completed', 'wait for reset'), SAID), { background_tasks: [] }) === '');
check('stop: another task finished (other id, other text) -> block', blocked(stop('s1', transcript(NOTE, TIMER, SAID, notif('completed', 'sleep 60', 'toolu_other'), SAID), { background_tasks: [] })));
check('mode: OFF line says to stop the timer', (prompt('m1', '-away go'), prompt('m1', '-back')).includes('stop it with TaskStop'));
check('mode: stale timer after OFF -> advisory', prompt('m1', notifText('completed')).includes('timer is stale'));
check('mode: other notification after OFF -> silent', prompt('m1', notifText('completed', 'sleep 60')) === '');
check('stop: timer finished and woke the session -> silent', stop('s1', transcript(NOTE, TIMER, SAID, notif('completed'), SAID), { background_tasks: [] }) === '');
check('stop: timer killed, not finished -> block', blocked(stop('s1', transcript(NOTE, TIMER, SAID, notif('killed'), SAID), { background_tasks: [] })));
check('stop: woke, then a new limit note -> block', blocked(stop('s1', transcript(NOTE, TIMER, notif('completed'), SAID, NOTE, SAID), { background_tasks: [] })));
check('stop: other task finished -> still block', blocked(stop('s1', transcript(NOTE, SAID, { type: 'user', message: { role: 'user', content: '<task-notification>\n<status>completed</status>\n<summary>Background command "sleep 60" completed</summary>\n</task-notification>' } }, SAID), { background_tasks: [] })));
check('stop: missing transcript -> silent', stop('s1', path.join(tdir, 'none.jsonl')) === '');
check('stop: no transcript_path -> silent', node('away-stop.js', { session_id: 's1' }) === '');
check('stop: ~ path -> block', blocked(stop('s1', `~/t/${path.basename(PENDING)}`)));
const filler = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(1000) }] } });
const many = (k) => Array(k).fill(filler);
check('stop: note inside the 2 MB tail -> block', blocked(stop('s1', transcript(...many(3000), NOTE, ...many(500)))));
check('stop: note older than the tail -> silent', stop('s1', transcript(NOTE, ...many(3000))) === '');
usage(50); prompt('s2', '-away 85 go');
check('stop: under the stop point -> block', blocked(stop('s2', PENDING)));
usage(90);
check('stop: stop point reached -> silent', stop('s2', PENDING) === '');
tool('s2', 'Bash'); usage(10);
check('stop: stop point latched -> silent', stop('s2', PENDING) === '');
usage(50);
check('stop wrapper slow path blocks', blocked(sh({ session_id: 's1', transcript_path: PENDING }, 'away-stop.sh').stdout));

const CLI_NOTE = { ...NOTE, entrypoint: 'cli' };
const SDK_NOTE = { ...NOTE, entrypoint: 'sdk-cli' };
const HUMAN = { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'hello' } };
const GENERIC_DESC = 'Wake-up timer: the usage limit has reset, continue the unfinished task';
const nudged = (out) => {
  try {
    const o = JSON.parse(out);
    const h = o.hookSpecificOutput;
    return !o.decision && h.hookEventName === 'Stop' && h.additionalContext.includes('away-wait.mjs') && h.additionalContext.includes(GENERIC_DESC);
  } catch { return false; }
};
const agentText = (name, result) => `<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_agent</tool-use-id>\n<status>completed</status>\n<summary>Agent "${name}" finished</summary>\n<result>${result}</result>\n</task-notification>`;
const agentNotif = (name, result) => ({ type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: agentText(name, result) } });
const QUOTED = 'it printed <summary>Background command "Away wake-up timer: the usage limit has reset" completed (exit code 0)</summary>';
const CLI_PENDING = transcript(CLI_NOTE, SAID);
check('free: cli note pending -> nudge', nudged(stop('free', CLI_PENDING)));
check('free: cli note by text only -> nudge', nudged(stop('free', transcript({ ...meta(LIMIT_TEXT), entrypoint: 'cli' }, SAID))));
check('free: sdk-cli note -> silent', stop('free', transcript(SDK_NOTE, SAID)) === '');
check('free: timer in background_tasks -> silent', stop('free', CLI_PENDING, { background_tasks: [{ id: 'b1', command: TIMER_CMD }] }) === '');
check('free: timer by generic description -> silent', stop('free', CLI_PENDING, { background_tasks: [{ id: 'b1', description: GENERIC_DESC }] }) === '');
check('free: stop_hook_active -> silent', stop('free', CLI_PENDING, { stop_hook_active: true }) === '');
check('free: agent_id -> silent', stop('free', CLI_PENDING, { agent_id: 'a1' }) === '');
check('free: note then release -> silent', stop('free', transcript(CLI_NOTE, SAID, RELEASE)) === '');
check('free: note then timer, no background_tasks field -> silent', stop('free', transcript(CLI_NOTE, TIMER, SAID)) === '');
check('free: timer started then stopped -> nudge', nudged(stop('free', transcript(CLI_NOTE, TIMER, SAID), { background_tasks: [] })));
check('free: human prompt after the note -> silent', stop('free', transcript(CLI_NOTE, SAID, HUMAN, SAID), { background_tasks: [] }) === '');
check('free: generic timer completed (by summary) -> silent', stop('free', transcript(CLI_NOTE, SAID, notif('completed', GENERIC_DESC, 'toolu_other'), SAID), { background_tasks: [] }) === '');
check('free: generic timer killed -> nudge', nudged(stop('free', transcript(CLI_NOTE, SAID, notif('killed', GENERIC_DESC, 'toolu_other'), SAID), { background_tasks: [] })));
check('free: woke, then a new cli note -> nudge', nudged(stop('free', transcript(CLI_NOTE, TIMER, notif('completed', GENERIC_DESC), SAID, CLI_NOTE, SAID), { background_tasks: [] })));
check('free: sidechain cli note -> silent', stop('free', transcript({ ...CLI_NOTE, isSidechain: true }, SAID)) === '');
check('free: expired away state plus cli note -> nudge', nudged(stop('old2', CLI_PENDING)));
check('free: agent result quoting the timer -> nudge', nudged(stop('free', transcript(CLI_NOTE, SAID, agentNotif('Check logs', QUOTED), SAID), { background_tasks: [] })));
check('stop: human prompt after the note (away) -> still block', blocked(stop('s1', transcript(NOTE, SAID, HUMAN, SAID), { background_tasks: [] })));
check('stop: agent result quoting the timer -> still block', blocked(stop('s1', transcript(NOTE, SAID, agentNotif('Check logs', QUOTED), SAID), { background_tasks: [] })));
check('stop: agent named "Plan away wake-up timer" -> still block', blocked(stop('s1', transcript(NOTE, SAID, agentNotif('Plan away wake-up timer', 'done'), SAID), { background_tasks: [] })));
check('mode: generic timer completed, no state -> wake line', prompt('w1', notifText('completed', GENERIC_DESC)).startsWith('Wake-up timer finished'));
check('mode: generic timer killed, no state -> silent', prompt('w2', notifText('killed', GENERIC_DESC)) === '');
check('mode: agent result quoting the timer -> silent', prompt('w3', agentText('Check logs', QUOTED)) === '');
check('mode: agent named "Plan away wake-up timer" -> silent', prompt('w4', agentText('Plan away wake-up timer', 'done')) === '');
prompt('w5', '-away go');
check('mode: generic timer completed while away -> still ON', prompt('w5', notifText('completed', GENERIC_DESC)).startsWith('Away mode still ON'));

check('wrapper slow path denies', denied(sh({ session_id: 'g2', tool_name: 'Bash', tool_input: {} }).stdout));
for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.rmSync(path.join(dir, f));
fs.writeFileSync(path.join(dir, 'debug.log'), 'x\n');
fs.rmSync(path.join(hooks, 'away-guard.js'));
const fast = sh({ session_id: 'g2', tool_name: 'Bash', tool_input: {} });
check('wrapper fast path: exit 0, silent, no node', fast.status === 0 && fast.stdout === '' && fast.stderr === '');
const freeStop = sh({ session_id: 's1', transcript_path: CLI_PENDING }, 'away-stop.sh');
check('stop wrapper, no state files: cli note -> nudge', freeStop.status === 0 && nudged(freeStop.stdout));
const quietStop = sh({ session_id: 's1', transcript_path: PENDING }, 'away-stop.sh');
check('stop wrapper, no state files: note without entrypoint -> silent', quietStop.status === 0 && quietStop.stdout === '' && quietStop.stderr === '');
fs.rmSync(dir, { recursive: true });
check('wrapper with no state folder: exit 0', sh({}).status === 0);
check('stop wrapper with no state folder: exit 0', sh({}, 'away-stop.sh').status === 0);

const dash = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const awayRule = ['rules/claude-manners--away-mode.md', 'rules/claude-setup--away-mode.md'].find((f) => fs.existsSync(path.join(real, f)));
for (const f of [awayRule, 'settings.json', 'statusline.sh', 'tools/away-wait.mjs', 'hooks/away-stop.js', 'hooks/away-stop.sh', 'hooks/away-mode.js', 'hooks/away-mode.sh', 'hooks/away-guard.js', 'hooks/away-guard.sh', 'hooks/compact-recovery.js', 'skills/away-mode/SKILL.md'])
  check(`no long dash in ${f}`, !dash.test(fs.readFileSync(path.join(real, f), 'utf8')));
if (process.argv.includes('--settings')) {
  const s = JSON.parse(fs.readFileSync(path.join(real, 'settings.json'), 'utf8'));
  const has = (event, name) => JSON.stringify(s.hooks[event]).includes(name);
  check('settings: away prompt hook', has('UserPromptSubmit', 'away-mode.sh'));
  check('settings: away PreToolUse hook', has('PreToolUse', 'away-guard.sh'));
  check('settings: watchdog env', s.env.CLAUDE_CODE_RETRY_WATCHDOG === '1');
  check('settings: away Stop hook', has('Stop', 'away-stop.sh'));
}

fs.rmSync(home, { recursive: true, force: true });
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
