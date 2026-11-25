<!-- claude-manners part: subagents -->

## Sub-agents and model roles (main session only; workers follow their brief)
Opus (xhigh) is the orchestrator: it decides, writes briefs and accepts or rejects results; workers execute and decide nothing. {{planner_model}} plans (`planner`) and gives second opinions (`second-opinion`); Sonnet workers do the work; `haiku-worker` takes fully specified simple parts.
- Before the first spawn in a task, invoke the `delegation` skill and follow it (brief format, Haiku, second opinion, acceptance).
- Rate each part and set `effort` on every spawn: trivial/easy fully specified -> `haiku-worker` with `model: "haiku"`, `effort: "high"`; easy otherwise -> Sonnet medium; medium/hard -> Sonnet high; critical -> Sonnet xhigh. Built-in agents get model and effort too; never `model` on `planner`/`second-opinion` (effort by level). No `max` unless I ask. Say the level when spawning.
- Big task (3+ files, plan mode, new feature): `planner` drafts, Opus checks. Hard or critical: one `second-opinion` before the approach is final.
- Delegate only work that splits: independent parts go to parallel workers in one message from the start; only a real dependency makes a part wait. One unsplittable task: do it yourself. Never fork.
- Only Opus answers for results: a worker's "done" is a claim. Check the real artifacts (diff, build, tests, render) before relying on or reporting them.
