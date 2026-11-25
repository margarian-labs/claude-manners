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
undo: Nothing to undo on a PC that already has the part; a new install simply does not get the line.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The list of switched-off skills that a new install gets no longer contains `sprint-planning`. A PC that already has `"sprint-planning": "off"` in its settings.json keeps that line: the sync tool does not remove it.

## Why

The sprint-planning skill is no longer part of this setup, so there is nothing left to switch off.

## How it affects the agent

Nothing changes for the agent. A leftover `sprint-planning` line does nothing once the skill is gone; delete it from `skillOverrides` in settings.json by hand if you want it gone.

## Undo

Nothing to undo: this version changes no file and no setting on a PC that already has the part.
