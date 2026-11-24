---
id: 2026-11-24-disk-watchdog-no-rule
title: Disk watchdog - drop its rule file
kind: change
level: optional
part: disk-watchdog
touches:
  - rules/claude-setup--disk-watchdog.md
  - payload/rules/claude-setup--disk-watchdog.md
tokens_always_on: "-100"
tokens_how: estimated chars/2.6
quality: tried
risk: Removes one text file; no code runs, no network.
undo: Roll back this version, or restore rules/claude-setup--disk-watchdog.md from the previous version.
needs: [windows]
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The disk watchdog's rule file (backups are deleted after 90 days, session temp 3 days after last use) is removed. The same two lines are in the tidy skill, which applies them when the watchdog is installed.

## Why

The two lines were loaded into every session but matter only when cleaning up, and the tidy skill already carries them.

## How it affects the agent

About 100 fewer tokens in every session. The agent learns the 90-day and 3-day limits when it runs tidy. The watchdog itself works exactly as before.

## Undo

Roll back this version, or restore `rules/claude-setup--disk-watchdog.md` from the previous version.
