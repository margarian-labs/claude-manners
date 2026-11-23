---
name: claude-settings-hooks
description: Gotchas for the status line and Telegram hook config; settings.json itself is the source of truth
metadata:
  type: reference
---

`~/.claude/settings.json` is the source of truth for plugins, hooks and permissions. Read it instead of trusting a copy in memory.

**Why:** A remembered copy of the settings goes stale. Acting on it means giving wrong answers or editing the wrong thing.

**How to apply:**
- Status line (`~/.claude/statusline.sh`): the context token count is the sum of the `context_window.current_usage` fields (input, output, cache creation, cache read). When they are missing, it falls back to `used_percentage` x `context_window_size` / 100.
- Telegram hook config is `~/.claude/telegram.conf` (bot token, chat id, `MACHINE_NAME`). Hook scripts live in `~/.claude/hooks/`, not in the `~/.claude` root.
- A hook error that names a script from a plugin you removed (for example an `emit-event.sh` that no longer exists) is a leftover registration. Remove the stale hook entry instead of debugging the script.
- Do not re-add a plugin or a status line element (a cost display, for example) that was removed on purpose, unless the user asks.

Related: [[telegram-notification-hook-implementation]].
