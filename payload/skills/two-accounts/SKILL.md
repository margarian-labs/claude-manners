---
name: two-accounts
description: Use when changing the Claude Code setup on a PC with two Claude profiles (settings, hooks, skills, agents, MCP servers, plugins, rules), when installing a plugin or MCP server from a second-profile session, when a script reads per-account data, or when something from the other account fails.
---

# Two accounts: what is shared, and how to sync a setup change

Moved from the two-accounts rule on 2026-11-24. That rule names the two profiles: the main one in `~/.claude`, and the second profile's folder and start command.

- Shared by both (junctions from the second profile folder into `~/.claude`): `projects` (sessions, `/resume`, auto memory), `file-history`, `plans`, `tasks`, `skills`, `plugins`, `channels`, `ide`, plus `agents`, `commands`, `rules`, `output-styles` and similar when present. The second profile's `CLAUDE.md` only imports `~/.claude/CLAUDE.md`; edit rules there. Hooks, the statusline, git identity and files on disk are the same for both.
- `~/.claude/tools/sync-second-profile.mjs` runs before every start of the second profile: it refreshes the junctions, copies `settings.json` and `keybindings.json`, and mirrors MCP servers from the main profile. Change settings and MCP servers in the main profile only; edits made in the second profile get overwritten. From a second-profile session, run `claude plugin ...` / `claude mcp add ...` as `env -u CLAUDE_CONFIG_DIR claude ...` so installs land in the main profile (setting it to `~/.claude` instead writes to a stray `~/.claude/.claude.json` that the main profile ignores).
- Separate per account: login, plan and usage limits, `.claude.json`, up-arrow history, claude.ai artifacts and connectors (`mcp__claude_ai_*` tools), cloud sessions and routines, org policies. MCP servers that sign in with OAuth may need to be authorized once in each profile.
- Resuming a session started under the other account works, but sends that conversation to the current account and uses its limits.

## Sync a setup change
Every setup change (settings, hooks, skills, agents, MCP, plugins, rules): make it in `~/.claude` (the source of truth), run `node ~/.claude/tools/sync-second-profile.mjs --profile-dir <second profile folder>`, check it landed in the second profile folder (settings identical, new folder linked, MCP server listed); say both accounts have it.
- A new kind of folder or file Claude Code reads from its own config dir: add it to the sync script's link or copy lists.
- Scripts must not hard-code `~/.claude` for per-account data (usage files, `sessions`): use `CLAUDE_CONFIG_DIR` or look in both profiles.
- Account-bound things (claude.ai connectors, artifacts, routines, cloud sessions, org policies) can't be synced: say which part reaches only one account.
