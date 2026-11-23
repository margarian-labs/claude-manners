---
name: diagram-craft
description: Use when drawing a diagram by hand - inline SVG, HTML/CSS boxes or Mermaid - for architecture, data flow, sequence, workflow, state or lifecycle, ERD, class, tree or timeline. Rules for picking the type, placing nodes so lines stay straight, readable labels, accuracy against the code, and a by-eye check before delivery.
---

# Diagram craft

Distilled from archify's authoring rules (see SOURCES.md), without its renderer. For SVG mechanics inside artifacts the built-in `artifact-diagramming` skill still applies; this adds layout and content rules.

## 1. Pick the type by the question

- Parts and boundaries = architecture. Process with gates and owners = workflow. Calls and returns over time = sequence. Pipeline or lineage = data flow. States and transitions = lifecycle. Tables and keys = ERD. Types and inheritance = class. Containment only = tree (never for calls or data movement). When = timeline. Where the time went = waterfall.
- Options compared on criteria = a table. Ordered actions = numbered steps. One number against a limit = a metric. Not a diagram.
- A diagram replaces the paragraph that would describe it. Show one mechanism. Crowded (more than about 12 nodes or 8 spokes) means split it or use a list.

## 2. Content and accuracy

- Default to the reader's main journey. Group cooperating parts; split them only where grouping would hide ownership, a trust or persistence boundary, or lifecycle behaviour. Put secondary and opt-in features in a short note.
- From code: every edge comes from a real call site (who calls, what, on what). Exported but never called on the normal path = optional, not a runtime edge. Never turn a config value or package name into a service you did not see.
- Conditions (approval, auth, state gates) go on the arrow or node, never only in a side note.
- Boundaries only for real isolation, ownership, runtime or persistence. External actors stay outside.
- Numbers say whether they are measured, sourced, estimated or illustrative. Never invent timings or fill gaps with events the input lacks.
- One term per thing across title, labels and text, in the reader's words. Decision nodes end in "?" with yes/no edges. Flow labels name the data, not the transport.
- State the abstraction level and what was left out in the caption.

## 3. Layout

- Place nodes by their connections before choosing coordinates. Classify every edge: main path, branch or store, return, second entrance, fan-out.
- Main path: neighbours adjacent in reading order, and each neighbouring pair has the relationship being explained.
- A branch or store sits directly above or below its owner, centred, so its edge is one straight segment. Keep a row's branches on one side; return edges run along the empty side.
- Before placing, trace every non-main edge: its straight or one-bend path must not pass another node or cross another edge. If it would, move the endpoint.
- Never draw an edge through an unrelated box, along another edge or along a container border. An unavoidable crossing gets a small gap in the lower line.
- Leave room for labels: the gap between boxes (edge to edge, not centre to centre) must fit the label plus breathing room.
- Per type:
  - Sequence: participants across the top in story order, time goes down, no self-loops (use a note on a real message).
  - Lifecycle: the main path in one row, about six phases at most; loops, skips and returns as arcs above it. A recoverable failure needs a real transition back.
  - Workflow: lanes = owner, columns = progression; the happy path runs straight; retries and exceptions route outside it.
  - ERD: a join table sits between its two parents; show cardinality; never hide it to save space.
  - Class: supertypes above subtypes; several subtypes share one inheritance bus.
  - Timeline and waterfall: one linear scale for all rows; a long quiet stretch is a labelled break.

## 4. Labels and density

- Labels carry meaning: never delete one to fix spacing. Repair order: move the label, re-route or re-space, then shorten the wording.
- Node label: a few words (about 4). Edge label: one or two words. Detail goes into a note or the text beside the diagram.
- Never shrink text to make it fit, and never truncate text in a box: widen the box or grow the canvas (taller is fine). After scaling, diagram text is no smaller than the page's caption text.

## 5. Colour and theme

- Colour encodes kind or state only. One accent for the path that matters, red only for errors, dashed lines for async or optional.
- Use CSS variables or classes, not literal inline colours, so light and dark themes both work; lines and text keep their contrast in both.
- A legend lists only kinds that are actually drawn.

## 6. Text around the diagram

Lead with the conclusion in one sentence. The text adds the reason or the exception, not what the diagram already shows. Steps written beside a diagram use the node labels as their names.

## 7. Check on a render before delivery

1. Rendered in light and dark, at desktop and phone width.
2. Main path traced start to end; every secondary chain traced.
3. No line through an unrelated node or along another line; crossings low without bending the meaning.
4. Every label beside its own line, clear of nodes and other labels; no clipped text; no horizontal overflow.
5. Every requested part, direction and condition is present; boundaries hold only their members.
6. Numbers recomputed and labelled; unknowns stated.

Say honestly whether the render was checked. At most two focused repair tries per problem, then report what is left.
