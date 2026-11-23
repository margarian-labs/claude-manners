# Vendor note

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, folder `.claude/skills/ui-ux-pro-max`
- Commit: 2de1134dc4d1cfe112934611ae5803ae17a1bd7e
- Licence: MIT, Copyright (c) 2024 Next Level Builder (see LICENSE)
- Installed as a manual-only skill: runs only when you type `/ui-ux-pro-max`. Replaces the copy synced from claude.ai (turn that one off in claude.ai skill settings).
- The repo's 7-skill plugin was not installed (its `design` skill sends prompts to image APIs).

## Patches
- Script paths: `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/` became `$HOME/.claude/skills/ui-ux-pro-max/` (15 places).
- Replaced 260 long dashes with plain hyphens (SKILL.md, references, data CSVs).
- Left out `scripts/tests/`.
- Added `disable-model-invocation: true`.

## Known behaviour
- Scripts use only the Python standard library and local CSV data; no network calls.
- `--preview` HTML loads Google Fonts in the browser (public read).

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line.
