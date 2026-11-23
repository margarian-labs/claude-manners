# Vendor note

- Source: https://github.com/VoltAgent/awesome-design-md, folder `design-md/<name>/DESIGN.md`
- Commit: fcc70284932276d085f01ef9f83edde90b1258cb (2026-10-28)
- Licence: MIT, Copyright (c) 2026 VoltAgent (see LICENSE)
- Installed as a manual-only skill: runs only when you type `/design-md`.

## Changes
- Copied the 84 `DESIGN.md` files to `brands/<name>.md`; left out the per-brand README files (they only link to the vendor's website).
- Replaced 6,815 long dashes with plain hyphens.
- Added `INDEX.md` (one line per brand, built from each file's description) and `SKILL.md`.
- Replaced the step "Run `npx @google/design.md lint DESIGN.md` after edits" (34 places) with a plain re-read check, so nothing runs from npx.

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line.
