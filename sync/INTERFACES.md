# Sync engine: interfaces (v1)

Node 18+ ESM, no npm dependencies. Every write goes through `lib/fsx.mjs`. Windows first; paths use `node:path`.

## Hashing
`hashFile(path)`: sha256 hex of the bytes with `\r\n` replaced by `\n` when the file has no NUL byte (text); raw bytes otherwise. Used everywhere (state, migration map field `sha256_lf`, local-edit detection). Folders: hash of the sorted list of `relpath + "\0" + hashFile` lines.

## Paths
- `CONFIG_DIR`: `process.env.CLAUDE_CONFIG_DIR` or `~/.claude`. Main profile only; the second-profile sync runs after.
- `STATE`: `CONFIG_DIR/state/claude-manners/state.json` (+ `state.json.bak` written before every save).
- `BACKUPS`: `CONFIG_DIR/state/claude-manners/backups/<yyyy-mm-dd>/<runId>/` holding copies of every file before sync touched it, plus `journal.jsonl`.
- `REPO`: path given by `--repo` or `state.repo.path`.
- Test mode (`CLAUDE_SETUP_TEST=1`): refuse to run unless `CONFIG_DIR` is under the path in `CLAUDE_SETUP_TEST_ROOT`; machine steps never run.

## State schema (`state.json`, version 1)
```json
{
  "version": 1,
  "repo": { "path": "...", "commit": "<sha of last applied version>", "tag": "v2026.11.23.1" },
  "engine": { "version": "1.0.0", "sha256": "..." },
  "facts": { "fable_access": true, "checked_at": "ISO" },
  "values": { "planner_model": "Fable 5.2", "LABELS": "..." },
  "parts": { "<partId>": { "installed": true, "at_commit": "<sha>" } },
  "answers": { "<proposalId>": { "answer": "accept|skip|later|baseline|rolled-back", "at": "ISO", "commit": "<sha>", "run": "<runId>" } },
  "files": { "<dest>": { "hash": "<hashFile after write>", "commit": "<sha>", "part": "<id>", "mode": "managed|rendered|seed", "existed_before": false, "backup": "<path or null>", "held": false } },
  "settings": { "<json pointer, e.g. /env/CLAUDE_CODE_RETRY_WATCHDOG>": { "part": "<id>", "value": <written>, "prev": <value before or {"$absent": true}>, "run": "<runId>" } },
  "mcp": { "<name>": { "part": "<id>", "prev": <entry before or {"$absent": true}> } },
  "runs": [ { "id": "<runId>", "kind": "apply|rollback|adopt", "at": "ISO", "from": "<sha>", "to": "<sha>", "proposals": ["..."], "status": "started|done|rolled-back", "backup": "<dir>" } ]
}
```
`runId` = `yyyymmdd-hhmmss`. A run is `started` until it finishes; a run found `started` on the next start means a crash: offer finish or undo.

## Modules (lib/)
- `fsx.mjs`: `readJson`, `writeJsonAtomic(path, obj)` (temp file + rename), `copyAtomic(src, dest)`, `backupFile(runDir, dest)` (only once per run per path), `hashFile`, `hashTree`, `journal(runDir, event)`.
- `repo.mjs`: `git(args)`; `fetchAndUpdate()` (`git fetch --tags` then `git merge --ff-only`); `showFileAt(commit, path)` (bytes via `git show`); `listTags()`; `resolveVersion(tag|sha)`; `diffNames(from, to)`.
- `catalog.mjs`: `loadCatalog(repo, commit)`, `validateEntry(e)` (per catalog/SCHEMA.md).
- `proposals.mjs`: `parseFrontmatter(text)` (strict subset: scalars, `[a, b]`, `- item` lists); `loadProposals(repo, commit)`; `pending(state, proposals)` (unanswered or `later` or `rolled-back`, `needs` met, `after` satisfied).
- `conditions.mjs`: `check(need, ctx)` for every allowed form; `fableAccess()` (runs `claude -p --model claude-fable-5-2 --max-turns 1 "Reply ok"`; exit 0 = true, output containing `unrecognized_model` = false; anything else = unknown, ask); cached in `state.facts`.
- `settings-merge.mjs` (from `payload/settings/merge-fragment.mjs`): `planMerge(settings, fragment)` returns ops `[{op: add|change|keep|conflict, pointer, value, prev}]`; `applyOps(settingsPath, ops, runDir)`; `revert(settingsPath, entries)` (restores `prev` only where the current value still equals what sync wrote; else returns a conflict). Hook arrays merge by command string, never duplicate.
- `install.mjs`: `planPart(entry, state, values)` -> ops (file write/remove, settings ops, rule write, mcp add, plugin install, machine step) ; `applyOps(ops, runDir)`; `render(text, values)` (`{{key}}`) and `setFrontmatter(text, key, value)`.
- `rollback.mjs`: `planRollback(state, targetCommit)` -> ops limited to `state.files`, `state.settings`, `state.mcp` entries whose content differs from the target version: managed file -> content at target (or remove if absent at target and `existed_before` false, or restore `backup` if `existed_before` true); local edit (hash != state) -> ask; settings -> `prev`; then marks rolled-back proposals `later`.
- `legacy.mjs`: the rename from claude-setup to claude-manners (2026-11). `migrate(cfg)` runs at the start of every command: moves `state/claude-setup`, the rule files, and removes the old engine and skill; each step saves the state and can be repeated. `state.renamed` = `{ done, run, report }`; the run has kind `rename` and nothing can be rolled back past it. `expandFiles` and `bytesFor` give rules of older commits their new name and header, and skip `payload/legacy/` (the forwarder that engine 1.x installs at its own old path).
- `display.mjs`: `card(proposal, ops)` -> plain text for the skill: fields, file diffs (unified, against installed copy), settings dry run, warnings (`touches` mismatch, risky keys `env|permissions|hooks|apiKeyHelper|mcpServers`, network/process/outside-config patterns in code, earlier skipped change carried).

