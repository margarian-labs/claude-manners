---
id: 2026-11-25-session-names-skip-back
title: Session names - the -back flag stays out of names
kind: change
level: recommended
part: session-namer
touches:
  - hooks/session-namer.js
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: One word added to a list in a hook; no network beyond what the hook already does.
undo: Roll back this version, or restore hooks/session-namer.js from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The session naming hook removes the new `-back` flag from your message before it picks a name, as it already does for `-away` and the other flags.

## Why

Without it, a message such as "-back what did you do?" could put "back" in a session name.

## How it affects the agent

Nothing changes for the agent and no tokens are used.

## Undo

Roll back this version, or restore `hooks/session-namer.js` from the previous version.
