# Catalog entry format

One JSON file per part: `catalog/<id>.json`. The sync engine reads these; the README catalog is generated from them.

```json
{
  "id": "away-mode",
  "title": "Away mode",
  "group": "workflow",
  "level": "recommended",
  "summary": "Say -away and the agent asks all its questions first, then finishes without you.",
  "benefit": "You can leave: Claude asks everything up front, then finishes the task on its own.",
  "solves": "Long tasks stop and wait for an answer while you are away from your desk.",
  "use_cases": [
    "\"-away\" on any message: one round of questions now, then it never asks or waits.",
    "\"-away 85\": also stops cleanly when your weekly usage reaches 85%."
  ],
  "needs": ["windows", "cmd:node", "part:status-line"],
  "files": [
    { "src": "payload/hooks/away-mode.js", "dest": "hooks/away-mode.js", "mode": "managed" }
  ],
  "settings": ["payload/settings/fragments/hooks-away.json"],
  "rules": ["payload/rules/claude-setup--away-mode.md"],
  "mcp": [],
  "plugins": [],
  "values": [
    { "key": "EXTRA_WRAP_UP", "file": "hooks/away-guard.js", "ask": "Memory tools allowed after the stop point (leave empty if none)", "default": "" }
  ],
  "user_steps": [],
  "machine_steps": [],
  "verify": ["node \"$CLAUDE_CONFIG_DIR/hooks/tests/away-hook-test.js\""],
  "tokens_always_on": { "value": null, "how": "not measured yet" },
  "tokens_on_use": { "value": 1225, "how": "estimated chars/2.6" },
  "quality": "tried",
  "risk": "Runs on every prompt, question and stop. No network.",
  "ask_alone": false,
  "license": null
}
```

## Fields
- `id`: kebab-case, unique, same as the file name. Skills use `skill-<folder name>`.
- `group`: one of `rules`, `settings`, `workflow`, `hooks`, `agents`, `skills`, `plugins`, `tools`, `integrations`, `lessons`.
- `level`: `recommended` (ticked in the first-run menu) or `optional`.
- `summary`: one plain sentence, at most 140 characters. No em or en dash.
- `benefit`: right after `summary`, one plain sentence of at most 100 characters on what the person gains; the first-run question shows it. Every part has one except `sync-engine`: sync tools before 1.2 reject unknown keys and must still read that entry to offer the engine update.
- `solves`: right after `benefit`, one plain sentence of at most 120 characters: the problem that goes away. Shown as "Solves:".
- `use_cases`: right after `solves`, 1 to 5 lines of at most 120 characters each: the important ways the part is used. For a `use: "you"` part the first line carries the exact words to type, and every argument or variant that matters gets its own line (`"-away 85": ...`). Every line must be true of the files the part ships; check it against them.
- `solves`, `use_cases`, `tokens_on_use` and `cost_note` are optional for the validator, and every part has the first three except `sync-engine`, for the same reason as `benefit`.
- `use`: `auto` (works in every session without the person doing anything) or `you` (does nothing until the person uses it).
- `trigger`: for `you` parts, one sentence on what the person types or runs to use it; empty for `auto`.
- `details`: 2 to 4 short plain sentences, 40 to 600 characters: what it does in practice, when it helps, and what it changes on the PC (files, settings, hooks; whether code runs). Background text; the first-run question shows the card built from the other fields.
- `needs`: conditions checked before the part is shown. Allowed forms only: `windows`, `second-profile`, `memohopper-connected`, `fable-access`, `haiku-access`, `part:<id>`, `plugin:<name>`, `cmd:<executable>`, `claude>=<version>`.
- `files`: `src` is a repo path (file or folder); `dest` is relative to the Claude config dir (`~/.claude`). `mode`:
  - `managed`: sync owns it, replaces it on update, restores it on rollback.
  - `rendered`: managed, but `values` are filled in on install.
  - `seed`: written once if absent, then it belongs to the person; never updated or rolled back.
- `settings`: settings fragment files merged into `settings.json`.
- `rules`: rule files installed flat as `~/.claude/rules/<file name>`.
- `mcp`: objects `{ "name": "...", "config": { ... } }`; secrets only as `${ENV_VAR}`.
- `plugins`: objects `{ "name": "...", "marketplace": "owner/repo" }`; installed from their marketplace, nothing shipped.
- `values`: fill-ins asked once and stored in the local state; `file` is a `dest` path. A value may instead name `"frontmatter": "model"` to set a frontmatter key.
- `user_steps`: steps the person does alone (making a bot, creating a key). Plain sentences.
- `machine_steps`: anything outside the Claude config dir (scheduled task, user env var, global install). Never run in test mode.
- `verify`: commands that must exit 0 after install. They run in the config folder on the installed copies (`$CLAUDE_CONFIG_DIR`); the clone is in `$CLAUDE_SETUP_REPO`, for test input only.
- `tokens_always_on`: `{ "value": <number or null>, "how": "measured /context" | "estimated chars/2.6" | "estimated chars/4" | "not measured yet" }`. The estimator writes `"estimated chars/2.6"`; `"estimated chars/4"` stays accepted for older entries. chars/2.6 was measured on 2026-11-24 from real API usage on Claude Opus 5.5 with markdown rule files (range 2.5-2.7).
- `tokens_on_use`: right after `tokens_always_on`, same shape: what loads when the part is used. The estimator writes the full `SKILL.md` text of each skill plus each agent file at chars/2.6; reference files a skill opens are not counted (the card says so). It writes `null` with `"not measured yet"` for parts whose use runs only hooks, plugins or MCP servers. A `null` set by hand stays when the estimator would write 0 (use it when a part loads text the estimator cannot see).
- `cost_note`: optional, right after `tokens_on_use`, one sentence of at most 120 characters, only for a cost that is not tokens and that the part's own files state (a paid model call, money or minutes per run).
- Token numbers count rule files and skill or agent text only. Text added by hooks, plugins and MCP servers is not counted; the card says so for those parts.
- `quality`: `measured`, `tried` or `untested`.
- `risk`: one plain sentence: what runs, when, network or not. Update cards show it as the "Changes:" line and first-run questions as the start of the "Affects:" line, so do not use the word "risk" in it.
- `ask_alone`: `true` for bypass-class parts, which get their own question with a warning.
- `license`: SPDX id for third-party content, else `null`.
