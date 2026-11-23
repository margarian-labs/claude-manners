# >>> claude accounts >>>
claude() {
  local second_flag='-P' second_dir='.claude-personal'
  local a second= after= rest=() rc
  for a in "$@"; do
    if [ -z "$after" ] && [ "$a" = "$second_flag" ]; then second=1; continue; fi
    [ "$a" = "--" ] && after=1
    rest+=("$a")
  done
  if [ -z "$second" ]; then
    command claude "$@"
    return
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[claude accounts] node not found on PATH; second profile not launched" >&2
    return 1
  fi
  node "$(cygpath -m "$USERPROFILE")/.claude/tools/sync-second-profile.mjs" --profile-dir "$second_dir" --quiet
  rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "[claude accounts] second profile not launched (see the message above)" >&2
    return 2
  elif [ "$rc" -ne 0 ]; then
    echo "[claude accounts] warning: profile sync failed (exit $rc), launching anyway" >&2
  fi
  CLAUDE_CONFIG_DIR="${USERPROFILE}\\${second_dir}" command claude "${rest[@]}"
}
# <<< claude accounts <<<
