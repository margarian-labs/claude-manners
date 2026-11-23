---
name: design-md
description: "Use when starting a new project or site that has no design system yet and needs a look, or when the user asks for a brand style (like Linear, Stripe, Notion): writes a DESIGN.md from 84 brand-inspired systems. Args: list | <brand>. Not for projects that already have a design system (Angular Material, tokens, DESIGN.md)."
argument-hint: "list | <brand>"
---

# design-md

84 DESIGN.md files that describe the look of well-known products (colour tokens, type, spacing, radius, elevation, components). They are inspired readings, not official brand kits. Folder: `$HOME/.claude/skills/design-md/`.

## `/design-md list` (or no argument)

Read `INDEX.md` and show the names with their one-line look, grouped loosely (fintech, dev tools, consumer, automotive, media, other). Read no brand file yet.

## `/design-md <brand>`

1. Find `brands/<brand>.md` (match the folder name loosely, for example "linear" finds `linear.app.md`). If nothing matches, show the three closest names from `INDEX.md`.
2. Read only that one file.
3. If the project root already has a `DESIGN.md` or `design.md`, ask with AskUserQuestion: replace it, merge the new tokens into it, or stop.
4. Write the project's `DESIGN.md` from the brand file, adapted:
   - Replace the brand's name, product names and slogans with the user's project.
   - Proprietary fonts become the free substitute the file names in its "Font Substitutes" note.
   - No logos, wordmarks, mascots or trademarked phrases; never present the result as the brand's own.
   - Keep the tokens (colours, spacing, radius, shadows, motion) and component rules.
   - Add one line at the top: `Inspired by <brand>'s public design language (via awesome-design-md, MIT).`
5. Then build or restyle with the `ui-craft` rules; the DESIGN.md is now the project's design system and wins over defaults.

## Notes

- The files were written from public websites by the awesome-design-md contributors; values are their reading and may not match the live brand.
- Source and licence: `VENDOR.md`.
