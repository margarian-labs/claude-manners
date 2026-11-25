---
id: 2026-11-25-architecture-no-system-design-pointer
title: Architecture decisions - pointer to the system-design skill removed
kind: change
level: optional
part: skill-architecture
touches:
  - skills/architecture/SKILL.md
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: Text only - one line in a skill read only when it runs; no code runs, no network.
undo: Roll back this version, or restore skills/architecture/SKILL.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

One sentence in the architecture skill pointed to the system-design skill. It is removed.

## Why

The system-design skill is no longer part of this setup, so the pointer led nowhere.

## How it affects the agent

The agent is no longer pointed at a skill that is not installed. About 50 fewer tokens when the skill is used.

## Undo

Roll back this version, or restore `skills/architecture/SKILL.md` from the previous version.
