# START: set up claude-setup on this PC

You are Claude Code, and the person opened you inside a clone of this repo. Follow these steps in order. Ask every question with AskUserQuestion. Plain, short English. Do not change anything outside what a step says.

## 1. Check the PC

Run each check with Bash and tell the person what is missing. If anything is missing, stop and say how to fix it. Do not install anything yourself.

| Needed | Check | If missing |
|---|---|---|
| Windows 10 or 11 | `uname -s` prints something starting with `MINGW` or `MSYS` | This setup is for Windows |
| Git for Windows (Git Bash) | `git --version` | Install Git for Windows from git-scm.com, then reopen Claude Code |
| Node 18 or newer | `node --version` prints v18 or higher | Install Node LTS from nodejs.org |
| Claude Code | `claude --version` | Install Claude Code, then reopen it |
| The sync tool can start Claude Code | `node -e "import('./sync/lib/conditions.mjs').then((m) => { const r = m.defaultRun('claude', ['--version']); console.log(r.error ? r.error.message : r.stdout.trim()); process.exit(r.error ? 1 : r.status); })"` prints the version | Show the person the message and stop: the sync tool could not start Claude Code the way it is installed |
| Access to this repo | `git fetch --tags` inside this clone finishes without an error | Check your internet connection and that this clone came from https://github.com/margarian-labs/claude-setup.git |

## 2. Install the sync tool

First tell the person what this step does, then run it: it installs the sync tool and the claude-setup-sync skill, nothing else. Read `catalog/sync-engine.json` and say its `summary` and its always-on cost (`tokens_always_on.value` tokens in every session).

From the root of this clone, run:

```
node sync/sync.mjs bootstrap --repo . --json
```

It installs only the sync tool and the claude-setup-sync skill into your Claude config folder, and remembers where this clone is. It changes nothing else. A backup of anything it replaces is kept.

If it exits with code 2, read `questions`, ask the person, and run it again with the answer. If it exits with 1, show the error and stop.

## 3. Start the skill

Tell the person: "The sync tool is installed. I will now show you the menu of parts. Nothing is installed until you say so."

Then invoke the `claude-setup-sync` skill (if it is not listed yet, tell the person to start a new Claude Code session in this clone and say "sync my setup"). Follow it: it first lists the parts you already have, then asks about every other part on its own. Each question says what the part is, what it solves, its use cases, what it changes on the PC and what it costs. Then it installs what you chose and gives a short report.

## If the person already used the older setup pack

If the folder `rules/setup-pack` exists in their Claude config folder, they installed the older pack. After step 2, run `node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools/claude-setup/sync/sync.mjs" adopt --plan --json`, name every part it found (the `part_list` in the result: title, what it is, how many files it brings up to date), say what it would keep, and ask whether to take it over. If yes, run the same command without `--plan` before the menu. It keeps their files and edits, backs up and removes the old rules folder, installs the new rule files and brings the files of the parts it takes over up to date.

## Later

- Update: say "sync my setup".
- Go back: say "roll back my last sync", or "go back to version <tag>".
