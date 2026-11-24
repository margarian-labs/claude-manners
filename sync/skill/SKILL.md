---
name: claude-setup-sync
description: Use when the user says sync my setup, update my setup, roll back my setup, go back to version, or follow START.md. Drives the claude-setup sync tool: first-run menu, one-by-one updates, rollback, adding parts.
---

# claude-setup sync

You drive a command line tool. The tool changes files, you talk to the person. Never edit settings.json, rules, hooks or any other config file by hand for this job. Never run git yourself in the config folder.

## The tool

Run it with Bash. Resolve the path on every call (shell state does not persist):

```
SYNC="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools/claude-setup/sync/sync.mjs"
node "$SYNC" <command> --json
```

Always add `--json` and read the JSON. Exit codes: 0 done, 2 the tool needs an answer (the `questions` list says what to ask and which flag carries the answer), 1 error (show `error` in plain words, stop).

Commands: `status`, `catalog`, `plan`, `install --parts a,b`, `apply`, `rollback`, `versions`, `adopt`, `repair`, `verify`, `values`, `bootstrap --repo <clone>`.

Answer flags (repeat the command with them): `--proposals a,b` (accept), `--answers a=skip,b=later`, `--keep <dest>`, `--overwrite <dest>`, `--accept-settings <pointer>`, `--confirm-risky <id>`, `--values key=value` (repeatable), `--fable yes|no`, `--crash finish`.

## Asking

Ask every question with AskUserQuestion (at most 4 questions per call, at most 4 options each; the person can always type under Other). Use plain, short English. Never write em or en dashes. Never use the words "risk" or "risky" in a question. Quote `changes` text exactly as the tool gives it.

## Start of every run

1. `status --json`. If there is no `repo.path`, the person has not run START.md yet: tell them to follow START.md, stop.
2. If `crashed` is set: say a run did not finish. Ask: finish it (run the next command with `--crash finish`) or undo it (`rollback --crashed --plan`, show the list, apply only after a yes).
3. If `parts` is 1 or less, only the sync tool is installed: go to First run.
4. If `engine_update` is true: say the sync tool has an update, ask yes, run `apply --update-engine --json`, then start again.
5. If `files_check` is `"pending"`: run `repair --plan --json`. If `files` is empty, go on. Otherwise say which parts taken over from the old pack miss files or have outdated ones (count per part), ask yes, run `repair --json`, and say what it wrote.

## First run (no answers yet, or the person asks to install parts)

Ask about every part on its own. Never offer a whole group in one question ("install the recommended ones").

1. `catalog --json` gives the short list (id, title, level, use, trigger, installed, ask_alone, requires_parts) grouped. Skip parts already installed. Parts in `hidden` are not offered; if the person asks why one is missing, give its `unmet` list.
2. Order: first every part with `use: "auto"` (it works in every session without the person doing anything), then every part with `use: "you"` (it does nothing until the person uses it). Say which of the two sets you are starting, in one line, before its first question. Inside each set go group by group, and put a part after the parts it requires (`requires_parts`), so the base parts are asked first.
3. For the next parts (at most 4 per AskUserQuestion call), get their details with `catalog --parts a,b,c,d --json` and ask ONE question per part. Keep it short: the question text stands on its own in at most 3 short lines:
   - line 1: the title and whether it is recommended or optional;
   - line 2: `benefit`, what the person gains;
   - line 3: the always-on cost ("adds about N tokens to every session", or "loads only when used" when N is 0 or null) and, only if there are any, what it needs (programs in `needs`, other parts in `requires_parts`).
   Add one more line only when it applies: "Changes: " plus the `changes` text word for word when `changes` is set, and for a `use: "you"` part "You use it by: " plus `trigger`. Do not add `details`; it is in the full card.
   Options: "Install" and "Skip" (add "(Recommended)" to Install for recommended parts), plus "Show the full card" when the person may want the diff (`plan --parts <id> --cards --json`, then ask again).
