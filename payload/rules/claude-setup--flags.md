<!-- claude-setup part: flags -->

## Prompt Shortcut Flags

Short flags in my message change how you handle it. Scan every message for them before doing anything else.
- A flag is a lowercase token starting with one `-`, at the very start or very end of the message, separated by spaces or commas. Several can combine (`-d -q`, `-w, -rc`): apply all of them. When two conflict, the more restrictive wins (`-d` blocks edits).
- Anything else is normal text: unknown or wrong-format tokens (`-1`, `--verbose`, `-Q`) and flags mentioned mid-sentence. Don't echo or announce flags; just comply.
- No flags: make reasonable assumptions and proceed, commit when natural, no web search unless needed.

| Flag | Meaning |
|---|---|
| `-d` | Discussion only: no plan, no file edits, no commands that change state. Read-only lookups are fine. |
| `-w` | Search the web first; cite or summarize what you found. |
| `-nc` | No `git commit` (or anything that creates a commit) for the rest of the conversation, until I say so. Other git work is fine. |
| `-q` | If anything is ambiguous, ask before acting. |
| `-rc` | Raise rigor: verify end to end, re-read changed files, re-run checks, check edge cases, say what you could not verify. In planning: research deeper and stress-test the plan. |
| `-a` | Analyze deeply before answering: read the files, trace the logic, weigh alternatives. No first-impression answers. |
| `-p` | Enter plan mode and present a plan for approval, even for small tasks. |
| `-m` | Persist it permanently, generalized: a behavioral rule goes to `CLAUDE.md` (global or project, by scope); a fact goes to a memory file plus a `MEMORY.md` pointer. Update an existing entry instead of duplicating; ask if the place isn't obvious. Say where you saved it, and apply it now too. |
| `-nb` | New branch before the work: `git fetch origin --prune`; base = the one that exists of `develop`, `dev`, `main`, `master`, `trunk` (more than one: ask me); `git stash push -u` if dirty; `git switch -c <name> origin/<base>`; `git stash pop` and report conflicts. Name: the ticket key plus a slug (`ABC-1234-short-slug`), else a kebab slug of the task. Never push or set upstream unless asked. Not a git repo: say so and stop. No branch under `-d`, or under `-p` before the plan is approved. |

Examples: `fix the failing test -q` asks which test or fix first if unclear. `-nb implement the CSV export ABC-4900` creates `ABC-4900-implement-csv-export`, then works there. `-nb -p refactor the voyage store` presents the plan (naming the branch) and creates the branch only after approval.
