# Setup: two Claude accounts + status line

Part of the setup pack (group 10). The main SETUP-PROMPT.md sends you here; when done, return to it.

This file is for a Claude Code agent running on Windows. Follow it step by step on the user's PC. At the end: plain `claude` opens the main account and `claude -P` opens a second account, both signed in at the same time. They share sessions, plans, skills, plugins and settings. A status line shows an account tag (for example Work or Personal) in both. The rules file `~/.claude/rules/setup-pack/accounts.md` tells you the rules of this setup in later sessions.

Tested on: Windows 11, Claude Code 2.1.327, Node v24.22.1, Git for Windows bash, PowerShell 7.7 and Windows PowerShell 5.1.

## What gets installed

| Pack file | Installed to | Purpose |
|---|---|---|
| `02-settings/statusline.sh` | `~/.claude/statusline.sh` | Status line script with the account tag |
| `10-two-accounts/sync-second-profile.mjs` | `~/.claude/tools/sync-second-profile.mjs` | Prepares the second profile before each launch (junctions, settings, MCP servers) |
| `10-two-accounts/wrapper.bash` | block appended to `~/.bashrc` | `claude` function for Git Bash |
| `10-two-accounts/wrapper.ps1` | block appended to the PowerShell profile at `$PROFILE.CurrentUserAllHosts` (per PowerShell he uses) | `claude` function for PowerShell |
| `10-two-accounts/accounts.md` | `~/.claude/rules/setup-pack/accounts.md` | Tells Claude the rules of this setup |
| `02-settings/sample-statusline-input.json` | not installed | Test input for the verify step |
| `SHA256SUMS.txt` | not installed | Hashes of every pack file, at the pack root (format of `sha256sum`) |
| `02-settings/STATUSLINE.html` | not installed | Explains each status line part to the user |

## Definition of done

- [ ] Both profiles open from every shell he uses (Git Bash, PowerShell), and plain `claude` still works there.
- [ ] Each profile shows its own account tag in the status line.
- [ ] A second sync run prints `[second profile] no changes` (or only harmless warnings, see Step 9a).
- [ ] Junctions from the second folder into `~/.claude` are present.
- [ ] `claude mcp list` shows the same user-scope servers in both profiles.
- [ ] `~/.claude/rules/setup-pack/accounts.md` is present with no `{{` left.
- [ ] The report is delivered and every backup is listed in it.

## Hard rules

- Your Bash tool does not keep variables or functions between calls. Note the absolute path of this pack folder now (`pwd -W`) and write it out in every command that needs it.
- Back up every file before changing it, into `~/.claude/backups/<yyyy-mm-dd>-accounts-setup/`, keeping its path relative to `~`. Put these two lines at the start of every command that backs up, then call `bk <path>`:
  ```bash
  B="$HOME/.claude/backups/$(date +%F)-accounts-setup"
  bk() { local p h d; p=$(cygpath -u "$1"); h=$(cygpath -u "$HOME"); [ -e "$p" ] || return 0; [ -d "$p" ] && { echo "bk: $p is a folder, use mv" >&2; return 1; }; d="$B/${p#$h/}"; [ -e "$d" ] && return 0; mkdir -p "$(dirname "$d")" && cp -p "$p" "$d"; }
  ```
  The first backup of a file is kept; a second `bk` of the same file on the same day does nothing. It refuses folders; move a folder into the backup with `mv` instead.
- Never delete the user's data. Move it into that backup instead.
- Never open `.credentials.json`. From any `.claude.json` read only `.oauthAccount.emailAddress` and never print the rest.
- Ask the user before every decision and on every conflict. Use the AskUserQuestion tool when it is available.
- Copy pack files with `cp`, never retype them. The main SETUP-PROMPT.md already ran `sha256sum -c SHA256SUMS.txt` at the pack root; if you came here directly, run it there first.
- Keep LF line endings in `.sh` and `.bash` files.
- In Git Bash, `cmd` switches need a double slash: `cmd //c dir //AL "<path>"`. A single `/AL` is rewritten to a Git folder path and lists the wrong folder.
- If anything does not match these directions, stop and ask.

