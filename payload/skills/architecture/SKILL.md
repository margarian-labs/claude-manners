---
name: architecture
description: Create or evaluate an architecture decision record (ADR). Use when choosing between technologies (e.g., Kafka vs SQS), documenting a design decision with trade-offs and consequences, reviewing a system design proposal, or designing a new component from requirements and constraints.
argument-hint: "<decision or system to design>"
---

# /architecture

Create an Architecture Decision Record (ADR) or evaluate a system design.

## Usage

```
/architecture $ARGUMENTS
```

## Modes

**Create an ADR**: "Should we use Kafka or SQS for our event bus?"
**Evaluate a design**: "Review this microservices proposal"
**System design**: "Design the notification system for our app"

## Output - ADR Format

```markdown
# ADR-[number]: [Title]

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** [Date]
**Deciders:** [Who needs to sign off]

## Context
[What is the situation? What forces are at play?]

## Decision
[What is the change we're proposing?]

## Options Considered

### Option A: [Name]
| Dimension | Assessment |
|-----------|------------|
| Complexity | [Low/Med/High] |
| Cost | [Assessment] |
| Scalability | [Assessment] |
| Team familiarity | [Assessment] |

**Pros:** [List]
**Cons:** [List]

### Option B: [Name]
[Same format]

## Trade-off Analysis
[Key trade-offs between options with clear reasoning]

## Consequences
- [What becomes easier]
- [What becomes harder]
- [What we'll need to revisit]

## Action Items
1. [ ] [Implementation step]
2. [ ] [Follow-up]
```

## If Connectors Available

If a knowledge base connector is available:
- Search for prior ADRs and design docs
- Find relevant technical context

If a project tracker connector is available:
- Link to related epics and tickets
- Create implementation tasks
