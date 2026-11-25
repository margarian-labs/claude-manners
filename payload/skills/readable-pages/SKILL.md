---
name: readable-pages
description: Use before building any HTML page, artifact, report, dashboard, markdown report or Claude Doc: the rules for pages a busy human reads (summary first, collapsed detail, screenshot check), plus which UI/UX skills to load with it.
---

# Readable pages

Moved from the core rules on 2026-11-24.

Any HTML page, artifact, report or dashboard I ask for must be scannable and pleasant to read, not a dump of everything found. Design it like a product, not a printout:
- **Summary first:** the answer or verdict in one big sentence, then the few numbers or grades that matter, then "what to do", then detail.
- **Progressive disclosure:** one line per item visible (headline + a one-sentence "so what" + status chips); evidence, rationale and long text live behind collapsible details, filters or tabs. Default state is collapsed and calm.
- **Visual hierarchy:** generous type size and spacing, short paragraphs (max 3 sentences), colour and chips to encode state (severity, owner, status, strength), bars or simple charts for numbers, icons where they help. No dense tables and no tiny-text SVG walls; a diagram shows one mechanism with big labels or it is left out.
- **Human language:** plain words, concrete verbs, one idea per card. Write for someone deciding in two minutes.
- **Check before handing over:** render it (screenshot) and ask "would a tired person read this?". If a section is a wall of text, cut it or collapse it.
This applies to every artifact, local HTML file, Claude Doc and markdown report. A boring or unreadable deliverable is a failed deliverable, even if the content is correct.

## Skills to load with it
Pick the ones that fit before building ("pick skills yourself" applies). Skills marked "if your session lists it" are not shipped here; use them only when they exist.
- **Artifact tool (if your session lists it):** for a claude.ai artifact, call its `quickstart` first; it carries the page contract and the design guidance. A data dashboard may start from the Data type unless the user asked for something else.
- **`hallmark`:** a new website, landing or marketing page: ask the user first (about 4-6 min per page) and build with it only on a yes. Any other page: use it when the user asks for it.
- **`ui-craft`:** the look of any UI or HTML page (rules against the generated look, audit for redesigns).
- **`ui-ux-pro-max`:** before choosing a style, palette, font pairing or chart type.
- **`dataviz` (if your session lists it):** before any chart, stat tile or data colour.
- **`diagram-craft`:** before drawing a diagram by hand.
- **`plain-writing`:** the prose on the page.
- **`design-md`:** a new project with no design system yet.
- **`artifact-design` / `artifact-diagramming` (if your session lists them):** Anthropic's artifact guidance, when the quickstart did not already include it.

Screenshot check: Playwright MCP blocks `file://`; serve the page from a small local http server in the scratchpad, then screenshot desktop and phone widths.
