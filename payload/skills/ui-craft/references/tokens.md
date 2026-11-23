# Starter tokens

Use only when the project has no design system of its own. Starting points, not a house style.

## Spacing

Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128.
- Inside a control 4-12; between related items 2-8; between groups 12-24; between sections 32-64 (landing pages 80-128).
- Row heights: 32 compact, 36 default, 40-44 touch.
- App shell: sidebar 240-280, content padding 24-32, content capped around 1440-1600, header 56-64. The main chart spans at least two thirds of the content width.

## Neutral ramps (graphite)

| Role | Dark | Light |
| --- | --- | --- |
| Deepest surface (sidebar) | #0f0f10 | - |
| Page | #141415 | #fafafa |
| Card | #19191b | #ffffff |
| Raised (active row, input) | #232325 | #f4f4f5 |
| Hairline | primary text at 8% | primary text at 8% |
| Primary text | #ededed | #171717 |
| Secondary text | #a1a1a6 | #525252 |
| Muted text and icons | #85858b | #737373 |

Warm ramp (paper, food, craft): dark page #161513, text #efe9de; light page #f7f4ee, text #1f1b16. Ink ramp (night, technical): dark page #0b0d14, text #eef0f5; light page #f5f7fa, text #111827.

Semantic: positive #4cc38a dark / #16a34a light; negative #e5484d dark / #dc2626 light.

Accent: keep a real brand colour. Without one, take it from the product's world (amber or coral for warm, cobalt or teal for cool, moss or sage for natural) and avoid the purple-to-blue family. It covers a few percent of the screen.

## Type

| Use | Size / line height | Weight |
| --- | --- | --- |
| Labels, meta, counts | 12 / 16 | 400 (mono welcome) |
| Captions, secondary | 13-14 / 20 | 400 |
| Body, nav items | 14-15 / 20-22 (16+ on websites) | 400-500 |
| Card figures | 28-32 / 1 | 500, tabular |
| Page title | 28-36 / 1.15 | 400-500 |
| Hero headline | 56-72 desktop, 36-44 mobile / 1.02-1.08 | 400-500 |

Letter spacing 0 under 16px; display text from 40px may go to -0.02em, from 56px to -0.03em.

## Radius, depth, motion

- Radius: tag 4-6, input and button 8-10, card 12-16, panel 14-20. Inner = outer minus padding, never below 4.
- Light depth: `0 1px 2px rgba(0,0,0,.05)` small, `0 8px 24px rgba(0,0,0,.06)` floating. Dark: surface steps plus hairline, optional `inset 0 1px 0 rgba(255,255,255,.12)` top highlight.
- Buttons: hero 44-48 tall, nav 32-36, side padding 16-20; secondary = raised surface plus hairline.
- Motion: `cubic-bezier(0.22, 1, 0.36, 1)`; hover and press 120-180ms; menus 160-220ms; entrances 300-500ms; stagger 40-60ms for at most six items; rise 6-12px; press scale 0.97-0.98.

Adapted from unslop by Damir Sokolovsky (@heydamir), https://github.com/heydamir/unslop, CC BY 4.0. Changes: condensed, values selected.
