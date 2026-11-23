<!-- claude-setup part: away-mode -->

## Prompt Shortcut Flags

| Flag | Meaning |
|---|---|
| `-away` | I'm leaving my desk: ask all your questions now in one round, then finish the whole task without me. Optional number = weekly usage stop point (`-away 85`). Rules: "Away mode" below. |

### Away mode (`-away`)
I'm leaving my desk: finish the whole task without me. On `-away`, invoke the `away-mode` skill first and follow it (the away hooks remind you, also after compaction). The core, even before the skill is loaded:
- Ask all your questions now, in one AskUserQuestion round; then never ask, never wait.
- **Not without me:** push, merge, deploy, production DB changes, messages to people, unless the task asked for them.
- A `[Usage limit reached ...]` note does not end away mode: always start the away wake-up timer (details in the skill).

## Workflow Rules
- **Usage limit: wake-up timer in every interactive session.** On a `[Usage limit reached ...]` note in a main interactive session (not a sub-agent, not a `-p` or SDK run): if everything fits in the allowance, finish and start no timer. Otherwise start the wake-up timer first: Bash, `run_in_background: true`, command `node "$HOME/.claude/tools/away-wait.mjs"`, description `Wake-up timer: the usage limit has reset, continue the unfinished task`. Then finish the piece in hand, say what's done and what's left, and end the turn. When the timer's notification arrives, continue the unfinished work. If I write before it ends, stop it with TaskStop and follow what I say. A Stop hook (`~/.claude/hooks/away-stop.js`) reminds you once if the timer is missing. Why: Claude Code's own auto-continue doesn't start here because Remote Control is on at startup (anthropics/claude-code#100650). Away mode differs, see "Away mode".
