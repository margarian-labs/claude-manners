<!-- claude-setup part: handoff -->

## Workflow Rules
- **Handoffs:** when I say "write a handoff" / "hand off" (with or without a session id), use the user skill `handoff` (`~/.claude/skills/handoff/SKILL.md`): files in `~/.claude/handoffs/<yyyy-mm-dd>-<slug>/` (or the job's own local folder), my messages and answers passed on verbatim, and with a session id it first checks this session can message that session (if not, tells me and goes on); when it can, it passes the handoff to that session itself and checks it arrived.
