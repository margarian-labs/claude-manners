---
id: 2026-11-25-status-line-away-badge
title: Status line - shows when the session is in away mode
kind: change
level: recommended
part: status-line
touches:
  - statusline.sh
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: The status line script also reads one small local file; no network.
undo: Roll back this version, or restore statusline.sh from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

An orange `away` appears right after `rc` while the session is in away mode, or `away 85%` when a weekly stop point is set. It is hidden when away mode is off.

## Why

There was no way to see whether a session is still in away mode before you leave.

## How it affects the agent

Nothing changes for the agent and no tokens are used.

## Undo

Roll back this version, or restore `statusline.sh` from the previous version.
