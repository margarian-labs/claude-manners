---
id: 2026-11-26-session-names-npm-install
title: Session names - work with an npm-installed Claude
kind: change
level: recommended
part: session-namer
touches:
  - hooks/session-namer.js
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: The hook finds claude.exe in the PATH folders instead of failing; no network beyond the small Haiku call the hook already makes.
undo: Roll back this version, or restore hooks/session-namer.js from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The session naming hook now also finds Claude when it was installed with npm. It looks only in the PATH folders, never in the project folder. The projects folder can be a path inside your home folder or a list of folders. When a naming fails, the reason is written to namer.log, and `session-namer.js --check` tells you in one line whether naming works.

## Why

With an npm install every naming failed silently, so no session ever got a name, and the setup's own check did not notice.

## How it affects the agent

Nothing changes for the agent and no tokens are used. Sessions get names again.

## Undo

Roll back this version, or restore `hooks/session-namer.js` from the previous version.
