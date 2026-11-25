#!/usr/bin/env bash
# Claude Code status line: account | rc | away | model · effort | context · size | limits | directory

# ── 0. Accounts (filled in at setup from the two logins) ──
# ACCTn_MATCH: email or bash glob such as '*@company.com', case-insensitive.
# ACCTn_COLOR: RED GREEN YELLOW GRAY BLUE PINK TEAL ORANGE. SHOW_RC=0 hides the rc segment.
ACCT1_MATCH='{{ACCT1_MATCH}}'
ACCT1_LABEL='{{ACCT1_LABEL}}'
ACCT1_COLOR='BLUE'
ACCT2_MATCH='__ACCOUNT_2_EMAIL__'
ACCT2_LABEL='Personal'
ACCT2_COLOR='PINK'
SHOW_RC=1

# ── 1. Read with timeout ──
read -t 1 -r -d '' input || [[ -n "$input" ]] || exit 0

# ── 2. Field extraction ──
sid="" tpath="" ctx_size=0 used_tok=0 used_pct="" model="" effort="" dir=""
lim5_pct="" lim5_rst=0 lim7_pct="" lim7_rst=0
if command -v jq &>/dev/null; then
  ctx_size=$(jq -r '.context_window.context_window_size // 0' <<< "$input")
  used_pct=$(jq -r '.context_window.used_percentage // ""' <<< "$input")
  used_tok=$(jq -r '.context_window.current_usage | if . then (.input_tokens // 0) + (.output_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0) else 0 end' <<< "$input")
  tpath=$(jq -r '.transcript_path // ""' <<< "$input")
  sid=$(jq -r '.session_id // ""' <<< "$input")
  model=$(jq -r '.model.display_name // ""' <<< "$input")
  effort=$(jq -r '.effort.level // ""' <<< "$input")
  dir=$(jq -r '.workspace.current_dir // .cwd // ""' <<< "$input")
  lim5_pct=$(jq -r '.rate_limits.five_hour.used_percentage // ""' <<< "$input")
  lim5_rst=$(jq -r '.rate_limits.five_hour.resets_at // 0' <<< "$input")
  lim7_pct=$(jq -r '.rate_limits.seven_day.used_percentage // ""' <<< "$input")
  lim7_rst=$(jq -r '.rate_limits.seven_day.resets_at // 0' <<< "$input")
