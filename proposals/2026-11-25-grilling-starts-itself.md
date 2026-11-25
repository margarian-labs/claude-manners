---
id: 2026-11-25-grilling-starts-itself
title: Grilling - Claude starts it by itself on big decisions
kind: change
level: recommended
part: skill-grilling
touches:
  - skills/grilling/SKILL.md
tokens_always_on: "+86"
tokens_how: estimated chars/2.6
quality: untested
risk: Text only - a skill loaded only when used; no code runs, no network.
undo: Roll back this version, or restore skills/grilling/SKILL.md from the previous version.
needs: []
after: []
settings: []
runs_code: false
ask_alone: false
---

## What changes

The grilling skill gets a new description, so Claude starts the interview by itself before a big plan is final: a new project or feature, an architecture or data-model choice, or anything costly to undo, when the plan still rests on things you have not confirmed. It still starts whenever you say "grill". Three short paragraphs are added: when it starts on its own it first says which unconfirmed assumptions made it start, and it stops if you do not want the interview; an instruction not to ask or wait (away mode) wins; and "with docs" it also loads the domain-modeling skill and writes settled terms and decisions down.

The separate "Grill me" and "Grill with docs" parts leave the setup; this one skill covers both.

## Why

Three parts did one job, and the interview only ran when you remembered to ask for it. Big plans are where an unchecked assumption costs most, so that is where it now starts by itself.

## How it affects the agent

Before finalizing a big plan that rests on unconfirmed assumptions, the agent asks rounds of up to 4 questions and waits for your answers. Small tasks and bug fixes are not affected. The description costs about 86 more tokens in every session; the skill text is about 330 tokens longer when it loads. The new trigger has not been used in daily work yet.

## Undo

Roll back this version, or restore `skills/grilling/SKILL.md` from the previous version.
