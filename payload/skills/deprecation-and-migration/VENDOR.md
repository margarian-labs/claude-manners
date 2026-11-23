# Vendor note

- Source: https://github.com/addyosmani/agent-skills, folder `skills/deprecation-and-migration`
- Commit: 8c99fa36d90068c82d547f7c12a9d67a3e95f4ee
- Licence: MIT, Copyright (c) 2025 Addy Osmani
- Installed as a manual-only skill: runs only when you type `/deprecation-and-migration`. The rest of the pack was not installed.

## Patches
- Replaced 16 long dashes with plain hyphens.
- Added a SQL Server online-index note next to the Postgres example.
- Removed the pointer to the `incremental-implementation` skill (not installed).
- Added `disable-model-invocation: true`.

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line.