else
  ctx_size=$(sed -n 's/.*"context_window_size":\([0-9]*\).*/\1/p' <<< "$input")
  used_pct=$(grep -o '"context_window".*' <<< "$input" | grep -o '"used_percentage"[[:space:]]*:[[:space:]]*[0-9.]*' | head -1 | sed 's/.*:[[:space:]]*//')
  tpath=$(sed -n 's/.*"transcript_path":"\([^"]*\)".*/\1/p' <<< "$input")
  sid=$(sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p' <<< "$input")
  model=$(sed -n 's/.*"display_name":"\([^"]*\)".*/\1/p' <<< "$input")
  effort=$(sed -n 's/.*"effort":{"level":"\([^"]*\)".*/\1/p' <<< "$input")
  dir=$(sed -n 's/.*"current_dir":"\([^"]*\)".*/\1/p' <<< "$input")
  _flat=$(tr -d '\n' <<< "$input")
  lim5_pct=$(sed -n 's/.*"five_hour"[^{]*{[^}]*"used_percentage"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' <<< "$_flat")
  lim5_rst=$(sed -n 's/.*"five_hour"[^{]*{[^}]*"resets_at"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' <<< "$_flat")
  lim7_pct=$(sed -n 's/.*"seven_day"[^{]*{[^}]*"used_percentage"[[:space:]]*:[[:space:]]*\([0-9.]*\).*/\1/p' <<< "$_flat")
  lim7_rst=$(sed -n 's/.*"seven_day"[^{]*{[^}]*"resets_at"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' <<< "$_flat")
  : "${ctx_size:=0}" "${lim5_rst:=0}" "${lim7_rst:=0}"
fi

if [[ -n "$lim7_pct" && "$lim7_pct" != "null" ]]; then
  printf '%s %s %s\n' "$lim7_pct" "$lim7_rst" "$(date +%s)" > "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/usage-weekly.txt" 2>/dev/null
fi
if [[ "$lim5_rst" =~ ^[0-9]+$ ]] && (( lim5_rst > 0 )); then
  printf '%s %s %s\n' "${lim5_pct:-0}" "$lim5_rst" "$(date +%s)" > "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/usage-5h.txt" 2>/dev/null
fi

# ── 3. Fallback: compute used tokens from percentage if not provided ──
if (( used_tok == 0 )) && [[ -n "$used_pct" && "$used_pct" != "null" ]]; then
  pct_int="${used_pct%.*}"
  (( pct_int > 0 )) && used_tok=$(( pct_int * ctx_size / 100 ))
fi

# ── 4. Format tokens ──
for _pair in "used_tok:fmt_used" "ctx_size:fmt_ctx"; do
  _n="${_pair%%:*}"; _v="${_pair#*:}"; _n=${!_n}
  if (( _n >= 1000000 )); then
    printf -v "$_v" "%d.%dM" $((_n/1000000)) $((_n%1000000/100000))
  elif (( _n >= 1000 )); then
    printf -v "$_v" "%d.%dk" $((_n/1000)) $((_n%1000/100))
  else
    printf -v "$_v" '%d' "$_n"
  fi
done

# ── 5. Directory basename (handles both \ and /) ──
dir="${dir//\\//}"
dir="${dir%/}"
full_dir="$dir"
dir="${dir##*/}"

# ── 6. Git branch (only if session dir is inside a git repo) ──
branch=""
if [[ -n "$full_dir" ]] && command -v git &>/dev/null; then
  branch=$(git -C "$full_dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
fi

# ── 6a. Colors ──
RED=$'\e[31m' GREEN=$'\e[32m' YELLOW=$'\e[33m' GRAY=$'\e[90m' RST=$'\e[0m'
BLUE=$'\e[94m' PINK=$'\e[95m' TEAL=$'\e[96m' ORANGE=$'\e[38;2;217;119;87m'

pct_color() {  # usage % -> green < 50, yellow 50-79, red >= 80
  local p=${1%.*}
  [[ "$p" =~ ^[0-9]+$ ]] || return
  if (( p >= 80 )); then printf '%s' "$RED"
  elif (( p >= 50 )); then printf '%s' "$YELLOW"
  else printf '%s' "$GREEN"; fi
}

# ── 6b. Usage limits (5h block / 7d window) ──
fmt_reset() {  # epoch -> compact "time left"
  local target=$1 now rem
  [[ -z "$target" || "$target" == "null" || "$target" -le 0 ]] 2>/dev/null && { printf ''; return; }
  now=$(date +%s); rem=$(( target - now ))
  (( rem <= 0 )) && { printf 'now'; return; }
  if (( rem >= 86400 )); then printf '%dd%dh' $(( rem/86400 )) $(( rem%86400/3600 ))
  elif (( rem >= 3600 )); then printf '%dh%02dm' $(( rem/3600 )) $(( rem%3600/60 ))
  else printf '%dm' $(( rem/60 )); fi
}

fmt_limit() {  # label pct reset-epoch -> "5h 42% · ↻ 2h14m"
  local label=$1 pct=$2 rst=$3 r
  [[ -z "$pct" || "$pct" == "null" ]] && return
  printf '%s %s%s%%%s' "$label" "$(pct_color "$pct")" "${pct%.*}" "$RST"
  r=$(fmt_reset "$rst")
  if [[ "$r" == "now" ]]; then printf ' · ↻ resetting'
  elif [[ -n "$r" ]]; then printf ' · ↻ %s' "$r"; fi
}

seg_lim5=$(fmt_limit 5h "$lim5_pct" "$lim5_rst")
seg_lim7=$(fmt_limit 7d "$lim7_pct" "$lim7_rst")

cfg="${CLAUDE_CONFIG_DIR:-$HOME}"
email=$(grep -o -m1 '"emailAddress": *"[^"]*"' "${cfg//\\//}/.claude.json" 2>/dev/null)
email="${email%\"}"; email="${email##*\"}"
email_lc="${email,,}"
if [[ -z "$email" ]]; then seg_acct=""
elif [[ "$email_lc" == ${ACCT1_MATCH,,} ]]; then seg_acct="${!ACCT1_COLOR}${ACCT1_LABEL}${RST}"
elif [[ "$email_lc" == ${ACCT2_MATCH,,} ]]; then seg_acct="${!ACCT2_COLOR}${ACCT2_LABEL}${RST}"
else seg_acct="$email"; fi

# Remote Control: Claude Code sets this env var only while RC is on (green rc = on, red rc = off)
if [[ -n "${CLAUDE_CODE_BRIDGE_SESSION_ID:-}" ]]; then seg_rc="${GREEN}rc${RST}"; else seg_rc="${RED}rc${RST}"; fi

# Away mode: the away hooks keep one state file per session; 72 h is their limit
seg_away=""
afile="$HOME/.claude/state/away/${sid//[^A-Za-z0-9_-]/_}.json"
if [[ -n "$sid" && -f "$afile" ]]; then
  astate=$(<"$afile")
  [[ "$astate" =~ \"since\":\"([^\"]+)\" ]] && since=$(date -d "${BASH_REMATCH[1]}" +%s 2>/dev/null) || since=0
  if (( $(date +%s) - ${since:-0} < 259200 )); then
    seg_away="${ORANGE}away"
    [[ "$astate" =~ \"cap\":([0-9]+) ]] && seg_away+=" ${BASH_REMATCH[1]}%"
    seg_away+="$RST"
  fi
fi

# ── 7. Assemble segments ──
SEP="  ${GRAY}|${RST}  "
CALM=$'\e[38;5;110m'
level_color() {  # 1 calm .. 4 aggressive
  case $1 in 1) printf '%s' "$CALM" ;; 2) printf '%s' "$GREEN" ;; 3) printf '%s' "$ORANGE" ;; 4) printf '%s' "$RED" ;; *) printf '%s' "$GRAY" ;; esac
}
model="${model%% (*}"   # drop context-size suffix, e.g. "Opus 5 (1M context)"
case "${model,,}" in *haiku*) mlvl=1 ;; *sonnet*) mlvl=2 ;; *opus*) mlvl=3 ;; *fable*) mlvl=4 ;; *) mlvl=0 ;; esac
case "${effort,,}" in low) elvl=1 ;; medium) elvl=2 ;; high) elvl=3 ;; xhigh|max) elvl=4 ;; *) elvl=0 ;; esac
seg_model="$(level_color $mlvl)$model$RST"
[[ -n "$effort" ]] && seg_model+=" ${GRAY}·${RST} $(level_color $elvl)$effort$RST"

