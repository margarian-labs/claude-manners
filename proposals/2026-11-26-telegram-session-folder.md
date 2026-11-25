---
id: 2026-11-26-telegram-session-folder
title: Telegram notifications - no duplicate messages on a new PC
kind: change
level: recommended
part: notifications-telegram
touches:
  - hooks/telegram-helpers.sh
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: One line that creates the folder ~/.claude/session when it is missing; no new network use.
undo: Roll back this version, or restore hooks/telegram-helpers.sh from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The Telegram hooks create the folder `~/.claude/session` when it does not exist.

## Why

The hooks keep the time of the last message there, to avoid sending the same thing twice. On a new PC the folder was missing, so you got duplicate messages.

## How it affects the agent

Nothing changes for the agent and no tokens are used.

## Undo

Roll back this version, or restore `hooks/telegram-helpers.sh` from the previous version.
