---
id: 2026-11-26-two-accounts-safe-lookup
title: Two accounts - claude is looked up in PATH only
kind: change
level: recommended
part: two-accounts
touches:
  - tools/sync-second-profile.mjs
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: untested
risk: One word in the profile sync script; it runs when the second profile starts, no network.
undo: Roll back this version, or restore tools/sync-second-profile.mjs from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The profile sync looks for claude only in the PATH folders. Before, it also looked in the folder you were in.

## Why

A downloaded project could contain its own claude.exe and have it started.

## How it affects the agent

Nothing changes for the agent and no tokens are used.

## Undo

Roll back this version, or restore `tools/sync-second-profile.mjs` from the previous version.
