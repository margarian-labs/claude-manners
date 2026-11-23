const os = require('os');
const path = require('path');
const { liveState, save, weekly } = require('./away-mode.js');

const HANDOFFS = (path.join(os.homedir(), '.claude', 'handoffs') + path.sep).toLowerCase();
const EXTRA_WRAP_UP = [];
const WRAP_UP = new RegExp('^(?:' + ['Read', 'Grep', 'Glob', 'ToolSearch', 'ListAgents', ...EXTRA_WRAP_UP].join('|') + ')$');

function allowed(i) {
  if (WRAP_UP.test(i.tool_name)) return true;
  if (i.tool_name !== 'Write' && i.tool_name !== 'Edit') return false;
  const file = i.tool_input && i.tool_input.file_path;
  return typeof file === 'string' && path.resolve(file).toLowerCase().startsWith(HANDOFFS);
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(data);
    if (i.agent_id || typeof i.tool_name !== 'string') return;
    const sid = i.session_id || process.env.CLAUDE_CODE_SESSION_ID;
    const state = liveState(sid);
    if (!state || !state.cap) return;
    const w = weekly();
    if (!state.stopped) {
      if (!w || w.pct < state.cap) return;
      state.stopped = new Date().toISOString();
      save(sid, state);
    }
    if (allowed(i)) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Away mode stop point reached: weekly usage is ${w ? `${w.pct}%` : 'unknown'}, the user's stop point is ${state.cap}%. Start nothing new and do not retry this call. Let running sub-agents and background commands finish. Then update the progress note under ~/.claude/handoffs/ (done, half done, next step), give the final report and end the turn. Still allowed: Read, Grep, Glob, Write and Edit under ~/.claude/handoffs/${EXTRA_WRAP_UP.length ? ', ' + EXTRA_WRAP_UP.join(', ') : ''}. This holds until the user writes again.`,
        },
      }) + '\n',
    );
  } catch {}
});
