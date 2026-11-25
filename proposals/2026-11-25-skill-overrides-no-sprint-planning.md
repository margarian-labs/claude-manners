---
id: 2026-11-25-skill-overrides-no-sprint-planning
title: Skill overrides - sprint-planning line removed
kind: change
level: recommended
part: skill-overrides
touches:
  - settings.json
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: One settings line; no code runs, no network.
undo: Roll back this version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The list of switched-off skills no longer contains `sprint-planning`.

## Why

The sprint-planning skill is no longer part of this setup, so there is nothing left to switch off.

## How it affects the agent

Nothing changes for the agent on a PC that does not have the sprint-planning skill.

## Undo

Roll back this version.
