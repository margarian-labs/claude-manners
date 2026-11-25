---
name: grilling
description: Interview the user in rounds until a plan, design or decision has nothing left assumed. Use on your own before finalizing a plan for a new project or feature, an architecture or data-model choice, or anything costly to undo, when it rests on things the user has not confirmed; and whenever the user says "grill" or asks to stress-test an idea. Not for small tasks or bug fixes.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

When you start this on your own, first say in one line which unconfirmed assumptions made you start. If the user says they do not want the interview, stop and carry on with the task.

An instruction not to ask or wait (for example away mode) wins over this skill: ask at most the one round it allows, then go on with your best assumptions and list them.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the frontier in one round, then wait for the user's answers before the next round.

Ask every round with the AskUserQuestion tool, never as a list in chat. One call holds up to 4 questions; if the frontier is bigger, ask the 4 most important now and the rest in the next round. Each question stands on its own (say briefly what it depends on), has 2-4 concrete options, and puts your recommended answer first with "(Recommended)" at the end of its label.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

With docs: when the user asks for docs ("with docs"), or the repo already has a GLOSSARY.md or ADRs, also call the Skill tool for "domain-modeling" and write settled terms and decisions down as you go. If that skill is not installed, say so and continue without docs.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
