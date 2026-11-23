---
name: handoff
description: Use when the user says "write a handoff", "handoff", "hand off", "hand this over", "pass this to session <id>", "move this to a new session", or asks whether to compact or start fresh because the session is too big. Writes a complete handoff (the job, every decision, the user's own messages and answers verbatim, status, next steps, what is owed) to ~/.claude/handoffs, and when a target session id is given, first checks that this session can message it, then passes the handoff to that session itself (no asking) and checks it arrived; if it can't reach it, it tells the user and gives the start line.
---

# Handoff

Goal: a fresh session continues the work without asking the user anything they already answered. The user's own words (messages, answers, approvals) are passed on verbatim and win over any summary.

## 0. A target session id was given: check it can be reached, FIRST
1. Look it up: `node ~/.claude/skills/handoff/scripts/session-info.mjs <id>`. It prints the transcript, its first and last record times, its working folder and its names (agent name, custom title, AI title). `NOT FOUND` means no session with that id on this machine.
2. Call `ListAgents`. The target is the peer whose name matches one of the printed names. A new session usually has no name yet: then take the local interactive peer whose "started N ago" fits the first record time (times are UTC; convert). Exactly one fit: use it, and say it was matched by start time. None or several: not reachable.
3. Probe without disturbing it: `SendMessage({to: "<name>", notify_when_idle: true})` with no message (a pure subscription; it costs that session nothing). A success means it is reachable. Never try the raw id as `to`: it does not resolve.
4. Not reachable (not found, no match, or the probe fails): tell the user in one line at once, e.g. "I can't reach session <id> from here (<why>). I'm writing the handoff anyway and will give you the line to paste there.", then go on.

## 1. Pick the moment
- Results of this session's background work (sub-agents, background shells, monitors) arrive only in this session. If any is running, say so, write the handoff meanwhile, and send it right after the last one lands (update the status section first). Tell the user when that is.
- Make everything durable before writing: files saved, results on disk. Nothing important may live only in this chat.

## 2. Write the files
Folder F = `~/.claude/handoffs/<yyyy-mm-dd>-<slug>/` (slug: ticket key plus a short topic, e.g. `ABC-123-login-redesign`). If F already exists (an earlier handoff of this job), add `-2` (then `-3`, ...) to its name: never write into an earlier handoff's folder. Exception: when the job already has its own local working folder (e.g. material that must stay in one folder), use `<that folder>/handoff/` and put `HANDOFF.md` in it.
1. **`user-messages.md`**: `node ~/.claude/skills/handoff/scripts/extract-user-messages.mjs --session <this session id> --out <F>/user-messages.md`. This session's id is in the environment variable `CLAUDE_CODE_SESSION_ID` (`echo $CLAUDE_CODE_SESSION_ID`); if that is empty, it is the folder name just above `scratchpad` in the scratchpad path of your system prompt. It covers every message typed (also those sent while you worked), every question answer, every plan approval or rejection and every rejected tool call, in order, including the original brief: the user's own words verbatim, without Claude Code's wrapper text (a standard plan approval shows only the plan file path; long dashes become hyphens). Long pastes stay in this file: `HANDOFF.md` points to them and never copies them. Check: the first entry (the brief) and the last are whole, and the script's `check:` line ends with `ok` (it compares the questions and plans asked with the results it extracted). `MISSING` means an answer was lost: find it in the transcript and add it by hand. Compacted sessions still have the full history in the transcript.
   - **Earlier sessions of the same job:** the script reads this session's transcript only. If this session started from an earlier handoff (it began with a start line or a `Handoff of <job>` message naming a `HANDOFF.md`), copy that folder's `user-messages-earlier.md` (if it has one) and its `user-messages.md`, in that order, into `<F>/user-messages-earlier.md`, so the original brief and the earlier answers travel on. If that folder is gone, say so in `HANDOFF.md`.
2. **`HANDOFF.md`** (the entry point), in this order:
   - **Start line:** `continue <job> from <F>/HANDOFF.md`, and the **reading order**: this file, `user-messages-earlier.md` when there is one, `user-messages.md`, `session-notes.md`, the approved plan, the decision files.
   - **Job:** goal in two lines, ticket keys, the plan and its version.
   - **Decisions in force:** numbered D1, D2, ..., each with who, when, why and what it rules out; standing instructions the user gave (e.g. "no tests", "Claude only", flags) with how long each lasts; a superseded decision stays, marked "superseded by D<N>". Keep the numbers an earlier handoff or a compaction summary of this job already gave, and carry forward its decisions still in force; new ones get the next numbers.
   - **Rules that bind this job:** confidentiality, git and branch rules, anything the user forbade in chat. Don't copy the user-level or the project `CLAUDE.md`: a session started in the same working folder loads them itself (point to a section only when it matters most for this job). Do list, in short form and with its source, each rule that came from a skill, a nested `CLAUDE.md`, a path-scoped rule or a hook reminder. Name the skills to invoke again.
   - **Where everything is:** absolute paths of plans, specs, outputs, worktrees and branches, scripts, logs, with one line each.
   - **Status:** done, running (with how to check it), blocked (on what or whom), not started; anything half done and how to verify it.
   - **Next steps, in order:** concrete enough to start step 1 without asking.
   - **Still owed:** the user's to-dos, questions still open, things to tell the user, cleanup of what this session created (containers, worktrees, branches, servers, background shells, temp files).
   - **Full transcript:** its path, with "grep it, never read it whole".
3. **`session-notes.md`**: what is not obvious from the files: technical facts with their evidence (file:line, command output, URL; anything not checked marked "unverified"), gotchas and their fixes, what was tried and failed and why (so it is not retried), how the work was run (agent briefs, how results were checked), numbers that matter, the usage state.
4. **Copies:** the approved plan-mode file (`~/.claude/plans/<name>.md`) when one belongs to this job, and any decision list that exists only in chat.

Content rules: absolute paths; no secrets, passwords, tokens or personal data; follow the project's confidentiality rules (where material must stay, F stays there); no em or en dash; plain short words. A handoff is transient state: local files only, never a repo, a PR, a ticket tracker or a shared memory tool.

## 3. Check before handing over
Read `HANDOFF.md` as the new session would: can it start step 1 of the next steps without asking the user anything? Is every user answer in `user-messages.md` (the script's `check:` line says `ok`) and, where it decides something, reflected in the decisions? If the job came from an earlier handoff, are its messages and decisions here too? Does every path exist (`ls`)? Fix the gaps.

## 4. Pass it to the target session (always, when it is reachable)
- **Reachable target: send it there yourself, without asking the user**. One `SendMessage` to its name with `notify_when_idle: true`. First line self-contained: `Handoff of <job>: continue it from <F>/HANDOFF.md.` Then the reading order and 3 to 5 key points (decisions that change behaviour, what is running, the next step), and: `If you are not session <id>, tell the user and ignore this.` Text only and short: the files carry the content; never paste them (cross-session messages have a size limit).
- **Check delivery:** the send result says whether it reached the session's inbox. A `[Cross-session delivery notice]` that the session holds or refused it (usually a different permission mode) means it was NOT passed on: tell the user to approve it in that session, or give the start line. When the idle notice arrives, check the target picked it up (its transcript grew: `session-info.mjs <id>` shows a later last record) and say so.
- **No target, or not reachable:** give the user the start line to paste into the new session, started in the same working folder.
- **Report to the user:** the folder, what is in it, whether it was passed to the session (and how the target was matched), and the start line as a fallback.

## After the handoff
Start no new work here. If a late result lands in this session, update `HANDOFF.md` and tell the new session by `SendMessage`.
