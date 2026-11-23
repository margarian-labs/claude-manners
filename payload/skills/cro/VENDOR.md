# Vendor notes: cro

- Source repo: https://github.com/coreyhaines31/marketingskills
- Source path: skills/cro
- Commit: 73573e94a06a39965978b3fa1f9c1eace8cebc7c
- License: MIT License, Copyright (c) Corey Haines
- Not copied: evals/ folder

## Patches applied

- All files: converted CRLF to LF; ran dashfix (4 dashes replaced with plain punctuation/hyphens in 2 files).
- SKILL.md: added `disable-model-invocation: true` after `description:`.
- SKILL.md: removed pointers to signup, onboarding, popups and ab-testing from the description.
- SKILL.md (Reference Routing): ab-testing pointer replaced with one plain sentence of test-design advice.
- SKILL.md (Initial Assessment): questions now go through AskUserQuestion, one round, only what files/context cannot answer.
- SKILL.md (Task-Specific Questions): same AskUserQuestion rule.
- SKILL.md (Output Format): recommendations first, brief rationale; added "do not end with offers of next steps or follow-up questions".
- SKILL.md (Related Skills): kept copywriting; removed signup, popups, ab-testing.
- SKILL.md (Form Optimization): removed the revops playbook link (external repo link and a skill not installed); kept the plain advice.
- references/form.md: AskUserQuestion rule in Initial Assessment and Task-Specific Questions.
- references/form.md: removed named enrichment tools (HubSpot Breeze, Clay, Apollo) from the Company field.
- references/form.md (Output Format): recommendations first, no offers of next steps.
- references/form.md (Related Skills): kept cro; removed signup, popups, ab-testing.
- references/experiments.md: no changes (beyond line endings).

- 2026-11-20: made model-invocable at the user's request (removed `disable-model-invocation`); description replaced with a short trigger line.
