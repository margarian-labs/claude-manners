#!/bin/bash
# Stop hook -- fires when Claude finishes responding

source "$HOME/.claude/hooks/telegram-helpers.sh"
[[ -n "$CLAUDE_TITLE_GEN" ]] && exit 0
load_config || exit 0

INPUT=$(cat)

# Fork to background immediately so Claude Code never blocks waiting for us
if [[ -z "$HOOK_BG" ]]; then
  echo "$INPUT" | HOOK_BG=1 bash "$0" >/dev/null 2>&1 &
  exit 0
fi

# Skip claude -p subprocesses launched from a temp dir (e.g. the `remember`
# plugin does `cd /tmp && claude -p ...` to summarize sessions via Haiku;
# those subprocess Stop events should not page the user). On Windows the
# extracted cwd has literal `\\` separators (JSON-escaped backslashes).
CWD=$(extract_cwd "$INPUT")
TMP_RE='/tmp[\\/]?$|[\\/]+Temp[\\/]?$'
if [[ "$CWD" =~ $TMP_RE ]]; then
  exit 0
fi

# Per-session dedup (20s cooldown)
SID=$(extract_sid "$INPUT")
STAMP_FILE="$HOME/.claude/session/last_stop_${SID}"
NOW=$(date +%s)
if [[ -f "$STAMP_FILE" ]]; then
  LAST=$(cat "$STAMP_FILE" 2>/dev/null)
  [[ -n "$LAST" ]] && (( NOW - LAST < 20 )) && exit 0
fi
echo "$NOW" > "$STAMP_FILE"

# Single Node.js call: parse JSON, get title, truncate, convert to HTML, build message
MSG=$(echo "$INPUT" | node "$HOME/.claude/hooks/telegram-process.js" stop)

[[ -n "$MSG" ]] && send_telegram "$MSG"
exit 0
