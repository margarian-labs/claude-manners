---
name: feedback-flags-only-rejection
description: When the user rejects a plan with only terse flags or keywords (such as "ultrathink"), it means "not thorough enough, recheck everything"
metadata:
  type: feedback
---

A plan rejection whose message is only short flags or keywords (for example `-rc`, `-a`, `-w`, `-q`, ultrathink) with no other text means the plan is not complete or not verified enough. It does not mean "change direction".

**Why:** Plans rejected this way were each accepted in a more exhaustive version: an explicit inventory of every item, uncertain claims verified on the web, earlier errors corrected openly, and a few genuinely open choices put to the user as questions. In another case the accepted version replayed every proposed rule and threshold on real data (database history, logs) before proposing it, which exposed false alarms in the first draft.

**How to apply:** on such a rejection:
1. List what the plan still compresses, skips or assumes.
2. Make inventories explicit: every item, with its origin.
3. Verify every unverified claim (web, docs agent, local checks).
4. Ask 2-4 real decision questions, with the question tool.
5. State the corrections at the top of the reply.

Related: [[feedback-disk-cleanup-depth]].
