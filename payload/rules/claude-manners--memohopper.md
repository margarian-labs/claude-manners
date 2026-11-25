<!-- claude-manners part: memohopper -->

# claude-manners rules: memohopper memory

Installed by claude-manners into ~/.claude/rules/ and loaded every session. Sync manages this file: if you edit it, sync keeps your edit and asks before any update.

## Memory: memohopper (primary)

memohopper is my primary memory; file memory is only an index. Its server adds its own rules; mine win where they differ.

- Always pass `workspace:` by the folder you work in (fill in your own workspaces in the table). A project `CLAUDE.md` with its own `memohopper:rules` block overrides the table. Never `create_workspace` without asking.

| Working in | Workspace |
|---|---|
{{MEMOHOPPER_WORKSPACES}}
| Anything not project-specific (tools, machines, accounts, cross-project rules) | a general workspace of mine |

- Session start: besides `get_briefing`, `list_tasks` for the workspace; mention relevant tasks in 1-2 lines.
- "store / save / remember / capture / keep this" mean memohopper.
- Tasks are our to-do list: my to-dos (decisions, approvals, keys, console clicks, manual deploys, reviews, contacting someone), cross-session work, ideas (tag `idea`), unfixed bugs (tag `bug`); never in-session steps. Mode: I asked -> `requested` (my words); your idea -> `proposed`; else `added`. One imperative line (max 120 chars), why in `details`, source in `links`, tags only from my list. Name tasks by their text and where they sit (my list, or Proposals), never by id or short `name`.
