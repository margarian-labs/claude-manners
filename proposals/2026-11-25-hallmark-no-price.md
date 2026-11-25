---
id: 2026-11-25-hallmark-no-price
title: Hallmark - price in dollars removed
kind: change
level: recommended
part: skill-hallmark
touches:
  - rules/claude-manners--hallmark.md
  - skills/hallmark/SKILL.md
tokens_always_on: "-8"
tokens_how: estimated chars/2.6
quality: untested
risk: Text only - one rule line and the skill description; no code runs, no network.
undo: Roll back this version, or restore rules/claude-manners--hallmark.md and skills/hallmark/SKILL.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The Hallmark rule and the skill description no longer name a price in dollars per page. The time (about 4-6 minutes per page) stays.

## Why

The price looked like a real charge. On a Claude subscription a Hallmark run uses the plan limits, and the amount was only a fixed estimate.

## How it affects the agent

The agent still asks before it runs Hallmark, but names only the time. About 8 fewer tokens in every session.

## Undo

Roll back this version, or restore `rules/claude-manners--hallmark.md` and `skills/hallmark/SKILL.md` from the previous version.