ctx_pct="${used_pct%.*}"
[[ "$ctx_pct" =~ ^[0-9]+$ ]] || { (( ctx_size > 0 )) && ctx_pct=$(( used_tok * 100 / ctx_size )) || ctx_pct=0; }
if (( ctx_pct >= 85 )); then ctx_col="$RED"
elif (( ctx_pct >= 70 )); then ctx_col="$ORANGE"
elif (( ctx_pct >= 50 )); then ctx_col="$YELLOW"
else ctx_col="$GREEN"; fi
seg_ctx="$ctx_col$fmt_used$RST / $fmt_ctx"

fmt_size() {
  local n=$1 unit=B div=1 t
  if (( n >= 1073741824 )); then unit=GB div=1073741824
  elif (( n >= 1048576 )); then unit=MB div=1048576
  elif (( n >= 1024 )); then unit=KB div=1024; fi
  if (( div == 1 )); then printf '%d%s' "$n" "$unit"; return; fi
  t=$(( (n * 10 + div / 2) / div ))
  if (( t % 10 == 0 )); then printf '%d%s' $(( t / 10 )) "$unit"
  else printf '%d.%d%s' $(( t / 10 )) $(( t % 10 )) "$unit"; fi
}
tpath="${tpath//\\//}"
if [[ -n "$tpath" && -f "$tpath" ]]; then
  tsize=$(stat -c %s "$tpath" 2>/dev/null)
  [[ "$tsize" =~ ^[0-9]+$ ]] && seg_ctx+=" ${GRAY}·${RST} $(fmt_size "$tsize")"
  # Compactions in this session: real compact_boundary records (escaped copies in tool text don't match).
  # Counted incrementally: a cache keeps "bytes-read count", so each refresh scans only the new bytes.
  pat='"subtype":"compact_boundary"'
  cdir="$HOME/.claude/state/statusline"; cfile="$cdir/compacts-${tpath##*/}.txt"
  off=0 ncompact=0
  [[ -f "$cfile" ]] && read -r off ncompact < "$cfile"
  [[ "$off" =~ ^[0-9]+$ && "$ncompact" =~ ^[0-9]+$ ]] && (( off <= tsize )) || { off=0 ncompact=0; }
  if (( tsize > off )); then
    start=$(( off > 64 ? off - 64 : 0 ))
    new=$(tail -c +$(( start + 1 )) "$tpath" 2>/dev/null | grep -b -o -F "$pat" | awk -F: -v s="$start" -v o="$off" -v L="${#pat}" '{ if (s + $1 + L > o) n++ } END { print n + 0 }')
    ncompact=$(( ncompact + ${new:-0} ))
    mkdir -p "$cdir" 2>/dev/null && printf '%s %s\n' "$tsize" "$ncompact" > "$cfile" 2>/dev/null
  fi
  if (( ncompact == 0 )); then seg_ctx+=" ${GRAY}·${RST} ${GRAY}0 compacts${RST}"
  elif (( ncompact == 1 )); then seg_ctx+=" ${GRAY}·${RST} ${YELLOW}1 compact${RST}"
  else seg_ctx+=" ${GRAY}·${RST} ${YELLOW}${ncompact} compacts${RST}"; fi
fi

seg_dir="$TEAL$dir$RST"
case "$branch" in
  "") ;;
  main|master) seg_dir+="  ${RED}⎇ $branch${RST}" ;;
  develop|dev) seg_dir+="  ${YELLOW}⎇ $branch${RST}" ;;
  *) seg_dir+="  ⎇ $branch" ;;
esac

# ── Output ──
out=""
[[ -n "$seg_acct" ]] && out="$seg_acct$SEP"
(( SHOW_RC )) && out+="$seg_rc$SEP"
[[ -n "$seg_away" ]] && out+="$seg_away$SEP"
out+="$seg_model$SEP$seg_ctx"
[[ -n "$seg_lim5" ]] && out+="$SEP$seg_lim5"
[[ -n "$seg_lim7" ]] && out+="$SEP$seg_lim7"
out+="$SEP$seg_dir"
printf '%s' "$out"
