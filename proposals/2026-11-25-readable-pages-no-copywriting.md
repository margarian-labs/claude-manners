---
id: 2026-11-25-readable-pages-no-copywriting
title: Readable pages - copywriting skill no longer listed
kind: change
level: recommended
part: core-rules
touches:
  - skills/readable-pages/SKILL.md
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: Text only - a skill loaded only when used; no code runs, no network.
undo: Roll back this version, or restore skills/readable-pages/SKILL.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The readable-pages skill no longer names the copywriting skill in its list of skills to load with it.

## Why

The copywriting skill is no longer part of this setup.

## How it affects the agent

When building a page, the agent no longer looks for a skill that is not installed. Everything else in the skill is unchanged. About 20 fewer tokens when the skill loads.

## Undo

Roll back this version, or restore `skills/readable-pages/SKILL.md` from the previous version.
