---
name: liteparse
description: Local OCR and text extraction with the `lit` CLI (LiteParse, bundled Tesseract). Use for scanned or image-only PDFs, long or many documents, and searching scans (Armenian, Russian, English), when reading every page image would cost too much context. Armenian OCR is a search index, not a quote source. Not needed just to look at one screenshot or a short page.
license: MIT
metadata:
  author: LlamaIndex (adapted locally for Windows and Armenian, 2026-11-18)
  upstream: https://github.com/run-llama/llamaparse-agent-skills/tree/main/skills/liteparse
---

# LiteParse: local OCR and document text

`lit` (npm `@llamaindex/liteparse`, installed globally) extracts text locally: no API key, no cloud call. The only network address in its binary is the GitHub tessdata_best repo, from which OCR models download once to `%APPDATA%\tesseract-rs\tessdata`. Works from Git Bash and PowerShell, with spaces and Armenian letters in file names.

Never send the user's documents to a cloud OCR service (Mistral, Google, Azure and the like) without asking them first.

## When to use it

- Scanned or image-only PDFs, any length: OCR to a text file, then search the file.
- Long or born-digital PDFs: `--no-ocr` text extraction, much cheaper than reading pages as images.
- Many photos or scans of documents (PNG, JPG, TIFF, WEBP, BMP) to search or summarize.
- Skip it for a single screenshot you only need to look at: read the image directly.
- Short Armenian document where the exact wording matters: read the page image yourself. OCR gets about 85% of Armenian words exact, so use its text to find things, and quote only after checking the image.

## Where output goes

Write every output (text files, screenshots) to absolute paths in **your own session scratchpad** (the directory named in your system prompt). Never `cd` into the document's folder, never write next to the document, into a repo, or to `/tmp`.

## Languages: pass only what is on the page

The default is English only, which turns Armenian into garbage.

| Page has | Pass |
|---|---|
| Armenian (with or without English) | `--ocr-language hye+eng` |
| Armenian and Russian | `--ocr-language hye+rus+eng` |
| Russian (with or without English) | `--ocr-language rus+eng` (untested on real Russian documents) |
| English only | `--ocr-language eng` |

Don't add `rus` "just in case": on real scans it turned Latin words into Cyrillic look-alikes (`MOJ` became `МОЛ`), which breaks searches. Not sure there is Russian? Run `hye+eng` first: Russian lines then come out as Latin junk (`Доверенность` became `JloBepeHHOCTS`), and only then rerun with `hye+rus+eng`.

## Armenian accuracy and known slips (tested 2026-11-18)

Real Armenian typography (form pages rendered as images): 84-86% of words exact, 95-96% when the two slips below are ignored, about 98% of characters. Not yet tested on a phone photo or a physically scanned Armenian page. The other Armenian models (tessdata_fast `hye`, `script/Armenian`) scored the same.

Every time:
- `և` is never output, it comes out as `ն`: the word "and" becomes a lone `ն`, `Երևան` becomes `Երնան`, `նաև` becomes `նան`. The Armenian model's character set has no `և` (its charset has `ն`, `։` and `:` but not `և`), so no setting fixes this.
- The Armenian full stop `։` comes out as a colon `:`.

Often:
- The Armenian comma `՝` is dropped.
- Latin abbreviations inside Armenian text turn into Armenian letters (`NOC` became `ՎՕՇ`, `L1` became `Լ1`).
- `է` vs `Է` case, or `է` glued to the previous word, on noisy scans.

So:
- Search Armenian output with character classes: `grep -n "Եր[նև]ան"`, `"[:։]"`.
- When quoting OCR text, turn a lone `ն` back into `և`, and check names, numbers and Latin abbreviations against the page image (`lit screenshot`, below).
- When quoting or saving Armenian OCR text, also fix `ն` back into `և` inside words where `և` belongs (`Երնան` to `Երևան`), and the colon `:` back into the Armenian full stop `։`.
- OCR output (all languages) turns some hyphens into long dashes (U+2014). Replace them with `-` when quoting or saving.

## The golden rule: parse ONCE to a file, then search the file

Each `lit parse` re-runs full extraction. Parse once, then search that file:

```bash
lit parse "/abs/path/doc.pdf" --ocr-language hye+eng --dpi 300 -q -o "<scratchpad>/doc.txt" && wc -l "<scratchpad>/doc.txt"
```

- Is it a scan? Run with `--no-ocr` first: empty or near-empty text means a scan, so run OCR. (`lit is-complex` also flags pages that only have heavy graphics, so it is not a scan detector.)
- Born-digital PDF (real text layer): keep `--no-ocr`, it is much faster and the text is identical.
- `--dpi 300` for scans: on a real English scan it got `MOJ` and a full signer name right where the default 150 did not, about 50% slower (2-page scan: 6.7 s vs 4.5 s). Armenian pages rendered at 300 instead of 150 DPI scored 86% vs 84.5% of words (image resolution test, not the flag itself).
- Only some pages: `--target-pages "1-5,10"` (not `--pages`).
- Many files: `lit batch-parse <input-dir> "<scratchpad>/out" --ocr-language hye+eng [--recursive] [--extension .pdf]`.
- There is no flag to force OCR over an existing text layer. If a PDF's text layer is garbage, render the page with `lit screenshot` and read it visually.
- Stamps and signatures come out as junk words; ignore them.

## Search discipline: few round-trips, small output

- Get context in the same command: `grep -n -i -C4 "term" doc.txt | head -40`.
- Batch several lookups in one command:
  ```bash
  for q in "term one" "term two"; do echo "=== $q"; grep -n -i -C3 "$q" doc.txt | head -25; done
  ```
- Always bound output with `head`; prefer Bash `grep`/`sed` on the saved file.
- If two targeted greps don't find it, run the bundled BM25 ranker once with a rich query:
  ```bash
  uv run -q --script ~/.claude/skills/liteparse/scripts/search.py "<scratchpad>/doc.txt" -q "several synonyms in one query" -k 8 -e 5
  ```

## Reading a page visually: last resort

A page image costs far more context than its text. Only when text can't answer (dense tables, charts, figures, doubt on a key value):

```bash
lit screenshot "/abs/path/doc.pdf" --target-pages "13" --dpi 150 -o "<scratchpad>/shots/"
```

It writes `page_13.png` into that folder; Read that one PNG. One page at a time, DPI 150-200; don't re-render the same page.

## Setup facts

- Installed: `npm i -g @llamaindex/liteparse` (v2.20.0 on 2026-11-18). If `lit` is missing, reinstall with that command.
- PDFs and images work out of the box (ImageMagick not needed since v2.8.0).
- Office files (DOCX, PPTX, XLSX) need LibreOffice, which is not installed.
- Other model files: set the env var `TESSDATA_PREFIX` to a folder with `.traineddata` files. This Node CLI has no `--tessdata-path` flag, although the upstream README lists one.
