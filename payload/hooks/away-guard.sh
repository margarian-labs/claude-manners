#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
files=("$HOME"/.claude/state/away/*.json)
(( ${#files[@]} )) || exit 0
exec node "$HOME/.claude/hooks/away-guard.js"
