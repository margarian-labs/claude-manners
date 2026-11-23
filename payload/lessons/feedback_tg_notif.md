---
name: telegram-notification-hook-implementation
description: Key facts about custom Telegram notification hook scripts in ~/.claude/hooks/ and how they avoid slowing Claude Code
metadata:
  type: feedback
---

Custom Telegram notification scripts live in `~/.claude/hooks/`, not in the `~/.claude/` root.

**Script layout:**
- `telegram-helpers.sh`: slim shared helpers: `load_config`, `extract_sid` (bash regex), `send_telegram`
- `telegram-process.js`: one Node.js file for all 3 modes (stop, notify, question): JSON parsing, markdown to HTML, truncation, message building, remote-control link extraction
- `telegram-stop.sh`: Stop event (dedup, 1 node call, curl)
- `telegram-notify.sh`: Notification event (dedup, 1 node call, curl)
- `telegram-question.sh`: PreToolUse / AskUserQuestion event (1 node call, curl)

**Performance: 1 Node.js spawn per hook.** `extract_sid` is a pure bash regex, so dedup checks need no Node spawn. The hooks call plain `node` from PATH, so the hook files are identical on every machine.

**Every hook forks to the background immediately:**
```bash
if [[ -z "$HOOK_BG" ]]; then
  echo "$INPUT" | HOOK_BG=1 bash "$0" &
  exit 0
fi
```

**`CLAUDE_TITLE_GEN=1` guard:** all hooks exit at once if this env var is set. This stops hooks from firing during `claude -p` subprocess calls.

**Remote-control session links:**
- All 3 hook types append an `<a href="...">Open session</a>` link to the Telegram message.
- Take `bridgeSessionId` from the `~/.claude/sessions/` JSON file that matches the current session.
- URL: `https://claude.ai/code/{bridgeSessionId}`

**`send_telegram` reads the message from stdin, not from a shell argument:**
```bash
printf '%s' "$msg" | curl ... --data-urlencode "text@-"
```
Never use `--data-urlencode "text=${MSG}"`. Bash expands `$variable` patterns inside the message and corrupts UTF-8.

**Stop hook order:** truncate the raw markdown first, then convert to HTML (both inside `telegram-process.js`).

**Dedup timings:**
- Stop: 20 s cooldown per session (stamp file `~/.claude/session/last_stop_{sid}`)
- Notify: skipped if Stop fired within 300 s (5 min) for the same session
- Question: no dedup

**JSON blob filter:** Stop mode skips messages that are only plugin or hook JSON (`should_continue` / `reasoning` blobs). They arrive raw or wrapped in a ```` ```json ```` fence. The filter strips the fence first, then parses and checks for those keys. This prevents spurious pings from continuation-style plugins.

**Machine label:**
- `~/.claude/telegram.conf` has `MACHINE_NAME="<label>"`, set per machine.
- `telegram-helpers.sh` exports it inside `load_config()`, after `source "$CONFIG"`.
- `telegram-process.js` reads `process.env.MACHINE_NAME` and builds `machineTag = ' [<label>]'` (or `''` if unset).
- All three title lines prepend it. The label is optional: nothing is shown when `MACHINE_NAME` is unset.

**Title format:**
```
&#9989;<i>[Label] Claude Responded</i>               <- stop
&#9203;<i>[Label] Claude needs your attention</i>    <- notify
&#10067;<i>[Label] Claude has a question</i>         <- question
```

**Why:** Each Node.js spawn costs about 50-100 ms on Windows, so 4-6 spawns per hook added 200-500 ms to every invocation. One spawn plus a background fork keeps Claude Code responsive. Remote links let the user open a session straight from Telegram. The machine label tells apart notifications from several machines that share one bot and chat.

**How to apply:** Keep all heavy work after the background fork. Never expand message content through shell arguments; pipe it via stdin. All markdown and HTML logic lives in `telegram-process.js`. The bash scripts stay thin wrappers: fork, dedup, call node, call curl. When changing titles, use `machineTag` (already resolved at the top of `processHook`).

Related: [[claude-settings-hooks]].
