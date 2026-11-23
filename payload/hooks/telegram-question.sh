#!/bin/bash
# PreToolUse hook -- fires when Claude asks a question via AskUserQuestion

source "$HOME/.claude/hooks/telegram-helpers.sh"
[[ -n "$CLAUDE_TITLE_GEN" ]] && exit 0
load_config || exit 0

INPUT=$(cat)

# Fork to background immediately so Claude Code never blocks
if [[ -z "$HOOK_BG" ]]; then
  echo "$INPUT" | HOOK_BG=1 bash "$0" >/dev/null 2>&1 &
  exit 0
fi

# Single Node.js call: parse JSON, get title, format questions, build HTML
MSG=$(echo "$INPUT" | node "$HOME/.claude/hooks/telegram-process.js" question)

[[ -n "$MSG" ]] && send_telegram "$MSG"
exit 0
