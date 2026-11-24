---
# Copy this file to proposals/<id>.md. The id must equal the file name without .md.
id: example-change                  # kebab-case
title: Short plain title            # what the person sees on the card
kind: change                        # add | change | remove
level: optional                     # recommended | optional
part: away-mode                     # a catalog id, or new:<id> for a part this proposal creates
touches:                            # every file or settings pointer the change writes
  - hooks/away-mode.js
  - settings.json
tokens_always_on: "+240"            # a number, or a signed string like "+240" or "-80"
tokens_how: estimated chars/2.6     # optional: how the number was found
quality: tried                      # measured | tried | untested
risk: Runs on every prompt; no network.   # what runs, when, network or not
undo: Roll back to the previous version, or delete hooks/away-mode.js.
needs: [windows, cmd:node]          # optional: same forms as catalog needs
after: []                           # optional: proposal ids that must be accepted first
settings: []                        # optional: settings pointers it sets, for example /env/NAME
runs_code: true                     # optional: true when it adds code that runs
ask_alone: false                    # optional: true for bypass-class changes
---

## What changes

One or two plain sentences: what is added, changed or removed.

## Why

What problem this fixes or what it improves, in plain words.

## How it affects the agent

What the agent does differently after this, and what it costs in tokens or time.

## Undo

How to go back: roll back this version, or the exact files and settings to remove.