## Step 1 - Own session check

Run `echo "${CLAUDE_CONFIG_DIR:-unset}"`.
- `unset`: go on.
- Any value: do not change anything yet. Run only the `CLAUDE_CONFIG_DIR` checks of Step 3 to find where it is set.
  - Set as a User variable or in a profile file: ask to remove it (method in Step 3), then tell him to open a NEW terminal, start plain `claude` and say `Follow SETUP-PROMPT.md` again. Stop.
  - Set only in this terminal: tell him to close this session, start plain `claude` from a new terminal and say `Follow SETUP-PROMPT.md` again. Stop.

## Step 2 - Preflight (read-only)

Run the checks, then report them as a short table (item, required or recommended, result).
- **Git for Windows** (required): `bash --version` and `git --version`.
- **Node** (required): `node --version`. Tested with v24.22.1. If missing, ask before installing; find the official package with `winget search`.
- **jq** (recommended): `jq --version`. If missing, offer `winget install jqlang.jq`. Without jq the status line uses a weaker fallback parser.
- After installing Node or jq: this session keeps the old PATH. Tell him to close it, open a new terminal, start `claude` and say `Follow SETUP-PROMPT.md` again (re-running is safe). Stop.
- **Claude Code**: `where.exe claude` and `claude --version` (note the version for Step 5). Install type: native (`~/.local/bin/claude.exe`) or npm (`claude.cmd`). If older than 2.1.329, offer `claude update`.
- **Home folder**: `[ "$(cygpath -m ~)" = "$(cygpath -m "$USERPROFILE")" ] && echo same || echo DIFFERENT`. The pack uses both, so on `DIFFERENT` stop and ask.
- **Shells he uses**: ask which of Git Bash, PowerShell 7 (`pwsh`) and Windows PowerShell 5.1 (`powershell`). Every later step runs for each of them.
- **PowerShell execution policy**, for each PowerShell he uses: `pwsh -NoProfile -Command 'Get-ExecutionPolicy; Get-ExecutionPolicy -List'` (same with `powershell`). The first line is the effective policy; the profile only loads under RemoteSigned, Unrestricted or Bypass.
  - If MachinePolicy or UserPolicy is set, it is a Group Policy: stop and ask.
  - If the effective policy is Restricted or AllSigned, ask before running `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force` in that PowerShell.

## Step 3 - Inventory (read-only, then report and ask)

Collect and report:
- Every `~/.claude*` entry: `ls -d ~/.claude*` (folders and `~/.claude.json`).
- For each config folder:
  - Its login email, the field only: `jq -r '.oauthAccount.emailAddress // empty' <file>`. The main file is `~/.claude.json`; any other folder has `<folder>/.claude.json`.
  - Whether `projects`, `plugins` and `skills` are real folders or junctions: `cmd //c dir //AL "$USERPROFILE\\<folder>"` lists the junctions.
  - Whether it has its own `settings.json`.
- `CLAUDE_CONFIG_DIR` in each of these places:
  - The User and Machine environment: `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('CLAUDE_CONFIG_DIR','User')"`, and the same with `'Machine'`.
  - `~/.bashrc`, `~/.bash_profile`, `~/.bash_login`, `~/.profile`.
  - All four PowerShell profiles of each PowerShell he uses: `pwsh -NoProfile -Command '$PROFILE.AllUsersAllHosts; $PROFILE.AllUsersCurrentHost; $PROFILE.CurrentUserAllHosts; $PROFILE.CurrentUserCurrentHost'` (same with `powershell`). Check the files that exist.
  - Windows Terminal and VS Code settings: `grep -n CLAUDE_CONFIG_DIR "$LOCALAPPDATA"/Packages/Microsoft.WindowsTerminal*_*/LocalState/settings.json "$LOCALAPPDATA/Microsoft/Windows Terminal/settings.json" "$APPDATA/Code/User/settings.json" 2>/dev/null`.
