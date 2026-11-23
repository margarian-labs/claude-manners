# Setup pack rules: two accounts (optional)

Installed by the setup pack into ~/.claude/rules/setup-pack/. Fill the {{...}} placeholders at install.

## Claude accounts (two profiles on this PC)
- Two Claude logins, both signed in at once through `CLAUDE_CONFIG_DIR`:
  - `claude` = {{MAIN_LABEL}} (`{{MAIN_EMAIL}}`), main profile `~/.claude`.
  - `claude {{SECOND_FLAG}}` = {{SECOND_LABEL}} (`{{SECOND_EMAIL}}`), second profile `~/{{SECOND_DIR}}`. `{{SECOND_FLAG}}` is a shell wrapper in the bash and PowerShell profiles, not a Claude Code flag; lowercase `-p` stays print mode. Other shells (cmd.exe) and IDE extensions open the main profile only.
- Shared by both (junctions from `~/{{SECOND_DIR}}` into `~/.claude`): `projects` (sessions, `/resume`, auto memory), `file-history`, `plans`, `tasks`, `skills`, `plugins`, `channels`, `ide`, plus `agents`, `commands`, `rules`, `output-styles` and similar when present. `~/{{SECOND_DIR}}/CLAUDE.md` only imports `~/.claude/CLAUDE.md`; edit rules there. Hooks, the statusline, git identity and files on disk are the same for both.
- `~/.claude/tools/sync-second-profile.mjs` runs before every `claude {{SECOND_FLAG}}`: it refreshes the junctions, copies `settings.json` and `keybindings.json`, and mirrors MCP servers from the main profile. Change settings and MCP servers in the main profile only; edits made in the second profile get overwritten. From a second-profile session, run `claude plugin ...` / `claude mcp add ...` as `env -u CLAUDE_CONFIG_DIR claude ...` so installs land in the main profile (setting it to `~/.claude` instead writes to a stray `~/.claude/.claude.json` that the main profile ignores).
- Separate per account: login, plan and usage limits, `.claude.json`, up-arrow history, claude.ai artifacts and connectors (`mcp__claude_ai_*` tools), cloud sessions and routines, org policies. MCP servers that sign in with OAuth may need to be authorized once in each profile. If something from the other account fails, say it is likely the account split instead of debugging it.
- Resuming a session started under the other account works, but sends that conversation to the current account and uses its limits.
- Active account: from the `userEmail` context if present, or what the user last said; if unclear, ask.
- **Keep both accounts in sync, always.** Every new or changed rule, setting, hook, skill, agent, plugin, MCP server, tool or other setup must reach both profiles.
  - Make the change in `~/.claude` (the source of truth), then run `node ~/.claude/tools/sync-second-profile.mjs --profile-dir {{SECOND_DIR}}` and check it landed in `~/{{SECOND_DIR}}` (settings identical, new folder linked, MCP server listed).
  - A new kind of folder or file Claude Code reads from its own config dir: add it to the sync script's link or copy lists.
  - Scripts must not hard-code `~/.claude` for per-account data (usage files, `sessions`): use `CLAUDE_CONFIG_DIR` or look in both profiles.
  - Account-bound things (claude.ai connectors, artifacts, routines, cloud sessions, org policies) can't be synced: say which part reaches only one account.
  - In the reply, say that both accounts have the change.
- On one account, never use the other account's org resources (artifacts, docs, connectors, routines, cloud sessions), and no workarounds. When a step needs the other account, say so and stop at that step.
