---
id: 2026-11-26-usage-local-time
title: Usage tools - times in your own time zone
kind: change
level: recommended
part: usage-tools
touches:
  - tools/usage-audit.mjs
  - tools/usage-pct-series.mjs
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: Runs only when you start it; reads local transcripts, no network.
undo: Roll back this version, or restore tools/usage-audit.mjs and tools/usage-pct-series.mjs from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The usage reports show times in the time zone of your PC. Before, they always showed UTC+4.

## Why

Outside UTC+4 every time and every hour of the day in the reports was wrong.

## How it affects the agent

Nothing changes for the agent and no tokens are used.

## Undo

Roll back this version, or restore the two files from the previous version.
