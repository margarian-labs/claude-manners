---
name: feedback-measure-token-savings
description: Check real usage logs before calling something a token leak; sort changes by quality risk; offer unverifiable ones as a measured trial
metadata:
  type: feedback
---

Before calling part of the setup a token leak, check the saving against real usage logs, and never promise that a change is quality-neutral when that cannot be verified.

**Why:** Cached context (always-loaded rules) is cheap per token, so trimming it saved far less than its size suggested; in the real logs the big costs were long contexts. A change sold as "free" can quietly lower quality.

**How to apply:**
1. Measure first: cost per item from local transcripts or usage reports, not from file sizes.
2. Say which numbers are measured and which are estimates.
3. Sort the proposed changes by quality risk; propose the ones with no plausible quality effect.
4. Offer a change that can't be verified as a trial: what is measured, for how long, how to undo it.

Related: [[feedback-flags-only-rejection]].
