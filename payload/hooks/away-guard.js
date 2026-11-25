const os = require('os');
const path = require('path');
const { liveState, save, weekly } = require('./away-mode.js');

const HANDOFFS = (path.join(os.homedir(), '.claude', 'handoffs') + path.sep).toLowerCase();
const HANDOFF_ASK = /"question":"Which session gets the handoff/;
const ASK_MS = 30 * 60 * 1000;
const EXTRA_WRAP_UP = [];
const WRAP_UP = new RegExp('^(?:' + ['Read', 'Grep', 'Glob', 'ToolSearch', 'ListAgents', ...EXTRA_WRAP_UP].join('|') + ')$');

function allowed(i) {
  if (WRAP_UP.test(i.tool_name)) return true;
  if (i.tool_name !== 'Write' && i.tool_name !== 'Edit') return false;
  const file = i.tool_input && i.tool_input.file_path;
  return typeof file === 'string' && path.resolve(file).toLowerCase().startsWith(HANDOFFS);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }) + '\n',
  );
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(data);
    if (i.agent_id || typeof i.tool_name !== 'string') return;
    const sid = i.session_id || process.env.CLAUDE_CODE_SESSION_ID;
    const state = liveState(sid);
    if (!state) return;
    const w = state.cap ? weekly() : null;
    if (!state.stopped && w && w.pct >= state.cap) {
      state.stopped = new Date().toISOString();
      save(sid, state);
    }
    if (state.stopped) {
      if (allowed(i)) return;
      deny(`Away mode stop point reached: weekly usage is ${w ? `${w.pct}%` : 'unknown'}, the user's stop point is ${state.cap}%. Start nothing new and do not retry this call. Let running sub-agents and background commands finish. Then update the progress note under ~/.claude/handoffs/ (done, half done, next step), give the final report and end the turn. Still allowed: Read, Grep, Glob, Write and Edit under ~/.claude/handoffs/${EXTRA_WRAP_UP.length ? ', ' + EXTRA_WRAP_UP.join(', ') : ''}. This holds until the user writes -back or a new -away.`);
      return;
    }
    if (i.tool_name === 'EnterPlanMode' && !state.plan) {
      deny('Away mode: plan mode would wait for an approval the user cannot give. Do not retry. Plan in your own notes, take the recommended option at each choice and carry on.');
      return;
    }
    if (i.tool_name !== 'AskUserQuestion' || HANDOFF_ASK.test(JSON.stringify(i.tool_input))) return;
    if (!state.asked && Date.now() - Date.parse(state.since) < ASK_MS) {
      state.asked = new Date().toISOString();
      save(sid, state);
      return;
    }
    deny('Away mode: the user is away and the one question dialog is used up or too late. Do not ask, not in plain text either, and do not retry. Take the recommended option, note it and why for the final report, and carry on. Only -back from the user ends away mode.');
  } catch {}
});