4. Parts that cannot work well without each other are asked together, and only those: when a part's `requires_parts` names a part the person skipped or that is not yet chosen, ask about the pair (or chain) in one question, say plainly why they belong together ("Away mode reads the files the status line writes"), with options "Install both", "Skip both". Never bundle parts that merely fit the same topic.
5. A part with `ask_alone: true` is installed only when the person types the word confirm under Other in its own question; its Changes line says why. Options: "Skip" and "Show the full card". For other parts with `changes` set, choosing Install counts as the confirmation. Pass every such id with `--confirm-risky`.
6. Right after a part is chosen, ask its `values` (one question each, showing the `ask` text and the default). Pass answers as `--values key=value`. A value for a .js file must be valid JSON when it is a list or object (for example `["a","b"]`). Leave empty ones empty.
7. When every part has an answer, show a short list (chosen, skipped) and ask one last yes/no before installing. Then run `plan --parts <chosen> --json` for the remaining questions.
8. Answer other `questions` from the plan (a file the person edited: keep or overwrite). For each entry in `settings_conflicts` say the person already has a different value and ask: keep mine, or take the new one (`--accept-settings <pointer>`).
9. `install --parts a,b --values ... --confirm-risky ... --json`. A part that replaces a file the person already had keeps a backup; say so.
10. Show `result.steps`. User steps are for the person: tell them. Machine steps and plugin installs: read each in one line and ask yes or no before doing it, and do nothing without a yes. For a plugin, use Claude Code's own plugin commands (add the marketplace, then install the plugin); run `claude plugin --help` first if you are unsure of the syntax. Never do any of this when `CLAUDE_SETUP_TEST=1` is set. If `result.settings_skipped` is not empty, say which settings kept the person's value and offer the new one.
11. End with the one-screen report below.

## Sync (update)

1. `apply --json` (no answers) fetches the repo and lists the pending proposals (cards are left out when `cards_omitted` is true). If `engine.update` is true, handle that first (see Start) and run again.
2. Proposals with `noop: true` change nothing on this PC: accept them quietly.
3. For every other proposal, one at a time, run `plan --proposals <id> --json` to get its `card`, and show it: title, why (the advantage, first), what changes, tokens always on and how it was measured, quality, the Changes line, the diffs, and every warning. Show the card text as given, do not shorten the diffs. Then ask in one short question: accept, skip or later.
4. `risky` pointers or `ask_alone`: the person must type confirm (Other field) to accept. Without it, treat the answer as later.
5. `held` files and `settings_conflicts` in a card: say the person's own file or setting differs and ask whether to keep theirs or take the new one (`--keep`/`--overwrite`, `--accept-settings`).
6. `apply --proposals a,b --answers c=skip,d=later --confirm-risky a ...`. If exit 2, answer the questions and run again. A proposal answered later comes back next time; skip does not.
7. Show `result.steps` and `result.settings_skipped` as in the first run.
8. One-screen report.

## Roll back

1. "Roll back my last sync": `rollback --last --plan --json` (said again, it goes one more run back). "Undo my rollback": `rollback --redo --plan --json`. "Go back to version X": `rollback --to X --plan --json`. Use `versions --json` to list versions and runs when the person is not sure.
2. Show the plan in plain words: files that change back, settings that revert, MCP servers removed, proposals that will be offered again. Ask yes or no. Apply only after a yes.
3. For each local edit in `asks` ask: keep my file, or revert it (a backup is kept). Pass `--answers path=keep` or `path=revert`.
4. Run the same command without `--plan`, with the answers.
5. One-screen report.

## Other commands

- `values --json` lists fill-ins; `values set key=value` stores one. Say it takes effect on the next update of that part, or now with `install --parts <part>`.
- `verify --json` runs each installed part's checks; report passes and failures.
- `adopt --plan --json` shows what taking over an older setup-pack install (a rules/setup-pack folder) would do: files it adds or brings up to date, files kept because the person edited them or made them, and settings it leaves alone. Tell them, say it backs up and replaces that folder, ask yes, then run `adopt --json`. If `settings_not_applied` is not empty, offer `install --parts <those parts>` for them.
- `versions --json` shows tags and the person's runs.

## One-screen report

Plain list, at most 10 lines: what was installed or changed, what was skipped or postponed, what was rolled back, files held because of the person's edits, steps still waiting for them, and the version now. No file-by-file retelling.
