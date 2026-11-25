---
id: 2026-11-26-renamed-to-claude-manners
title: Sync tool - claude-setup is now called claude-manners
kind: change
level: recommended
part: sync-engine
touches:
  - tools/claude-manners/sync/
  - skills/claude-manners-sync/
  - tools/claude-setup/sync/sync.mjs
  - rules/
  - payload/legacy/
  - payload/rules/
tokens_always_on: "+14"
tokens_how: estimated chars/2.6
quality: tried
risk: Code that runs at the start of each sync command moves and renames files in your config folder; no network.
undo: None. Rolling back past the rename is refused; the files from before it stay in state/claude-manners/backups.
needs: []
after: []
settings: []
runs_code: true
ask_alone: false
---

## What changes

The setup has a new name, claude-manners. The next command of the sync tool after this update moves four things on this PC to the new name: the rule files (`rules/claude-setup--*.md`), the tool (`tools/claude-setup`), its skill (`claude-setup-sync`) and its state folder (`state/claude-setup`). Rules you edited are moved and their text is left alone. In the others only the name in the header lines changes.

A small file stays at the old tool path, so that a session that is already open still reaches the tool. It goes away at the first start from the new path.

## Why

The old name said nothing about what the setup does for you.

## How it affects the agent

The skill is now `claude-manners-sync` and the rule files have new names; what the rules say is the same. Start a new session after the update. "Sync my setup" and "roll back my setup" work as before.

## Undo

Rolling back to a version from before the rename is refused. Your files from before it stay in `state/claude-manners/backups`.
