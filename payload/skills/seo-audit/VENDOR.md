# Vendor notes: seo-audit

- Source: https://github.com/coreyhaines31/marketingskills, path `skills/seo-audit`
- Commit: 73573e94a06a39965978b3fa1f9c1eace8cebc7c
- License: MIT License, Copyright (c) Corey Haines

## Files left out
- `evals/` (whole folder)
- `references/ai-writing-detection.md`

## Patches applied
- All files: em and en dashes replaced with hyphens (tools/dashfix.mjs, 17 dashes in 3 files).
- SKILL.md: added `disable-model-invocation: true` after `description:`.
- SKILL.md: removed pointers to programmatic-seo, schema and ai-seo from the description.
- SKILL.md: "Before auditing" questions and Task-Specific Questions now use AskUserQuestion, one round, only unanswered questions.
- SKILL.md: removed `curl` from the schema detection limitation note.
- SKILL.md: removed the ai-writing-detection entry and the ai-seo pointer from References.
- SKILL.md: Output Format now says findings first, brief evidence, no closing offers.
- SKILL.md: "Related Skills" reduced to cro (removed ai-seo, link-building, programmatic-seo, site-architecture, schema, analytics).
- references/rankings-push.md: removed link-building and marketing-loops references, the `schema` pointer, and the "Run it on a schedule" section.
- references/local-seo.md: questions use AskUserQuestion; removed directory-submissions and referrals pointers; replaced the skill-routing list (site-architecture, programmatic-seo, schema, ai-seo) with one plain paragraph; output list reordered so the artifact comes first; no closing offers.
- references/local-seo-pages-and-measurement.md: removed programmatic-seo, site-architecture and schema pointers.
- Not changed: title-tags.md, international-seo.md, local-seo-profile-and-citations.md (nothing to patch).

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line.
