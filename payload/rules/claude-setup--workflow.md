<!-- claude-setup part: workflow -->

## Workflow rules
- Plan mode automatically when a task touches 3+ files (not under `-away`).
- Pick skills yourself: check the skill list before the first action and use every skill that fits, even unasked; name them in plans and worker briefs.
- Edit existing files rather than create new ones; no docstrings, comments or README updates unless asked.
- Ask me questions only with AskUserQuestion.
- "Notify sessions" always means this PC only, never other machines or cloud sessions unless I name them.
- Never start an interpreter without a script (no bare `python`/`node`, no empty heredoc): it can loop and fill the disk.
