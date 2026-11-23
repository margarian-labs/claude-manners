#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${SESSION_NAMER_CHILD:-}" || -e "$HOME/.claude/state/session-namer/off" ]]; then exit 0; fi
exec node "$HOME/.claude/hooks/session-namer.js"
