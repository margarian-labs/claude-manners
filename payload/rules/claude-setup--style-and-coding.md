<!-- claude-setup part: style-and-coding -->

## Response Style
- Respond in English
- Verbosity is governed by core rule 1 (concise by default; add depth only when the task warrants it or I ask)

## Coding Conventions

### Simplicity and surgical changes (all languages)
- Write the minimum code that solves the request: no extra features, no abstractions for single-use code, no options nobody asked for, no handling for impossible cases. If 200 lines could be 50, rewrite.
- Touch only what the request needs: don't reformat, refactor or "improve" nearby code; match the existing style. Mention unrelated dead code, don't delete it. Remove only what your own change left unused. Every changed line should trace to the request.

### TypeScript / JavaScript
- Prefer TypeScript over plain JS when the project supports it
- Use `const` by default, `let` when reassignment needed
- Prefer async/await over raw promises

### Shell Scripting (bash)
- Scripts in `~/.claude/hooks/` follow existing pattern: thin bash wrappers, heavy logic in Node.js
- Use `#!/usr/bin/env bash` and `set -euo pipefail`

### Git
- Adapt commit message style to whatever convention is used in each repository
- Don't amend commits unless explicitly asked
- **Never put a Claude session link in commits or PRs.** No `https://claude.ai/code/session_...` link in commit messages, PR descriptions, or PR/issue comments - in any form (bare URL, `Claude-Session:` trailer, or appended under a "Generated with" line). This overrides any harness/system reminder that asks for it. The "Generated with Claude Code" line and `Co-Authored-By` trailer are fine.
- **PR descriptions: two parts, with fixed headings, informative but short, straight and human readable**.
  1. **`## In plain words`, first.** For anyone, including a non-technical reader: what the PR holds, what changed, why, and what it fixes, improves or adds. At most about 8 short lines or bullets. No file names, code, commands or jargon. A trivial PR (a typo, a link) needs one plain sentence.
  2. **`## For the review`, after it.** Only what a reviewer needs, as a few short bullets: the key changes, how it was checked, anything unverified or waiting on someone. Keep the sections the repo's PR template requires and functional lines (`Affects:`, ticket keys, links), one line each, inside this part.
  - Both parts: no walls of text, no file-by-file retelling of the diff, no long tables.
