---
id: 2026-11-25-readable-pages-no-price
title: Readable pages - Hallmark price in dollars removed
kind: change
level: recommended
part: core-rules
touches:
  - skills/readable-pages/SKILL.md
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: untested
risk: Text only - a skill loaded only when used; no code runs, no network.
undo: Roll back this version, or restore skills/readable-pages/SKILL.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The Hallmark line in the readable-pages skill no longer names a price in dollars per page. The time (about 4-6 minutes per page) stays.

## Why

The price looked like a real charge. On a Claude subscription a Hallmark run uses the plan limits, and the amount was only a fixed estimate.

## How it affects the agent

When building a new website or landing page, the agent still asks before it uses Hallmark, but names only the time. About 4 fewer tokens when the skill loads.

## Undo

Roll back this version, or restore `skills/readable-pages/SKILL.md` from the previous version.