## CLI (`sync.mjs`), JSON output with `--json`
| Command | Does |
|---|---|
| `status` | repo version, pinned or not, pending count, held files, crash state |
| `catalog` | first-run menu data (groups, parts, levels, needs results) |
| `plan [--parts a,b] [--proposals x,y]` | dry run: ops + cards; writes nothing |
| `apply --proposals x,y [--answers x=skip,y=later] [--confirm-risky x]` | applies accepted, records all answers |
| `install --parts a,b` | first run from catalog; records existing proposals as `baseline` |
| `rollback --last \| --redo \| --runs N \| --to <tag\|sha> [--plan]` | `--last` undoes the latest run that is not a rollback (with the rollbacks after it); `--redo` undoes the latest run only if it is a rollback; `--plan` lists ops; without it applies after the skill confirmed |
| `versions` | tags with their proposals, plus this person's runs |
| `adopt [--from pack-2026-11-21] [--plan]` | takes over a pack install using `migrations/`: brings every file of the taken-over parts to the clone version, keeps edits and own files (held); `--plan` writes nothing |
| `repair [--plan]` | for parts installed by an adopt run, writes their missing or outdated files at that version; `status` shows `files_check: pending` until it ran once for this engine version |
| `verify` | runs each installed part's `verify` in the config folder (`CLAUDE_CONFIG_DIR` is a shell variable, exported only if it already was; the clone is in `CLAUDE_SETUP_REPO`); fails for a missing installed file; `notes` lists hooks of installed parts that are not in settings.json |
| `values set k=v` | stores a fill-in |

## Rules from the phase 1 import
- **Rendering:** `{{key}}` placeholders are filled in `rendered` files, in rule files and in settings fragments (e.g. `{{SECOND_DIR}}` in `payload/two-accounts/settings-snippet.json`). A value whose `file` is a `.js` hook is replaced as the exact source line `const <KEY> = <default literal>;` -> `const <KEY> = <JSON literal of the value>;`; if that line isn't found, stop with an error.
- **Dest tokens:** `dest` may start with `{memory_dir}`, meaning `CONFIG_DIR/projects/<cwd-encoded home>/memory/` (home path with `:`, `\` and `/` replaced by `-`, as Claude Code names project folders).
- **skill-overrides:** before merging, drop override keys for skills not installed (neither in `CONFIG_DIR/skills/` nor in enabled plugins).
- **Line endings:** files keep their repo bytes (LF after checkout, except `*.ps1` and `*.vbs` CRLF per `.gitattributes`); hashes always use `hashFile`.

Exit codes: 0 ok, 2 needs an answer (conflict, local edit, risky key), 1 error. The skill reads `--json`, asks the person with AskUserQuestion, and re-runs with the answers.

## CLI additions (v1 build)
- `bootstrap --repo <clone>`: installs only the sync-engine part and records `repo.path`.
- `apply --no-fetch` skips `git fetch`; `apply --update-engine` installs a changed sync-engine alone (it runs from the next call).
- `plan --cards` / `plan --proposals <id>` always include cards; otherwise cards are left out when output would pass about 20,000 characters (`cards_omitted: true`).
- `catalog` returns a compact list; `catalog --parts a,b` returns full details, including `card`: the ready question text built by `partCard(entry, footprint)` in `lib/display.mjs` (what it is, solves, improves, use cases, affects with real file and settings counts, cost, needs). The skill shows it word for word.
- `adopt` output has `part_list` (id, title, summary, files_written) so the skill can name every part it takes over.
- A pending proposal for a part that is not installed carries `part_card`, the same card text.
- Cards for proposals also print the "How it affects the agent" and "Undo" sections of the proposal file.
- `--fable yes|no` answers an unknown Fable check; `--crash finish` closes a crashed run, `rollback --crashed` undoes it.
- `--confirm-risky <id>` takes proposal ids on sync and part ids on first run; `ask_alone` parts always need it.
- Built-in skill names (`BUILTIN_SKILLS` in `lib/install.mjs`) always count as installed when pruning skill overrides.
- Backups: `CONFIG_DIR/state/claude-manners/backups/<date>/<runId>/`, outside `~/.claude/backups`, which a cleanup tool empties after 90 days.