- Any existing `claude` alias or function in all those profile files. One in a PowerShell `CurrentUserCurrentHost` profile loads later and overrides our block: ask.
- An existing `statusLine` in `~/.claude/settings.json` or `~/.claude/settings.local.json`, and an existing `~/.claude/statusline.sh`. A `statusLine` in `settings.local.json` may override ours: ask.
- Marker blocks from an earlier run of this pack. They get replaced, never duplicated.

If `CLAUDE_CONFIG_DIR` is set globally, explain that plain `claude` would then not open the main profile, and ask to remove it. Record the old value in the report. How:
- User variable: `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('CLAUDE_CONFIG_DIR', \$null, 'User')"`.
- Machine variable: needs admin; tell him to remove it himself.
- Profile file: `bk` it, then delete that line.

### Existing second folder

The rare case. If any `~/.claude-*` config folder with its own login exists, stop and ask:
- (a) Adopt it. Its name must match `.claude-<letters, digits, _ or ->` or the sync refuses it; otherwise stop and ask.
  - Keep its name as the second folder (set it in the wrappers in Step 5).
  - `bk` its `settings.json`, `keybindings.json`, `CLAUDE.md` and `.claude.json`. Tell him that `settings.json`, `keybindings.json` and `CLAUDE.md` there are replaced on every launch of the second profile, and ask whether to merge his rules from that `CLAUDE.md` into `~/.claude/CLAUDE.md` first.
  - Merge its real `projects`, `file-history`, `plans`, `tasks` and `skills` content into the matching `~/.claude` folders without overwriting; ask on every same-name file. Then move those real folders into the backup.
  - Do not merge `plugins`: move it into the backup; plugins get reinstalled in the main profile.
  - Then create `<folder>/.accounts-setup-done`.
- (b) Move the whole folder into the backup and start fresh. If it contains junctions, remove them first as described in Rollback.

Never delete it. Without the `.accounts-setup-done` marker the sync refuses with exit 2 and the wrapper does not launch.

## Step 4 - Decisions (ask)

1. **Layout.** Recommended: main = work, `claude -P` = personal, second folder `~/.claude-personal`. Alternative: main = personal, `claude -W` = work, second folder `~/.claude-work`. The wrapper removes the flag wherever it appears before a `--`, so the letter must not be a real short flag: check `claude --help`, `claude mcp --help` and `claude plugin --help` (flags are case-sensitive; lowercase `-p` and `-w` are real Claude Code flags).
2. **Shared history.** Recommended: share. Sessions, `/resume`, plans and tasks are then visible from both profiles, and resuming a chat in the other profile sends it to that account. If he says no: in Step 5.2, right after copying the script and before any sync runs, remove `'projects', 'file-history', 'plans', 'tasks'` from the `LINKED` array in the INSTALLED copy (near the top: `const LINKED = ['projects', 'file-history', 'plans', 'tasks', 'skills', 'plugins', 'channels', 'ide'];`). Its hash will then differ from `SHA256SUMS.txt`; expected. If a sync already ran, first remove those four junctions with `cmd //c rmdir`. Adapt the CLAUDE.md block in Step 8.
3. **Main login check.** Run `jq -r '.oauthAccount.emailAddress // empty' ~/.claude.json` (without jq: `grep -o '"emailAddress": *"[^"]*"' ~/.claude.json`). If it is not the account he chose as main, he runs `/login` in a plain `claude` window and signs in with that account (you cannot do it for him). Re-check afterwards.

## Step 5 - Install (back up each target first)

1. At the pack root run `sha256sum -c SHA256SUMS.txt`. Every line must say OK. Otherwise stop.
2. `mkdir -p ~/.claude/tools`, then `cp 10-two-accounts/sync-second-profile.mjs ~/.claude/tools/`. Apply the "not shared" edit from Step 4.2 now if he chose it.
3. Status line script:
   - If `~/.claude/statusline.sh` exists without an `ACCT1_MATCH=` line, it is his own: ask before replacing it.
   - If it has an `ACCT1_MATCH=` line, it is from an earlier run of this pack: note its `ACCT1_*`, `ACCT2_*` and `SHOW_RC` lines, and re-apply them after the copy.
   - `cp 02-settings/statusline.sh ~/.claude/statusline.sh`.
