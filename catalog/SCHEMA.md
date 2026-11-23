# Catalog entry format

One JSON file per part: `catalog/<id>.json`. The sync engine reads these; the README catalog is generated from them.

```json
{
  "id": "away-mode",
  "title": "Away mode",
  "group": "workflow",
  "level": "recommended",
  "summary": "Say -away and the agent asks all its questions first, then finishes without you.",
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
  "verify": ["node payload/hooks/tests/away-hook-test.js"],
  "tokens_always_on": { "value": null, "how": "not measured yet" },
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
- `use`: `auto` (works in every session without the person doing anything) or `you` (does nothing until the person uses it).
- `trigger`: for `you` parts, one sentence on what the person types or runs to use it; empty for `auto`.
- `details`: 2 to 4 short plain sentences, 40 to 600 characters: what it does in practice, when it helps, and what it changes on the PC (files, settings, hooks; whether code runs). Shown in the first-run question for that part.
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
- `verify`: commands that must exit 0 after install.
- `tokens_always_on`: `{ "value": <number or null>, "how": "measured /context" | "estimated chars/4" | "not measured yet" }`.
- `quality`: `measured`, `tried` or `untested`.
- `risk`: one plain sentence: what runs, when, network or not.
- `ask_alone`: `true` for bypass-class parts, which get their own question with a warning.
- `license`: SPDX id for third-party content, else `null`.
