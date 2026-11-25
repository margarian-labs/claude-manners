---
id: 2026-11-26-away-test-new-rule-name
title: Away mode - its test reads the rule under the new name
kind: change
level: recommended
part: away-mode
touches:
  - hooks/tests/away-hook-test.js
tokens_always_on: 0
tokens_how: estimated chars/2.6
quality: tried
risk: One line in a test file that only runs when a check is started; no network.
undo: Roll back this version, or restore hooks/tests/away-hook-test.js from the previous version.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The test of the away hooks looks for the away rule under `rules/claude-manners--away-mode.md`, and under the old name when the new one is missing.

## Why

The rule files were renamed, so the test would fail.

## How it affects the agent

Nothing changes for the agent and no tokens are used.

## Undo

Roll back this version, or restore `hooks/tests/away-hook-test.js` from the previous version.