4. `~/.claude/settings.json`: set `statusLine` to `{"type": "command", "command": "bash ~/.claude/statusline.sh"}` and keep every other key.
   - If a `statusLine` with another command exists, ask first and record the old value.
   - Example: `jq '.statusLine = {"type":"command","command":"bash ~/.claude/statusline.sh"}' ~/.claude/settings.json > "<scratch>/settings.tmp" && mv "<scratch>/settings.tmp" ~/.claude/settings.json`. Without jq, make the same change with your file edit tool.
   - Create the file if it is missing. Validate with `jq -e . ~/.claude/settings.json`.
5. **Inserting a block** (used for `.bashrc`, the PowerShell profiles and CLAUDE.md), for a file `F`:
   - `bk "$F"`. For a PowerShell profile also run `head -c2 "$F" | od -An -tx1`; if it prints `ff fe` (UTF-16), stop and ask.
   - Remove an old block: `sed -i '/^# >>> claude accounts >>>/,/^# <<< claude accounts <<</d' "$F"` (for CLAUDE.md: `sed -i '/^<!-- claude-accounts:start -->/,/^<!-- claude-accounts:end -->/d' "$F"`).
   - Make sure the file ends with a newline: `[ -s "$F" ] && [ -n "$(tail -c1 "$F")" ] && printf '\n' >> "$F"`.
   - Append: `printf '\n' >> "$F"; cat <block file> >> "$F"`.
6. **Bash wrapper** (if he uses Git Bash): insert `10-two-accounts/wrapper.bash` into `~/.bashrc` (create it if missing).
   - Flipped layout: change its first line to `local second_flag='-W' second_dir='.claude-work'`.
   - Check `bash -lic 'type -t claude'` prints `function`. If not, ask, then add `[ -f ~/.bashrc ] && . ~/.bashrc` to the first existing of `~/.bash_profile`, `~/.bash_login`, `~/.profile` (create `~/.bash_profile` only if none exists). Note in the report that you added it.
   - Check `bash -lic 'claude --version'` prints the same version as in Step 2. If not, remove the block and ask.
7. **PowerShell wrapper**, for each PowerShell he uses:
   - Use the `CurrentUserAllHosts` path from Step 3 (never guess it; Documents may be redirected to OneDrive). Create the folder and file if missing, then insert `10-two-accounts/wrapper.ps1`.
   - Flipped layout: change its two value lines to `$secondFlag = '-W'` and `$secondDir = '.claude-work'`.
   - Check `pwsh -Command "(Get-Command claude).CommandType"` prints `Function`, and `pwsh -Command "claude --version"` prints the same version as in Step 2 (same with `powershell`). If not, remove the block and ask.
8. If the sync ever warns `claude executable not found, MCP not synced (set CLAUDE_ACCOUNTS_CLAUDE_BIN)`: ask, then `setx CLAUDE_ACCOUNTS_CLAUDE_BIN "C:\full\path\to\claude.exe"`. The value must be a real `claude.exe`, never `claude.cmd`. New terminals see it. If his install has no `claude.exe`, stop and ask.

9. Session-start sync hook: merge `10-two-accounts/settings-snippet.json` into `~/.claude/settings.json` (`bk` it first).
   - Append its `hooks.SessionStart` entry to the existing `hooks.SessionStart` array. Never replace existing entries; create the keys only if missing.
   - Skip it if an entry with the same `command` already exists.
   - Fill `{{SECOND_DIR}}` with the second folder name from Step 4 (with the dot, e.g. `.claude-personal`) in the merged text.
   - Validate with `jq -e . ~/.claude/settings.json` and check `grep -c '{{' ~/.claude/settings.json` prints 0.

