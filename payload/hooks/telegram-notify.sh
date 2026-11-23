#!/bin/bash
# Notification hook -- fires when Claude needs your attention

source "$HOME/.claude/hooks/telegram-helpers.sh"
[[ -n "$CLAUDE_TITLE_GEN" ]] && exit 0
load_config || exit 0

INPUT=$(cat)

# Fork to background immediately so Claude Code never blocks
if [[ -z "$HOOK_BG" ]]; then
  echo "$INPUT" | HOOK_BG=1 bash "$0" >/dev/null 2>&1 &
  exit 0
fi

# Per-session dedup: skip if Stop fired in last 300s (5 min)
# The Stop notification already tells the user Claude is done,
# so "waiting for input" notifications after it are redundant.
SID=$(extract_sid "$INPUT")
STAMP_FILE="$HOME/.claude/session/last_stop_${SID}"
NOW=$(date +%s)
if [[ -f "$STAMP_FILE" ]]; then
  LAST=$(cat "$STAMP_FILE" 2>/dev/null)
  [[ -n "$LAST" ]] && (( NOW - LAST < 300 )) && exit 0
fi

# Single Node.js call: parse JSON, get title, escape message, build HTML
MSG=$(echo "$INPUT" | node "$HOME/.claude/hooks/telegram-process.js" notify)

[[ -n "$MSG" ]] && send_telegram "$MSG"
exit 0
