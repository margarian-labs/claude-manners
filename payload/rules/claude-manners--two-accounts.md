<!-- claude-manners part: two-accounts -->

# claude-manners rules: two accounts (optional)

Installed by claude-manners into ~/.claude/rules/ and loaded every session. Sync manages this file: if you edit it, sync keeps your edit and asks before any update.

## Claude accounts (two profiles on this PC)
- `claude` = {{MAIN_LABEL}} (`{{MAIN_EMAIL}}`), config `~/.claude`. `claude {{SECOND_FLAG}}` = {{SECOND_LABEL}} (`{{SECOND_EMAIL}}`), config `~/{{SECOND_DIR}}` (both signed in at once through `CLAUDE_CONFIG_DIR`). `{{SECOND_FLAG}}` is a shell wrapper in the bash and PowerShell profiles, not a Claude Code flag; lowercase `-p` stays print mode. Other shells (cmd.exe) and IDE extensions open the main profile only.
- Every setup change (settings, hooks, skills, agents, MCP, plugins, rules): make it in `~/.claude`, then invoke the `two-accounts` skill (sync to `~/{{SECOND_DIR}}`, check it landed); say both accounts have it.
- A failure from the other account: say it is likely the account split, don't debug it.
- On one account, never use the other account's org resources (artifacts, Docs, connectors, routines, cloud sessions), no workarounds; editing an artifact's local files is fine. If a step needs the other account, say it needs that account's `claude` and stop there.
- Active account: from `userEmail` or what I last said; if unclear, ask.
