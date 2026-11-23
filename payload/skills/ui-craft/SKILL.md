---
name: ui-craft
description: Use when designing, building, redesigning or reviewing the look of a user interface in code - app screens, admin panels, dashboards, forms, websites, landing pages, HTML reports - in any stack (Angular, React, plain HTML/CSS). Rules that keep a UI from looking AI-generated, plus an audit procedure for redesigns. Not for pure logic bugs or framework API questions.
---

# UI craft

Rules for interfaces that look designed, not generated. Distilled from unslop, Anthropic's frontend-design and Taste (see SOURCES.md); nothing here needs a tool or a package.

## 0. The project's system wins

Before anything else, look for an existing design system: a component library (Angular Material, PrimeNG, shadcn), theme tokens, SCSS variables, a `DESIGN.md`. If one exists, keep its fonts, colours, radii and components, and apply only the hierarchy, spacing, states, data-display and copy rules below inside it. Never restyle a library component just to look different. Starter values for a project with no system: `references/tokens.md`.

## 1. Where the richness goes

- Keep the chrome quiet (nav, buttons, borders, labels). Put colour and craft into one or two moments of content: the main chart, the product's real object, a real photo.
- Never replace removed decoration with the next trend (glass, grain, noise, neon, bento).

## 2. Colour

- One neutral ramp for every surface, border and text. Three text roles: primary, secondary, muted. Muted is for meta and captions only.
- One accent, used rarely: the primary action, the selection, the one number that matters. Text on the accent reaches 4.5:1, muted text stays near 4.5:1.
- No hue-to-hue gradients on surfaces, gradient text, coloured glows or shadows, radial washes, blobs or neon borders. A gradient is allowed only as a small tone shift inside one neutral.
- Semantic colours (success, warning, error) carry meaning only, toned down. Status chips and tags can be ink tints instead of the accent.
- Hairline borders are the text colour at 6-10% opacity. Dark theme: depth from surface steps plus hairlines, not shadows. Light theme: soft neutral shadows on floating things only, never the same grey shadow under every card.

## 3. Spacing and layout

- Spacing on a 4px scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64); replace one-off values. Space inside a group is smaller than space between groups.
- Equal things equal: one row height, one gap, one padding for siblings. Align icons in one column, labels on one line, numbers right-aligned in one column.
- Vary card sizes. Equal cards side by side with the same kind of content read as a template; use a rhythm such as 3-4 compact stats above one wide chart.
- Two box levels at most: never a card inside a card for text.
- Separate sections with space or a surface step before adding rules or shadows (data tables keep their row lines).
- Long headlines align left; centre only one or two short lines.
- One filled primary button per view; every secondary action shares one style.
- Small screens: stack in reading order; a dense preview gets simpler (fewer columns), not zoomed out. No text under 11px anywhere.

## 4. Typography

- A few sizes from a scale. Hierarchy comes from size and colour, not weight; 400 and 500 (600 at most) unless the system says otherwise.
- Sentence case. No tracked ALL-CAPS labels, no italic for emphasis, no single accented word in a headline.
- Numbers: `font-variant-numeric: tabular-nums`, one format per screen, and every change states its reference ("+12% vs last month").
- One family plus at most one partner (a mono for figures and meta, or a display face for big headlines only).
- Letter spacing 0 under 16px. Reading text about 60-75 characters per line; on websites 16px or more.

## 5. Components and states

- Radius by size (tag 4-6, input and button 8-10, card 12-16). Nested radius = outer radius minus the padding, never below 4. Not everything is a pill.
- Icons: the project's one set, one size and stroke, in a text-role colour. No emoji as icons; drop icons that add nothing.
- Every interactive element has hover, visible keyboard focus and active states inside the palette. Only clickable things react to the pointer.
- Forms: a visible label above every field (a placeholder is not a label); the error sits under its field and says what to type; a failed submit keeps what was typed.
- Counts and meta as quiet muted text; shortcuts as keycaps. A logo is the product name plus a simple flat mark, never a gradient wordmark or sparkle tile.

## 6. Data display

- One main chart, clearly the biggest thing on the screen. Anything else showing data is smaller and different in kind (a ranked list with thin bars, a short table), never a second chart of the same size.
- Chart type fits the data: trend = line, comparison = bars, share = stacked bar or list with bars, one goal = progress bar.
- One accent per chart for the thing that matters; everything else in neutral steps. Several hues only when series must be told apart, and one still leads. Muted grid and labels; no rainbow or glowing bars.
- Stat cards: a label, a big figure, a change with its reference. No sparklines, mini bars or filler icons inside them.
- Mock data looks real and consistent (never `123,456` or `[X]`). In real reports, never invent a number.

## 7. Motion

- Motion needs a purpose: it shows what changed after a user action. The page works without it and under `prefers-reduced-motion`.
- Animate only opacity, transform and colours; never width, height, top, left or margins; no `transition: all`.
- One easing curve (`cubic-bezier(0.22, 1, 0.36, 1)`); hover and press 120-180ms, menus 160-220ms; hover-out faster than hover-in; no bounce or overshoot.
- No looping motion on things that are not live (pulse, shimmer, floating), no reveal-on-scroll for every section, no auto-advancing carousel. At most one entrance on load.

## 8. Words on screen

- Titles name the page or period; no greeting headlines, no exclamation marks, no hype words (seamless, powerful, robust, unlock, supercharge, AI-powered).
- Buttons are a verb plus the thing ("Export CSV", "Save changes"), never "Learn more", "Click here" or "Submit". An action keeps its name through the flow (Publish, then "Published").
- Errors say what went wrong and how to fix it; empty states invite the next action. Name things by what users understand, not by system internals.
- No unverifiable claims ("10,000+ teams", "3x faster") unless the user confirms them. For longer copy, follow the `plain-writing` skill.

## 9. AI-default looks to avoid unless the brief asks

- Purple-to-blue gradients, glows, glass cards, blobs or grids behind the hero.
- The SaaS-card kit: identical rounded cards, one radius everywhere, the same soft shadow under each.
- Template chrome: a tracked ALL-CAPS eyebrow above every heading, "A · B · C" meta strings, an arrow after every link, emoji feature cards, "New" sparkle pills, avatar-dot trust rows, a visual on every section.
- Template test: swap in another product's name. If the screen still fits, it says nothing about this product.

## 10. Redesign or review an existing screen

1. Render it and look at a screenshot, not only the code.
2. List what is wrong against sections 1-9, each with where it lives.
3. Decide how much to change: heavy problems get the full pass; light ones get polish; a good screen gets "it is fine" plus at most 2-3 refinements. Never change a good screen just to make it different. Keep the sections, their order, the product name and the data.
4. Fix in passes across the whole screen: spacing, colour, icons, copy, type, layout, details, motion.
5. Render again, compare with the list, fix what remains. Report the passes in a few lines.

## 11. New screen from scratch

Name the subject, the audience and the main job first. Write a short plan: a neutral ramp plus one accent (named hex values), type roles, a one-sentence layout idea. Then ask: "does any part read like the default I would produce for any similar page?" and change that part. For a marketing website the user may prefer `/hallmark`; for a ready brand-like look, `/design-md`.
