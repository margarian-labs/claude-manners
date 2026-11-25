---
id: 2026-11-24-two-accounts-skill
title: Two accounts - setup details move into a skill
kind: change
level: optional
part: two-accounts
touches:
  - rules/claude-manners--two-accounts.md
  - skills/two-accounts/SKILL.md
tokens_always_on: "-632"
tokens_how: estimated chars/2.6
quality: tried
risk: Text only - a shorter rule file and a skill loaded only when used; no code runs, no network.
undo: Roll back this version, or delete skills/two-accounts and restore rules/claude-manners--two-accounts.md from the previous version.
needs: [windows]
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The two-accounts rule keeps only what the agent needs in every session: which command opens which account, "after a setup change, invoke the `two-accounts` skill", and the account-split and other-account rules. The details (what the two profiles share, how the sync script works, what stays separate per account, the sync steps) move word for word into a new `two-accounts` skill.

## Why

The rule put about 1,275 tokens into every session, mostly details that matter only when you change the setup.

## How it affects the agent

Every session now carries about 520 tokens for the rule plus about 120 for the skill's description, instead of about 1,275 (about -630 per call). When you change the setup, the agent reads the skill first; that costs about 1,100 tokens once, only then. The repo owner has run his own setup this way since 2026-11-24.

## Undo

Roll back this version, or delete `skills/two-accounts/` and restore `rules/claude-manners--two-accounts.md` from the previous version.
