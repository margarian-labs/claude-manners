let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let i = {};
  try { i = JSON.parse(data); } catch {}
  const sid = i.session_id || '<session id>';
  const where = i.transcript_path || 'the transcript (find it: node ~/.claude/skills/handoff/scripts/session-info.mjs <session id>)';
  const out = i.scratchpad_dir ? `${i.scratchpad_dir}/user-messages.md` : '<your scratchpad>/user-messages.md';
  console.log(`Context was just compacted. Nothing is lost: the full history of this session (every message and tool result, also from before each compaction) is in ${where} (session ${sid}). Grep it, never read it whole. The user's own words and answers, verbatim and in order: node ~/.claude/skills/handoff/scripts/extract-user-messages.mjs --session ${sid} --out ${out}. Where the summary and the user's words differ, the user's words win.`);
  let away = null;
  let cap = '';
  let rules = 'Invoke the away-mode skill and follow it.';
  try {
    const a = require('./away-mode.js');
    away = a.liveState(i.session_id || process.env.CLAUDE_CODE_SESSION_ID);
    if (away) cap = a.capText(away);
    if (a.RULES) rules = a.RULES;
  } catch {}
  if (away) console.log(`Away mode is still ON (-away, since ${away.since}): the user is away. Do not ask or wait. ${rules}${cap}`);
});