Explain the wrapper to him in 3 bullets:
- No flag: it runs the real `claude` unchanged.
- With the flag (case-sensitive): it runs the sync, then launches claude with `CLAUDE_CONFIG_DIR` set for that one process only. A flag after `--` is passed through untouched.
- If the sync exits with 2 it prints why and does not launch (see Existing second folder). If node is missing it warns and does not launch.

## Step 6 - Second login

1. You: run `node ~/.claude/tools/sync-second-profile.mjs --profile-dir <dir>` once (`<dir>` = the second folder name, e.g. `.claude-personal`). Expect one line `[second profile] created <dir>, linked projects, ...` and no warnings. Show it in the report.
2. Then tell him to:
   1. Open a NEW terminal, so the wrapper loads.
   2. Run `claude -P` (or his flag). A first-run screen (theme, login method) may come first.
   3. Run `/login` and sign in with the other account.
   4. Accept the folder trust prompt.
   5. Run `/status`, check that it shows the other email, then exit.

The status line shows in the second profile only after the folder is trusted. Wait for his confirmation before going on.

## Step 7 - Account tags

1. Read the two emails (the field only) from `~/.claude.json` and from `~/<dir>/.claude.json` (without jq use the `grep -o` form from Step 4.3).
   - Second email empty: the login was not completed; go back to Step 6.
   - Both equal (compare case-insensitively): stop and report; the same account was used twice.
2. In `~/.claude/statusline.sh` (`bk` it first) set `ACCT1_MATCH` to the work email and `ACCT2_MATCH` to the personal email, in BOTH layouts. The tags follow the accounts, not the profiles. The value is an email or a bash glob; a domain glob like `*@company.com` is fine for work.
3. Keep the labels Work and Personal and the colors BLUE and PINK unless he wants others. Allowed colors: RED GREEN YELLOW GRAY BLUE PINK TEAL ORANGE.
4. Ask about `rc`. It is green when this session can be followed from claude.ai or the phone through Remote Control, red when not. Recommend keeping it if he uses Remote Control; otherwise set `SHOW_RC=0`.

Editing the file changes its hash; that is expected.

## Step 8 - Accounts rules file

1. Copy `10-two-accounts/accounts.md` to `~/.claude/rules/setup-pack/accounts.md` (`mkdir -p ~/.claude/rules/setup-pack` first; `bk` the target if it already exists). Do not edit CLAUDE.md for this. Then fill the placeholders in that copy with `sed -i`, using `|` as the separator:
   - `{{MAIN_LABEL}}`: the label (from Step 7) of the account logged in under `~/.claude` (Work in the recommended layout, Personal in the flipped one). `{{SECOND_LABEL}}`: the other label.
   - `{{MAIN_EMAIL}}`, `{{SECOND_EMAIL}}`: the real login emails from Step 7.1.
   - `{{SECOND_FLAG}}`: e.g. `-P`. `{{SECOND_DIR}}`: with the dot, e.g. `.claude-personal`.
   - Check `grep -c '{{' ~/.claude/rules/setup-pack/accounts.md` prints 0.
2. If history is not shared: in the copied rules file, drop `projects`, `file-history`, `plans` and `tasks` from the "Shared by both" bullet, add one line saying session history and `/resume` are separate per profile, and delete the "Resuming a session..." bullet.
3. If an old block between `<!-- claude-accounts:start -->` and `<!-- claude-accounts:end -->` exists in `~/.claude/CLAUDE.md` (from an earlier run of this pack), remove it with the CLAUDE.md `sed -i` line of Step 5.5, after `bk`.
4. Do not edit the second profile's CLAUDE.md; the sync writes it.

## Step 9 - Verify (each must pass; show the output in the report)

Below, `<dir>` is the second folder name (for example `.claude-personal`) and `<pack>` the absolute pack path.

