---
name: feedback-shareable-prompts
description: Prompts and playbooks for other people's agents must give directions (how to investigate and judge), not machine-specific recipes
metadata:
  type: feedback
---

When writing a prompt or playbook that someone else will give to their own agent, write directions: what to look for, what evidence to collect, how to find the official method on their machine, when to ask. Concrete paths, commands and apps from your own session appear only as short "for example" illustrations.

**Why:** The other person's machine has different apps and a different layout. A recipe copied from your session fails there or does the wrong thing. Their agent has to analyze each item on its own machine.

**How to apply:** structure the prompt as:
1. Context and why
2. Definition of done
3. Hard rules, each with its reason
4. Method
5. Areas checklist
6. Lessons as general rules, each with a one-line anonymized example
7. Report format

Keep every lesson learned in the session (map each one explicitly), and strip personal data: names, hosts, company, projects, tokens.

Related: [[feedback-disk-cleanup-depth]].
