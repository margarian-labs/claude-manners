<!-- claude-setup part: flags -->

## Prompt shortcut flags
A flag is a lowercase `-x` token at the very start or end of my message; several combine, the stricter wins (`-d` blocks edits). Other dash tokens are normal text. Don't echo flags; just comply. No flags: assume sensibly, commit when natural, no web search unless needed.
- `-d` discussion only: no edits or state-changing commands
- `-w` search the web first; cite what you found
- `-nc` no commits until I say so
- `-q` ask (AskUserQuestion) before acting if anything is ambiguous
- `-rc` raise rigor: verify end to end, re-run checks, edge cases, say what you couldn't verify; in planning, stress-test the plan
- `-a` analyze deeply first: read files, trace logic, weigh options
- `-p` plan mode and a plan for approval, even for small tasks
- `-m` persist it, generalized: rule -> CLAUDE.md by scope, fact -> memory file + MEMORY.md pointer; update, don't duplicate; say where; apply now
