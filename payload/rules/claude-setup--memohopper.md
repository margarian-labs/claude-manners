<!-- claude-setup part: memohopper -->

# claude-setup rules: memohopper memory

Installed by claude-setup into ~/.claude/rules/ and loaded every session. Sync manages this file: if you edit it, sync keeps your edit and asks before any update.

## Memory: memohopper (primary)

memohopper (user-scope MCP server, every project) is my **primary** durable memory and knowledge graph. File memory (`~/.claude/projects/<dir>/memory/`) is secondary, an index only. The memohopper server injects its own store and recall rules every session; this section adds only my rules on top. Where they differ, these rules win.

**Workspace: always pass `workspace:` explicitly, picked from the folder you work in.** Fill in your own workspaces below; a project `CLAUDE.md` with its own `memohopper:rules` block overrides this table. Never call `create_workspace` without asking me first.

| Working in | Workspace |
|---|---|
{{MEMOHOPPER_WORKSPACES}}
| Anything not project-specific (tools, machines, accounts, cross-project rules) | a general workspace of mine |

- **Session start:** besides the server's `get_briefing`, call `list_tasks` for that workspace; mention only the relevant tasks, in 1-2 lines.
- **Store:** the verbs *store / save / remember / capture / "keep this"* mean memohopper (`remember`, or `ingest_text` for a whole document), not only a local file.
- **Tasks are our task list.** Keep to-dos there, not only in chat or local files; you may suggest, create and manage them. Create: my to-dos (decisions, approvals, keys, console clicks, manual deploys, reviews, contacting someone), unfinished work that spans sessions, ideas (tag `idea`), bugs found but not fixed (tag `bug`). Never in-session working steps.
  - Mode: I ask for it: `requested`, in my words. Your own ideas: `proposed`. Every other task you create: `added`.
  - Format: one imperative line (max 120 chars) a human understands without context; why in `details`; source in `links`; `workspace` per the table (omit if unsure); tags only from my existing list.
  - **Name a task by its text, never by its id or short `name`.** I don't see those in the app. In replies, pages, handoffs and questions, quote the task's text (shortened if long) and say where it sits (my list, or Proposals).