a) `node ~/.claude/tools/sync-second-profile.mjs --profile-dir <dir>` prints `[second profile] no changes` and exits 0.
   - `warning: local MCP skipped, <path> not found` is harmless (an old project folder): count it as passed, list it in the report.
   - Any other warning (`is a real folder`, `points to`, `mcp ... failed`, `sync stopped`, `cannot read ~/.claude.json`): stop and ask.

b) `cmd //c dir //AL "$USERPROFILE\\<dir>"` lists the junctions into `.claude`.

c) The status line under both profiles with fresh reset times:
```bash
cd "<pack>"
TMPFILE="<absolute scratch folder>/sl-input.json"
now=$(date +%s)
sed -e "0,/4102444800/s//$((now+7200))/" -e "s/4102444800/$((now+259200))/" 02-settings/sample-statusline-input.json > "$TMPFILE"
env -u CLAUDE_CONFIG_DIR bash ~/.claude/statusline.sh < "$TMPFILE"; echo
CLAUDE_CONFIG_DIR="$USERPROFILE\\<dir>" bash ~/.claude/statusline.sh < "$TMPFILE"; echo
```
The sample file has `4102444800` as both reset times; the snippet replaces them. Expect the main tag on the first line and the second tag on the other line, `5h 42% · ↻ 1h59m` or close, and `7d 18% · ↻ 2d23h` or close. A raw email instead of a tag means it does not match `ACCTn_MATCH`: compare them.

d) From the same folder, `command claude mcp list` and `CLAUDE_CONFIG_DIR="$USERPROFILE\\<dir>" command claude mcp list`. Compare user-scope server names only; ignore entries that belong to the account (claude.ai connectors). Servers using OAuth may show as needing sign-in in the second profile until he signs in there. The command health-checks every server and can take a while.

e) The user opens plain `claude` and `claude -P` in new terminals and confirms each shows its own tag.

f) `bash -lic 'type -t claude'` prints `function`, and in PowerShell `(Get-Command claude).CommandType` prints `Function`.

## Step 10 - Report

Give the user:
- A short table: step, result.
- The files changed, each with its backup path.
- The decisions he made.
- Anything skipped, failed or added (e.g. a `.bashrc` source line, `CLAUDE_ACCOUNTS_CLAUDE_BIN`).

Then tell him to open `02-settings/STATUSLINE.html`.

## Rollback (only if he asks)

1. Remove the marker blocks from `~/.bashrc`, the PowerShell profiles and `~/.claude/CLAUDE.md` (the `sed -i` lines of Step 5.5). Delete `~/.claude/rules/setup-pack/accounts.md`, and remove the sync entry this setup added to `hooks.SessionStart` in `settings.json`. Also remove the `[ -f ~/.bashrc ] && . ~/.bashrc` line if this setup added it, and the User variable `CLAUDE_ACCOUNTS_CLAUDE_BIN` if it was set.
2. Restore `settings.json` from the backup, or delete its `statusLine` key.
3. Remove or restore `~/.claude/statusline.sh` and `~/.claude/tools/sync-second-profile.mjs`.
4. To remove the second profile: FIRST remove every junction, one by one, with `cmd //c rmdir "$USERPROFILE\\<dir>\\<name>"`. Confirm with `cmd //c dir //AL "$USERPROFILE\\<dir>"` that none is left. Only then move the folder into the backup.
5. Tell him to open new terminals; open ones still have the old function.

**Never delete a folder that still contains junctions. A recursive delete can empty the shared folders in `~/.claude`.**

## Daily use

- Change settings, MCP servers and plugins in the main profile only. The sync copies them to the second profile on every `claude -P`.
- From a second-profile session, install with `env -u CLAUDE_CONFIG_DIR claude ...` (for example `claude plugin ...`, `claude mcp add ...`) so it lands in the main profile.
- In PowerShell, quote a `--` (`'--'`) in claude commands: PowerShell drops a bare `--` before the wrapper sees it.
- cmd.exe and IDE extensions open the main profile only.
- Re-running this setup is safe: marker blocks are replaced, not duplicated.
- If something from the other account fails, it is likely the account split (separate login, limits, claude.ai connectors), not a bug.
