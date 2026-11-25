---
id: 2026-11-25-away-until-back
title: Away mode - stays on until -back and can no longer be stalled by a question
kind: change
level: recommended
part: away-mode
touches:
  - hooks/away-mode.js
  - hooks/away-guard.js
  - hooks/away-stop.js
  - hooks/tests/away-hook-test.js
  - skills/away-mode/SKILL.md
  - rules/claude-setup--away-mode.md
tokens_always_on: "+9"
tokens_how: estimated chars/2.6
quality: tried
risk: Changes hooks that run on every prompt, tool call and stop; no network.
undo: Roll back this version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

Away mode now ends only when you write `-back` (start or end of a message) or after 72 hours. Any other message you send is answered or followed, and the work goes on. While it is on, one question dialog is allowed in the first 30 minutes after `-away`; later ones are denied and the agent takes the recommended option. Plan mode is denied too, unless the `-away` message also has `-p`. If a weekly stop point was reached, only `-back` or a new `-away` restarts work. The usage limit hook no longer asks for a wake-up timer when nothing is left to do.

## Why

Before, any message without `-away` ended away mode, even "how is it going?". The agent was then told you are back, so it could stop in the middle of the work with a question nobody answers.

## How it affects the agent

It keeps working after you write to it in away mode, and it cannot open a question dialog or plan mode that would wait for you. A question written as plain text is not blocked, only forbidden in its instructions. Away mode also stays on after the task is done, so write `-back` when you return; the final report reminds you.

## Undo

Roll back this version.
