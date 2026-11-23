# Vendor note

- Source: https://github.com/nutlope/hallmark, folder `skills/hallmark`
- Commit: 04977e1 (read line by line on 2026-11-20 before install)
- Licence: MIT (see LICENSE)
- Installed as a manual-only skill (`disable-model-invocation: true`): runs only when you type `/hallmark`.

## Patches
- Removed `scripts/imagegen.mjs`, `references/comp.md` and `scripts/fixtures/imagegen/`: they sent prompts to the Together AI image API when `TOGETHER_API_KEY` was set.
- Removed `scripts/install.mjs`, `scripts/install-hook.mjs`, `scripts/lint-hook.mjs`: installer and edit-time hook writer.
- SKILL.md, `references/flow.md`, `references/imagery.md`: removed the lines that pointed at those files (signal 9 comp step, edit-time hook, generated stills).
- Added `disable-model-invocation: true`.

## Known behaviour
- Built pages load Google Fonts and Wikimedia photos in the visitor's browser (public reads).
- May try `npm i puppeteer-core` for its own browser check.
- Writes `.hallmark/` (log with a short prompt summary), `tokens.css`, `base.css` and a stamp comment at the top of the CSS in the project.

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line. Claude asks the user before using it (cost).
