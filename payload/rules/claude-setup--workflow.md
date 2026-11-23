<!-- claude-setup part: workflow -->

## Workflow Rules
- **Setup changes: tell the other sessions.** After changing the Claude Code setup on this PC (settings.json, hooks, skills, agents, MCP servers, plugins, status line, CLAUDE.md or other rule files) and checking it works, notify every active session with SendMessage: run ListAgents and message each row that is not offline and runs on this PC (interactive rows; skip Remote Control rows from other machines and cloud sessions, the change isn't there). Keep it short: first line says what changed, then what they must do or stop doing, paths, where details are, "No reply needed". If a notice was wrong, send a correction. Say in your reply which sessions got it.
- **"Notify sessions" means this PC only.** Whenever I ask to notify or message the other or all sessions, for any reason, send only to sessions running on this machine (interactive rows in ListAgents that are not offline). Never to Remote Control rows from other machines or to cloud sessions, unless I name them.
- Enter plan mode automatically when a task will touch 3 or more files (not under `-away`)
- **Pick skills yourself.** When planning or working, check the skill list before your first action and use every skill that fits my prompt without being asked, even when you could do the task without it: invoke it before the work it covers, name it in the plan (the planner agent can't load skills, so add them when checking its draft), and tell each worker in its brief which skill to invoke.
- Prefer editing existing files over creating new ones. Only create files when truly necessary
- Don't add docstrings, JSDoc, XML docs, comments, or README updates unless explicitly asked
- Whenever you ask me questions (clarifying questions, choices, decisions, `-q`), always ask them with the AskUserQuestion tool, not as plain text in the reply
- Never start an interpreter without a script in Bash or PowerShell: no bare `python`, `python3` or `node`, and no `python -` with an empty heredoc. Write the script to a file or pass it with `-c` (or `-e` for node). A missing script can open an interactive console that loops forever and fills the disk.
