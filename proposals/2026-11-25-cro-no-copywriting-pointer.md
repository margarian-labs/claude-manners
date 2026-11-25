---
id: 2026-11-25-cro-no-copywriting-pointer
title: CRO - pointer to the copywriting skill removed
kind: change
level: recommended
part: skill-cro
touches:
  - skills/cro/SKILL.md
  - skills/cro/VENDOR.md
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: Text only - a skill loaded only when used; no code runs, no network.
undo: Roll back this version, or restore skills/cro/SKILL.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The "Related Skills" section of the CRO skill, which pointed at the copywriting skill, is removed. The vendor notes record the change.

## Why

The copywriting skill is no longer part of this setup, so the pointer led nowhere.

## How it affects the agent

The agent no longer suggests a skill that is not installed. The CRO advice itself is unchanged. About 30 fewer tokens when the skill loads.

## Undo

Roll back this version, or restore `skills/cro/SKILL.md` from the previous version.
