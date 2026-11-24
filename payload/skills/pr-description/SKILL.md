---
name: pr-description
description: Use when writing or editing a pull request description (gh pr create, gh pr edit, /ship, or a PR body a worker will write): the two-part format, "In plain words" first, then "For the review".
---

# PR descriptions

Moved from the style-and-coding rules on 2026-11-24.

- **PR descriptions: two parts, with fixed headings, informative but short, straight and human readable.**
  1. **`## In plain words`, first.** For anyone, including a non-technical reader: what the PR holds, what changed, why, and what it fixes, improves or adds. At most about 8 short lines or bullets. No file names, code, commands or jargon. A trivial PR (a typo, a link) needs one plain sentence.
  2. **`## For the review`, after it.** Only what a reviewer needs, as a few short bullets: the key changes, how it was checked, anything unverified or waiting on someone. Keep the sections the repo's PR template requires and functional lines (`Affects:`, ticket keys, links), one line each, inside this part.
  - Both parts: no walls of text, no file-by-file retelling of the diff, no long tables.

Never put a Claude session link in the description (see the Git rule in the style-and-coding rules).
