#!/bin/bash
# Shared helper functions for Telegram notification hooks

# Load config, sets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
load_config() {
  CONFIG="$HOME/.claude/telegram.conf"
  [[ ! -f "$CONFIG" ]] && return 1
  source "$CONFIG"
  export MACHINE_NAME
  [[ -z "$TELEGRAM_BOT_TOKEN" || "$TELEGRAM_BOT_TOKEN" == "YOUR_BOT_TOKEN_HERE" ]] && return 1
  return 0
}

# Pure-bash session_id extraction (avoids Node.js spawn for dedup checks)
extract_sid() {
  local input="$1"
  [[ "$input" =~ \"session_id\":\"([^\"]+)\" ]] && echo "${BASH_REMATCH[1]}"
}

# Pure-bash cwd extraction (used to filter out claude -p subprocesses from
# plugins like `remember` that run `cd /tmp && claude -p ...`)
extract_cwd() {
  local input="$1"
  [[ "$input" =~ \"cwd\":\"([^\"]+)\" ]] && echo "${BASH_REMATCH[1]}"
}

# Send a Telegram message
send_telegram() {
  local msg="$1"
  printf '%s' "$msg" | curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "disable_web_page_preview=true" \
    --data-urlencode "text@-" \
    > /dev/null 2>&1
}
