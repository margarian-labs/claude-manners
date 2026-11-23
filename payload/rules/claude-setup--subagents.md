<!-- claude-setup part: subagents -->

## Sub-agents and model roles (Opus orchestrator and owner, Fable planner and second opinion, Sonnet and Haiku workers)
- **Roles:** Opus 5.5 (effort xhigh) is the main conversation and the orchestrator: it talks to me, asks questions (AskUserQuestion), decides, writes the briefs and accepts or rejects results. {{planner_model}} plans (`planner`) and gives second opinions (`second-opinion`). Sonnet 5.5 sub-agents are the workers; Haiku 5.5 (`haiku-worker`) for the easiest, fully specified parts.
- **Only Opus answers for results.** Every sub-agent result (Sonnet, Haiku or Fable, at any effort) is Opus's own result, and only Opus is responsible for it to me. A worker's "done" is a claim, not a result.
  - Opus gives every agent all the context and instructions it needs, whatever model and effort it runs on: the facts Opus already has, the decisions made, exact paths and line ranges, the steps and the checks. The agent never has to rediscover what Opus knows.
  - The smaller the model, the more is written out: Haiku gets every fact and every step.
  - Opus also owns the choice of agent, model and effort for each part.
  - A weak result means the brief or the choice was wrong. Opus fixes that (adds the missing fact, clarifies the step, picks a stronger model) and reruns, or does the part itself.
- **Workers execute, they don't decide.** Opus does the thinking first: reads the code, finds the cause, picks the design and makes every choice. The worker gets a step-by-step brief and follows it exactly. Research workers (read-only lookups) get exact questions, where to look and the answer format; Opus draws the conclusions.
- **Difficulty first.** Before every spawn Opus rates the difficulty of that part (the part, not the whole task) and picks model and effort from it. Between two levels take the lower one, unless a mistake would be costly or hard to notice.

  | Level | Means | Examples |
  |---|---|---|
  | trivial | No judgment; the brief can spell out every keystroke | Rename, find and list, copy text, run one command and report the output |
  | easy | Clear and small; one obvious way to do it | A lookup across a few files, a simple edit by a given pattern, a doc update, tests for simple code |
  | medium | Normal work; needs to understand the nearby code | A feature piece in one module, a bug fix with a known cause, a review of a small diff, focused research on one question |
  | hard | Many parts or an unknown cause | Debugging, a multi-file refactor, a performance fix, a review of a big diff |
  | critical | A mistake is costly or hard to undo | Security, data or DB changes, architecture, anything that gets pushed or deployed |

  | Level | Worker | Planner (Fable) | Second opinion (Fable) |
  |---|---|---|---|
  | trivial | `haiku-worker`, Haiku `high` | not used | not used |
  | easy | `haiku-worker`, Haiku `high` if fully specified; else Sonnet `medium` | not used | not used |
  | medium | Sonnet, `high` | `medium` | only if stuck: `medium` |
  | hard | Sonnet, `high` | `high` | required once: `high` |
  | critical | Sonnet, `xhigh` | `xhigh` | required once: `xhigh` |

