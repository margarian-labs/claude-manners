# Vendor notes: social

- Source: https://github.com/coreyhaines31/marketingskills, path `skills/social`
- Commit: 73573e94a06a39965978b3fa1f9c1eace8cebc7c
- License: MIT License, Copyright (c) Corey Haines

## Files left out
- `evals/` (whole folder)
- `references/listening.md`
- `references/listening-sources-template.md`
- `references/reverse-engineering.md`

## Patches applied
- All files: em and en dashes replaced with hyphens (tools/dashfix.mjs, 117 dashes in 6 files).
- SKILL.md: added `disable-model-invocation: true` after `description:`.
- SKILL.md: removed "listening" from the description; removed pointers to content-strategy, ad-creative, public-relations.
- SKILL.md: context-gathering and Task-Specific Questions now use AskUserQuestion, one round, only unanswered questions.
- SKILL.md: dash rule in "No AI Tells" is a full ban (period, comma, colon or parentheses).
- SKILL.md: emoji bullet example replaced with a no-emoji rule (removed the emoji).
- SKILL.md: ship-post summary says the developer is asked with AskUserQuestion.
- SKILL.md: removed the pointer to the cold-email skill and the pointer to references/listening.md (with its curl recipes note).
- SKILL.md: deleted the "Publishing From Your Agent" section (scheduler products, MCP/API posting, tools registry link).
- SKILL.md: deleted the "Reverse Engineering Viral Content" section and its pointer.
- SKILL.md: added a short "Output Format" section (deliverable first, brief rationale, no closing offers).
- SKILL.md: "Related Skills" reduced to copywriting plus one plain sentence; removed launch, reverse-engineer-marketing, emails, marketing-psychology, designskills and collateral-design.
- references/ship-post.md: removed pointers to launch, analytics, community-marketing and the "Publishing From Your Agent" steps; the one question uses AskUserQuestion; dash rule is a full ban; emoji ban.
- references/platforms.md: removed the pointer to the influencer-marketing skill and its Telegram channels link.
- references/carousel-frameworks.md: removed the pointer to reverse-engineering.md.
- references/short-form-video.md: removed pointers to ad-creative, influencer-marketing and reverse-engineering.md; deleted the "Post Once, Publish Everywhere" section (scheduler products and API/MCP posting).
- Not changed: platform-limits.md, post-templates.md, x-algorithm.md (nothing to patch).

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line.
