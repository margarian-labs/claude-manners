---
name: plain-writing
description: Use when writing or editing prose other people will read - docs, READMEs, KB pages, reports, PR descriptions, posts, tender or proposal text, emails, website copy, code review comments. Removes AI-writing tells and checks that no fact was lost. Not for ordinary chat replies.
---

# Plain writing

Write so it reads like a careful person wrote it. The user's CLAUDE.md wins on any conflict (dash ban, brevity, PR description format). Distilled from Humanizer, Taste and Caveman (see SOURCES.md).

## Structure tells: fix on one sighting

1. **Not X but Y.** "not just X, but Y", "it's not X, it's Y", "X rather than Y", the same contrast split over two sentences, a clipped tail (", no guessing"). State the point. Keep a contrast only when the reader really holds the opposite belief. Applies in every language.
2. **One-line closers and dramatic fragments.** "That is the real win.", "Read that again.", a last line that restates the paragraph. Cut it; merge fragment runs into one sentence that makes a claim.
3. **Staged run-ups.** "Let's dive in", "Here's the thing", "Honestly?", "the hard part is X". State X.
4. **Sayings and inflated significance.** "at its core", "a pivotal moment", "stands as a testament", "the future looks bright", a stock "challenges and outlook" section. Keep the fact, end on the last concrete fact.
5. **Arguing with no one.** "To be clear", "I'm not saying", rejecting an option nobody raised.

## Structure tells: fix when they pile up

6. **Forced triads.** Three items only when there are three real things.
7. **Writing about the document.** "The table below compares", "this section covers", "here are 3 reasons", a heading repeated in the first sentence under it. Write about the subject.
8. **-ing riders.** ", ensuring a smooth start", ", highlighting the need". Keep the fact, drop the tail.
9. **Rebuilt context in a reply.** Lead with the decision and the one fact the reader lacks; they already know the rest.
10. **Chatbot residue.** "Great question!", "I hope this helps", "Want me to...?".
11. **Decoration.** Bold labels inside prose, title-case or emoji headings, an arrow after every link. Sentence case; headings name a thing in 1-6 words.

## Word tells

- **Hype words:** seamless, robust, powerful, cutting-edge, world-class, best-in-class, state-of-the-art, next-gen, transformative, holistic, game-changing, unlock, elevate, empower, supercharge, leverage, effortless, unparalleled. Replace each with the fact it stands for (the setup steps, the failure case, the figure). Literal uses are fine.
- **Inflated and dead phrases:** delve, tapestry, realm, myriad, plethora, meticulous, intricate, pivotal, crucial, landscape, ecosystem, journey, "in today's fast-paced world", "say goodbye to", "look no further", "at your fingertips", "the world of", "where X meets Y".
- **Virtue words about yourself:** honest, genuinely, truly, simply, thoughtful, intentional. Show it with a fact or an admission.
- **Avoiding plain verbs:** "serves as", "stands as", "boasts" become is, are, has.
- **Borrowed authority:** "experts say", "studies show". Name the real source and what it said, or cut it.
- **Invented proof:** reviews, customers, round figures ("3x faster", "10,000+ teams"). Never, unless the user supplies them.
- The fix is a fact or a decision, never a synonym: a swapped synonym is the next tell.

## Not tells (don't over-correct)

Correct grammar, plain "is" and "has", "in order to" now and then, a list of three when there are three things, one dry line.

## Voice

- If the user gives a writing sample, match it (the dash ban still applies).
- Technical, legal and tender text stays plain and factual; posts may keep opinion.
- One term per thing. Numbers with units, inside the sentence they prove. Short common words; no invented abbreviations (cfg, impl).
- Buttons and calls to action: a verb plus what the reader gets.

## Process

1. Mark the tells, strongest first.
2. Rewrite. Every kept sentence adds something the reader did not have.
3. Check that no fact, name, number, date, quote or link was lost or changed.
4. Re-check the tells that survive rewrites: contrasts, closers, triads, bold labels, dashes.
5. For marketing copy, the rival test: put a competitor's name in the headline. If it still reads true, it says nothing.

Return only the final text unless the user asks for the analysis.

## Code review comments

One line per finding: `L42: bug: user can be null after .find(). Add a guard before .email.` Tags: `bug`, `risk`, `nit`, `q` (when unsure). No "I noticed that", no praise per comment, no restating the diff. Full sentences for security or architecture findings.
