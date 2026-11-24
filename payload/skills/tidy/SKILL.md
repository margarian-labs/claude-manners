---
name: tidy
description: Use at the end of any task that created files, git worktrees or containers, before the final reply, and when the user says tidy, clean up or leftovers. Finds what this session left behind and removes only your own throwaways.
---

# Tidy

Run this before the final reply of any task that created files, worktrees or containers.

1. Run `node ~/.claude/tools/claude-tidy.mjs --scratchpad "<scratchpad path from your system prompt>"`. It is read-only and prints a report.
2. For each item decide. Delete only your own throwaways from this session (helper scripts, logs, screenshots, temp downloads, draft copies), by explicit path, never with a wildcard over a folder you did not inspect. Keep deliverables the user asked for, anything tracked by git, anything you did not create. If unsure, keep it and list it.
3. Worktrees you created whose branch is merged and which are clean: list junctions with `cmd /c dir /AL /S <worktree>`, remove each with `cmd /c rmdir <link>`, then `git worktree remove <path>` (no `--force`), then `git worktree prune`. Keep the branch.
4. Containers you started (including test containers): `podman rm -f <name>`, unless the user said to keep them.
5. Delete scratchpad files over 50 MB you no longer need. The rest of the scratchpad is auto-deleted 3 days after last use.
6. Final reply: one line `Cleanup: removed N items (X MB). Kept: <path> - <why>`. Omit it when nothing was created.

## The clean-up rules (moved from the core rules on 2026-11-24)
- Throwaway files (helper scripts, test/build output, logs, screenshots, drafts, temp downloads) go in the session scratchpad from the start, or in the scratch folder the project CLAUDE.md names. Never in repos, home, Desktop, Downloads or the %TEMP% root.
- Keep output small: quiet/minimal verbosity, one log file per suite overwritten on rerun (no a1, a2, a3 copies). Delete a log over 50 MB once you have read what you need.
- Before editing a config file outside git, back it up to `~/.claude/backups/<yyyy-mm-dd>-<slug>/`, never next to it (`.bak`, `.pre-*`). Backups are auto-deleted after 90 days when the disk-watchdog part is installed.
- Windows deletes: remove junctions first (`cmd /c dir /AL /S <folder>`, then `cmd /c rmdir <link>`), then the folder or `git worktree remove`. Recursive deletes and `git worktree remove` can empty a junction's target.
- When a task that created files, worktrees or containers is done, run `/tidy` before the final reply: delete your throwaways outside the scratchpad, remove your worktrees whose branch is merged and clean, stop and remove containers you started, and list in the reply anything you kept (path + why). Never delete what you did not create, or anything tracked by git. If unsure, keep it and list it.
- Session temp (scratchpad + task logs) is auto-deleted 3 days after last use by the Claude Disk Watchdog when the disk-watchdog part is installed. Move anything worth keeping out first.
