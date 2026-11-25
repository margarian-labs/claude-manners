---
id: 2026-11-25-domain-pointer-grilling
title: Set up Matt Pocock's skills - pointer follows the merged grilling skill
kind: change
level: recommended
part: skill-setup-matt-pocock-skills
touches:
  - skills/setup-matt-pocock-skills/domain.md
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: Text only - one word in a file read only when the skill runs; no code runs, no network.
undo: Roll back this version, or restore skills/setup-matt-pocock-skills/domain.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

One sentence in `domain.md` named `/grill-with-docs` as a way to reach the domain-modeling skill. It now names `/grilling`.

## Why

"Grill with docs" is no longer a separate part: the grilling skill covers it.

## How it affects the agent

The agent is pointed at a skill that exists. No token change.

## Undo

Roll back this version, or restore `skills/setup-matt-pocock-skills/domain.md` from the previous version.