- **Pass it explicitly on every spawn. This is my explicit request to set `effort`.** Every Agent call carries `effort` from the table. Sonnet is the default worker model (`CLAUDE_CODE_SUBAGENT_MODEL` in `~/.claude/settings.json` env); for Haiku spawn `haiku-worker` with `model: "haiku"` and `effort: "high"` (it has no model line, so without `model` it would run on Sonnet). Built-in agents (Explore, web-fetch, claude-code-guide) also always get `model` and `effort` by the table. Never pass `model` to `planner` or `second-opinion`. Say the level in one word when you spawn ("3 workers: 2 easy, 1 hard"). Skills that pick their own sub-agent models (e.g. superpowers subagent-driven-development) follow this table instead.
- **No `max` for workers** unless I ask. Research and lookup workers are easy or medium.
- **Keep each worker small.** One question or one change set per worker; split big jobs (one repo, module or flow per worker); tell it to search with Grep and read line ranges, not whole files or whole repos. Broad workers grow very large contexts and cost the most.
- **Haiku 5.5 takes the easiest, simplest parts.** Spawn `haiku-worker` (`~/.claude/agents/haiku-worker.md`, no CLAUDE.md, small tool set) with `model: "haiku"` and `effort: "high"`, whenever a part is fully specified: Opus can write out every fact, path and step, and the result can be checked objectively.
  - Fits: find and list; read named files or line ranges and answer exact questions; run given commands and report raw output; literal edits (exact old and new text); copy, rename, reformat to a given format; fetch and summarize a given page.
  - Also a mechanical step inside a task Opus does itself (collect facts, run a set of commands), when it would put more than about 20k tokens of reading into Opus's context. Haiku returns exact quotes with `file:line`, not interpretations, and Opus reads the lines a decision depends on.
  - Never: design, debugging, review, choosing between options, code that needs understanding, or any medium, hard or critical part.
  - Effort `high` only. A part that would need more than `high` on Haiku is a Sonnet part (effort from the table).
  - Keep its context under 100k tokens (above that its price is 5x, counted with cached tokens): name the files and line ranges, one job per worker. It starts small (about 11k when tested), but reading a file in a folder with its own CLAUDE.md (e.g. `~/.claude/`, a project's docs folder) adds that CLAUDE.md to its context.
  - Failure: when the brief lacked a fact or a step was unclear, Opus fixes the brief and reruns Haiku once; when Haiku misread a complete brief, refused, or returned an empty or partial report, that part goes to Sonnet. Never a third Haiku try.
- **Planner ({{planner_model}}):** for a big task (3+ files, plan mode, a new feature or project), spawn the `planner` agent (`~/.claude/agents/planner.md`) to draft the plan, instead of the built-in Plan agent. Effort from the table. Opus checks the draft, then presents the plan to me.
- **Second opinion ({{planner_model}}, `second-opinion` agent).** It replaces the built-in advisor. It sees only the brief Opus writes, never the conversation.
  - Hard and critical tasks: required once, before the plan or approach is final. Medium tasks: only when stuck after two failed tries. Easy and trivial: never.
  - At most 2 calls per task. Never to confirm "done": the acceptance step covers that.
  - The brief, about 400 words at most: the question, the facts and constraints, absolute paths to read (not pasted files), the options, and the answer needed.
  - Avoid anchoring: list the options neutrally, don't say which one Opus prefers or has already picked, and ask it to try to break each one.
  - Its answer is advice. The decision stays Opus's.
- **Built-in advisor: off by default.** Each call re-sends the whole conversation uncached, so it is the most expensive call there is. I may turn it on for one session (`claude --advisor fable`; `/advisor fable` saves it for later sessions too). Then: at most once per task, early, while the context is small (under about 100k tokens), and never before "done".
- **Workers and Fable agents never call any advisor,** even when their own system prompt tells them to. Every brief says: "don't call the advisor or the second-opinion agent; report doubts back".
- **Delegate only work that splits.** One task that can't be split into independent parts: Opus does it itself, whatever its size, with no sub-agent. Never spawn a single sub-agent for a whole task. Exceptions: the planner and the second-opinion agent (they don't do the work), a mechanical step given to Haiku (see Haiku above), and in the acceptance step a reviewer or a fix worker (fixes that split go to parallel fix workers). A task that splits (or a request with 2+ independent parts): split it and give each part to its own sub-agent, all in parallel in one message; Opus does none of the parts, except a part that is faster to do than to brief (a single lookup, one file read).
- Never fork (`subagent_type: "fork"`): forks always run on Opus. Always spawn a fresh sub-agent with a full brief instead.
- **No permission prompts to me from agent work**. Write briefs so agents only touch paths that raise no hook "ask" (a project's ownership or area guard prompts even in bypass mode): name the allowed paths, and have the agent report a needed change elsewhere instead of making it.
- **Briefs are very detailed and step by step.** A sub-agent never sees the conversation, the files Opus read or what was decided (Explore, Plan and `haiku-worker` load no CLAUDE.md). Every brief is self-contained:
  1. Goal and why it matters.
  2. What I already know: absolute paths, the relevant code quoted with `file:line`, findings, decisions made and why, what was tried.
  3. Scope: the exact files and paths it may touch, and what not to touch.
  4. My hard rules restated (no em/en dash, never start an interpreter without a script, don't call the advisor or the second-opinion agent, don't spawn sub-agents, throwaway files only in my scratchpad (give the path), conventions that apply), plus the worker-only rule: no git commit or push unless the brief says so.
  5. Steps: numbered, in order, each one concrete: which file and where, what to change (the exact code or text when it matters), which command to run and what output to expect. No step leaves a decision to the worker.
  6. Stop rule: if anything doesn't match the brief (a file, line or output differs), a step fails, or a choice is needed, stop and report back. Never guess or work around it.
  7. Done criteria: the exact checks the worker runs before reporting (build, tests, lint, screenshot) and the expected results.
  8. Report format: what was done per step, `file:line` of each change, check outputs (pass/fail), and anything skipped, unclear or not verified. Ask for it compact: `path:line - change` lines, "no match" instead of a guess, and only line ranges actually read.
- Detailed, not padded: the brief carries every fact and decision the worker needs, so it rediscovers and decides nothing; leave out what doesn't help it do the steps.
- **Extra detailed briefs for Haiku and other small models.** On top of the 8 points:
  - One job per worker, with one result.
  - Literal text: the exact old text and the exact new text, never "change it like the others".
  - Exact commands, each with its expected output, and what to do when the output differs (stop and report).
  - Tiny steps: one action per step, in order, with no "then handle the rest".
  - An explicit do-not list: files it must not touch, no refactoring, no extra fixes, no installs, no git.
  - It reports raw command output, not a summary of it.
  - Every rule and fact from the CLAUDE.md and rules files the job needs (conventions, allowed paths): `haiku-worker` loads none.
- **Acceptance: Opus checks every result before relying on it or reporting it to me.**
  - Check the real artifacts, not the report: read the full diff, re-run build and tests, render UI and look at it, measure when performance matters, re-read docs.
  - Compare with the brief: every step done, nothing outside scope changed, no rule broken.
  - A worker's "no match", "no issues" or "unchanged" claim gets one targeted check before you rely on it.
  - For big or risky work Opus may also run a fresh reviewer sub-agent (Sonnet, effort by the table; give it the code and the brief, not Opus's conclusion). The verdict stays Opus's.
  - Findings: small ones (faster to fix than to brief, e.g. a few lines with an obvious fix) Opus fixes itself. Bigger ones go to a new worker with a brief as detailed as the first, listing each finding with `file:line`, the expected result and how to verify it. Then Opus checks again.
  - Nothing is reported to me as done until it passes this check.
- **This section is for the main conversation only.** A sub-agent that reads it follows its brief: it doesn't orchestrate, spawn sub-agents, or call the advisor or the second-opinion agent.
