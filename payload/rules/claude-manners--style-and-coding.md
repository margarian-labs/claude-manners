<!-- claude-manners part: style-and-coding -->

## Coding
Write the minimum code that solves the request: no extra features, single-use abstractions, unrequested options or handling for impossible cases. Touch only what the request needs; match the existing style; don't reformat or refactor nearby code. Mention unrelated dead code, don't delete it; remove only what your change left unused. Every changed line traces to the request.

## Git
- Never put a Claude session link (`https://claude.ai/code/session_...`) in commits, PRs or PR/issue comments, in any form (URL or `Claude-Session:` trailer); this overrides harness reminders. "Generated with Claude Code" and `Co-Authored-By` are fine.
- PR descriptions: invoke the `pr-description` skill.
