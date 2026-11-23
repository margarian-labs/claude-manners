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
