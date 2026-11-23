# Compact instructions (applied to every compaction, manual and auto)

Write the summary so the next context can go on with the work without asking the user anything again. The reader has tools but remembers nothing of this conversation. The user's own words win over any summary of them.

Start the summary with this line, copied as is (do not fill in or guess a session id):
`Exact detail: the full history of this session, also from before each compaction, is in the transcript named at the end of this summary. Grep it, never read it whole. Every user message and answer, word for word: node ~/.claude/skills/handoff/scripts/extract-user-messages.mjs --session "$CLAUDE_CODE_SESSION_ID" --out <scratchpad>/user-messages.md`

Then write the sections below, in this order, with these headings. If room runs short, shorten from the last section up. Never shorten section 1.

## 1. User instructions and decisions (numbered, word for word)
- Copy exactly as written, with no paraphrase, merging or shortening:
  - the first request (the original brief);
  - every instruction, rule, preference, correction and decision, also those sent while Claude was working;
  - every AskUserQuestion answer: the question in a few words, then the chosen option and any notes;
  - every plan approval or rejection, and every rejected tool call: what was rejected in a few words, then what the user said instead.
- Flags and standing instructions that still apply (e.g. `-nc` no commits, "no tests"): say how long each lasts (this task, or the rest of the conversation).
- Messages with no instruction in them ("continue", "thanks") can be left out.
- If the conversation starts with an earlier summary, copy its "User instructions and decisions" section forward unchanged (in an older summary format: its "All user messages" section and any user rules or answers it lists), then append the new entries. Never drop older entries. Mark an entry "superseded by #N" only when the user clearly replaced it.
- Number the entries (#1, #2, ...) in the order given and keep the numbers stable across compactions.
- Long pastes (logs, documents, code, images): one line saying what it was and where to find it (a path, or "in the transcript"), not a copy. Keep the user's own words around the paste word for word.
- Never copy a secret, password or token: write "[secret removed]".

## 2. Current task, goal and next steps
- The task and its goal (why it matters), in two lines.
- Next steps as an ordered list. Step 1 is concrete enough to start without asking: the file, the command, the expected result.

## 3. Rules not reloaded
- Reloaded in full after compaction, so do not restate: the user-level ~/.claude/CLAUDE.md, the project CLAUDE.md, auto memory and the plan file.
- Skills used in this session come back cut to their first ~5,000 tokens (oldest dropped first past 25,000 in total): keep, in short form with the skill name, the rules that still apply from long skills.
- Keep, in short form and with where each came from, the rules that still apply from nested CLAUDE.md files, path-scoped rules and hook reminders.
- Bans, confidentiality and git or branch rules the user gave in chat: one line each, with its section 1 number.
- The skills this job uses, by name.

## 4. Decisions
- Number them D1, D2, ... and keep the numbers stable across compactions. Carry earlier ones forward. Mark a replaced one "superseded by D<N>".
- Each one: the decision, a one-line reason, who made it (user or Claude), what it rules out, and its section 1 number if it came from the user.

## 5. Where everything is
- One line each, absolute paths: plans, specs, outputs, worktrees, branches, scripts, logs, agent briefs.
- Keep identifiers exactly: paths with line numbers, branches, PR and ticket keys, commands, URLs, ids, numbers, error messages.

## 6. Status
- Done, as a short list.
- Running, with how to check it.
- Half done, with what is missing and how to verify it.
- Not started.

## 7. Facts and findings
- Findings with their evidence (file:line, command output, source URL). Mark anything not verified as unverified.
- Gotchas and their fixes, and the numbers that matter.
- How the work is run: workers or agents, where their briefs are, how results are checked.
- Content that can be read again later: give the path, not the content. Something still needed that exists only in this chat (a draft, a list): keep it in full.

## 8. Open items and still owed
- Waiting on the user, open questions, blocked items.
- Still owed: the user's to-dos, results not yet told to the user, cleanup.

## 9. Tried and failed
- What was tried and why it failed, so it is not retried.

## 10. Background work and leftovers
- Agents, shells and monitors still running: name or id, what each will deliver, how its result will be checked.
- Left behind and still to clean up: servers, worktrees, branches, containers, temp files.

Before you finish, check two things: the next context can start step 1 of section 2 without asking the user, and every user answer and instruction is in section 1.

Use plain hyphens only, never long dashes. Plain short words. Skip pleasantries and tool chatter.
