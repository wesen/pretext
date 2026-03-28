---
Title: Pretext architecture, algorithms, and intern implementation guide
Ticket: PRETEXT-20260328
Status: active
Topics:
    - pretext
    - text-layout
    - browser-accuracy
    - intern-onboarding
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: RESEARCH.md
      Note: Historical rationale and rejected approaches
    - Path: STATUS.md
      Note: Current accuracy and benchmark baseline
    - Path: corpora/STATUS.md
      Note: Long-form canary status
    - Path: corpora/TAXONOMY.md
      Note: Mismatch classification vocabulary
    - Path: pages/accuracy.ts
      Note: Accuracy harness structure and mismatch diagnostics
    - Path: pages/benchmark.ts
      Note: Benchmark methodology and long-form corpus stress design
    - Path: src/analysis.ts
      Note: Main semantic segmentation algorithm explained in detail
    - Path: src/bidi.ts
      Note: Rich-path bidi metadata scope and limitations
    - Path: src/layout.test.ts
      Note: Behavior examples and durable invariant coverage
    - Path: src/layout.ts
      Note: Primary public API and preparation bridge discussed throughout the guide
    - Path: src/line-break.ts
      Note: Simple and general line walkers plus streaming layout path
    - Path: src/measurement.ts
      Note: Measurement cache
    - Path: ttmp/2026/03/28/PRETEXT-20260328--pretext-architecture-and-intern-onboarding-guide/scripts/inspect-pipeline.ts
      Note: Ticket-local experiment used as supporting evidence
    - Path: ttmp/2026/03/28/PRETEXT-20260328--pretext-architecture-and-intern-onboarding-guide/various/01-pipeline-samples.md
      Note: Generated experiment output cited by the guide
ExternalSources: []
Summary: Detailed intern-oriented explanation of Pretext's analysis, measurement, prepared-state, line-breaking, validation, and repo workflow design.
LastUpdated: 2026-03-28T09:19:48.23899399-04:00
WhatFor: Explain how Pretext works internally and how to modify it safely.
WhenToUse: Use when onboarding a new engineer, planning engine work, or interpreting accuracy and benchmark behavior.
---



# Pretext architecture, algorithms, and intern implementation guide

## Executive Summary

Pretext is a browser-grounded text measurement and line-breaking library whose main product claim is simple: do the expensive, script-aware, browser-parity work once in `prepare()`, then keep `layout()` cheap enough to run during every resize without touching the DOM. The core design separates the problem into three layers:

1. text analysis and segmentation,
2. measurement and prepared-state compilation,
3. arithmetic-only line walking.

That separation is visible in the source tree and in the public API. `src/analysis.ts` is responsible for turning raw text into a semantically meaningful segment stream; `src/measurement.ts` is responsible for getting widths from the browser font engine and correcting known browser quirks; `src/line-break.ts` is responsible for deciding where lines start and end; `src/layout.ts` ties those pieces together and exposes the public surface (`src/layout.ts:35-65`, `src/layout.ts:83-155`, `src/layout.ts:424-717`).

For a new intern, the most important architectural fact is that Pretext is not trying to be a full shaping engine or a replacement for browser text rendering. It is deliberately narrower. It aims to match the common browser app-text configuration called out in the public docs and contributor notes: `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`, `line-break: auto`, with a second targeted `{ whiteSpace: 'pre-wrap' }` mode for textarea-like behavior ([README.md](../../../../../../README.md), [src/analysis.ts](../../../../../../src/analysis.ts), [src/line-break.ts](../../../../../../src/line-break.ts)). That narrow target is what lets the library stay fast and predictable.

The repository is also built around evidence. Accuracy pages, benchmark pages, browser automation helpers, corpora status files, and a research log exist so algorithm changes can be judged against real browser behavior rather than intuition. The current checked-in status says the browser regression sweep is green in Chrome, Safari, and Firefox, while long-form corpora and mixed app text remain the real steering canaries ([STATUS.md](../../../../../../STATUS.md), [corpora/STATUS.md](../../../../../../corpora/STATUS.md), [RESEARCH.md](../../../../../../RESEARCH.md)).

If you remember only five things after reading this guide, remember these:

- `prepare()` is the expensive, one-time phase; `layout()` is the hot resize phase and must stay arithmetic-only.
- Most correctness fixes belong in preprocessing and segmentation, not in the line walker.
- The prepared representation is intentionally opaque on the fast path and parallel-array based internally.
- Browser accuracy is driven by small, semantic rules plus narrow engine-profile shims, not by a giant runtime correction model.
- Repo workflow matters as much as algorithm details: any change to the engine must be validated against tests, browser sweeps, benchmark snapshots, and canary corpora.

## Problem Statement

The underlying problem is browser text measurement cost. Traditional UI code often measures text by mutating DOM nodes and then reading layout metrics such as `getBoundingClientRect()` or `offsetHeight`. Those reads force layout and become especially expensive when many components interleave writes and reads. The top-of-file comment in `src/layout.ts` captures the motivating scenario directly: a large batch of text blocks can trigger repeated whole-document reflow if components measure independently (`src/layout.ts:1-33`).

Pretext addresses that by changing the work decomposition. Instead of repeatedly asking the DOM, "how tall is this paragraph at width X?", it asks the browser font engine a different question once: "what are the widths of the semantic units that make up this paragraph?" It then answers the layout question with arithmetic on cached widths. The public API in the README presents that split directly:

- `prepare(text, font, options?)` performs normalization, segmentation, glue rules, measurement, and caching.
- `layout(prepared, maxWidth, lineHeight)` counts lines and computes block height without DOM reads.
- `prepareWithSegments(...)` unlocks richer manual layout APIs (`layoutWithLines`, `walkLineRanges`, `layoutNextLine`) for custom rendering and editorial flows ([README.md](../../../../../../README.md), `src/layout.ts:458-500`, `src/layout.ts:669-705`).

The design problem is harder than simple Latin word wrapping because the library needs to support:

- scripts where browser segmentation is not whitespace-based, such as Thai and CJK,
- non-breaking glue characters such as `NBSP`, `NNBSP`, and `WJ`,
- zero-width break opportunities,
- soft hyphen behavior,
- mixed-direction text,
- preserved spaces, tabs, and hard breaks in the `{ whiteSpace: 'pre-wrap' }` mode,
- browser quirks such as Safari-specific line-fit tolerance and Chromium-specific quote/CJK behavior (`src/analysis.ts:97-944`, `src/measurement.ts:65-101`, `src/line-break.ts:368-1056`).

The repository therefore solves two related problems at once:

1. build a fast runtime pipeline for line counting and rich line layout;
2. maintain a research harness that tells contributors when a "fix" is actually a regression in another script, browser, or benchmark path.

## Scope And Non-Goals

Pretext is intentionally opinionated. The codebase and notes repeatedly reject broader but more expensive designs. The project does not currently try to be:

- a full font shaping engine,
- a full CSS line-breaking implementation covering all `line-break` / `word-break` modes,
- a universal server-side browser-parity solution,
- a library that hides all font mismatch issues such as `system-ui` on macOS ([README.md](../../../../../../README.md), [RESEARCH.md](../../../../../../RESEARCH.md), contributor notes in `AGENTS.md`).

That means an intern should evaluate ideas against scope before evaluating them against elegance. A theoretically interesting algorithm that pulls measurement back into `layout()` or requires broad DOM participation is probably wrong for this repo even if it looks accurate in one probe.

## Reading Order For A New Intern

If you are onboarding into this repository, read in this order:

1. [README.md](../../../../../../README.md)
   Understand the public contract, the two main use cases, and the user-facing caveats.
2. [STATUS.md](../../../../../../STATUS.md)
   Understand where the project stands today on accuracy and performance.
3. [TODO.md](../../../../../../TODO.md)
   Understand current priorities and what not to work on.
4. [`src/layout.ts`](../../../../../../src/layout.ts)
   Read the public types, `prepare()`, `prepareWithSegments()`, and the rich APIs.
5. [`src/analysis.ts`](../../../../../../src/analysis.ts)
   Read the semantic preprocessing rules. Most correctness work starts here.
6. [`src/measurement.ts`](../../../../../../src/measurement.ts)
   Read the cache model, browser profile, and emoji correction logic.
7. [`src/line-break.ts`](../../../../../../src/line-break.ts)
   Read the hot-path and rich-path line walkers.
8. [`src/layout.test.ts`](../../../../../../src/layout.test.ts)
   Read the durable invariants the repo chooses to permanently enforce.
9. [`pages/accuracy.ts`](../../../../../../pages/accuracy.ts), [`pages/benchmark.ts`](../../../../../../pages/benchmark.ts), [`scripts/browser-automation.ts`](../../../../../../scripts/browser-automation.ts)
   Read how the repo validates accuracy and performance.
10. [RESEARCH.md](../../../../../../RESEARCH.md) and [corpora/TAXONOMY.md](../../../../../../corpora/TAXONOMY.md)
    Read why the current design exists and how mismatches are classified.

## System Overview

At a high level, the system is a staged compiler from raw text to layout facts:

```text
raw text
  |
  v
normalize whitespace
  |
  v
segment with Intl.Segmenter + classify break kinds
  |
  v
merge / split script-specific runs
  |
  v
compile analysis chunks
  |
  v
measure segment widths with canvas + cache
  |
  v
compile prepared arrays
  |
  v
line walker chooses boundaries for a given width
  |
  +--> layout(): returns { lineCount, height }
  |
  +--> layoutWithLines(): materializes line text
  |
  +--> walkLineRanges(): geometry only
  |
  +--> layoutNextLine(): streaming one-line-at-a-time API
```

There are four architectural layers behind that flow.

### Layer 1: Analysis

`analyzeText()` normalizes whitespace according to the chosen mode, segments the text with `Intl.Segmenter`, splits segments by semantic break kind, applies merging and splitting heuristics, and finally compiles chunk metadata used by the line breakers (`src/analysis.ts:981-1007`).

### Layer 2: Measurement

`measureAnalysis()` iterates the analyzed segments, measures widths via `CanvasRenderingContext2D.measureText`, computes line-end fit and paint advances, computes per-grapheme widths for breakable segments, splits CJK into smaller prepared units when needed, and optionally computes bidi segment levels for the rich path (`src/layout.ts:191-391` plus `src/measurement.ts:27-225`).

### Layer 3: Prepared Representation

Prepared text is stored as a compact parallel-array representation. The arrays carry widths, break kinds, breakable grapheme widths, per-chunk bounds, and other facts needed during layout. The main `PreparedText` type is deliberately opaque, while `PreparedTextWithSegments` exposes the same internal arrays plus `segments` for richer layout and diagnostics (`src/layout.ts:83-155`).

### Layer 4: Line Walking

`src/line-break.ts` contains two line walkers:

- a simple fast path for the common segment model,
- a general walker that handles tabs, hard breaks, soft hyphens, hanging preserved spaces, and chunked `pre-wrap` behavior.

`layout()` uses only the line counter. The rich APIs reuse the same semantic line-walking rules but preserve start/end cursors and optionally materialize strings (`src/line-break.ts:133-1056`, `src/layout.ts:495-705`).

## Repository Map

The core repository pieces are:

- [`src/layout.ts`](../../../../../../src/layout.ts)
  Public API surface, prepared representation, measurement assembly, line text materialization, cache lifecycle.
- [`src/analysis.ts`](../../../../../../src/analysis.ts)
  Whitespace normalization, segment kind classification, preprocessing rules, URL/numeric glue, chunk compilation.
- [`src/measurement.ts`](../../../../../../src/measurement.ts)
  Canvas context management, width caches, engine profile shims, emoji correction, per-grapheme width helpers.
- [`src/line-break.ts`](../../../../../../src/line-break.ts)
  Counting lines, walking lines, streaming one-line layout, tab-stop behavior, soft-hyphen fitting.
- [`src/bidi.ts`](../../../../../../src/bidi.ts)
  Simplified bidi embedding levels for the rich path only.
- [`src/layout.test.ts`](../../../../../../src/layout.test.ts)
  Durable invariants and behavior examples.
- [`src/test-data.ts`](../../../../../../src/test-data.ts)
  Shared short-form test corpus for accuracy and benchmark pages.
- [`pages/accuracy.ts`](../../../../../../pages/accuracy.ts)
  Browser sweep page comparing actual DOM height and diagnostic browser lines against Pretext predictions.
- [`pages/benchmark.ts`](../../../../../../pages/benchmark.ts)
  Benchmark page for one-time prepare cost, hot-path layout cost, DOM comparisons, and long-form corpus stress.
- [`pages/diagnostic-utils.ts`](../../../../../../pages/diagnostic-utils.ts)
  Grapheme-safe diagnostic helpers used by accuracy and probe pages.
- [`scripts/browser-automation.ts`](../../../../../../scripts/browser-automation.ts)
  Browser control, local page server management, and report retrieval for scripted sweeps.
- [RESEARCH.md](../../../../../../RESEARCH.md)
  Historical reasoning, failed ideas, and steering lessons.
- [corpora/STATUS.md](../../../../../../corpora/STATUS.md), [corpora/TAXONOMY.md](../../../../../../corpora/TAXONOMY.md)
  Current canary health and mismatch vocabulary.

## Public API Reference

The exported APIs in `src/layout.ts` naturally divide into fast-path and rich-path use cases (`src/layout.ts:99-155`, `src/layout.ts:436-717`).

### Fast Path APIs

```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }): PreparedText
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { lineCount: number, height: number }
clearCache(): void
setLocale(locale?: string): void
```

Use these when your only goal is block height and line count.

### Rich Path APIs

```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }): PreparedTextWithSegments
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): {
  lineCount: number
  height: number
  lines: LayoutLine[]
}
walkLineRanges(prepared: PreparedTextWithSegments, maxWidth: number, onLine: (line: LayoutLineRange) => void): number
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null
```

Use these when you need per-line text, line geometry, streaming manual layout, or custom rendering.

### Diagnostic API

`profilePrepare()` is intentionally diagnostic-only. It splits `prepare()` into analysis and measurement timings without changing the public contract, and is used by the benchmark harness to show which scripts are expensive because of preprocessing versus measurement volume (`src/layout.ts:434-456`, `pages/benchmark.ts:257-306`).

## Core Data Model

The most important internal type is `PreparedCore` in `src/layout.ts:83-95`. It contains:

- `widths`
  Width of each prepared segment.
- `lineEndFitAdvances`
  Width that counts for "does this line still fit?" if the line ends after that segment.
- `lineEndPaintAdvances`
  Width that should be reported as the visible painted width if the line ends after that segment.
- `kinds`
  Segment break kind such as `text`, `space`, `glue`, `soft-hyphen`, `hard-break`, or `tab`.
- `simpleLineWalkFastPath`
  Boolean telling the line breaker whether it can use the simpler older path.
- `segLevels`
  Rich-path bidi levels.
- `breakableWidths`
  Per-grapheme widths for overlong word-like segments.
- `breakablePrefixWidths`
  Prefix-width variant used by some browser profiles.
- `discretionaryHyphenWidth`
  Width of the visible hyphen painted when a soft hyphen wins.
- `tabStopAdvance`
  Width between tab stops in `pre-wrap`.
- `chunks`
  Precompiled chunk boundaries, mainly for hard-break aware walking.

This is not object-heavy by accident. The parallel-array layout is part of the performance design. The hot line walker only needs indexed numeric arrays and a few enums. It does not need rich object graphs or repeated substring work.

### Why fit width and paint width are separate

This distinction is easy to miss and matters a lot.

- A trailing collapsible space should not cause the line to overflow, so its fit advance is `0`.
- A preserved space in `pre-wrap` should still be visibly present if the line ends there, so the paint advance can differ from the fit advance.
- A soft hyphen segment has stored width `0` when unbroken, but contributes a visible hyphen width when its break opportunity is selected.
- Tabs behave like hanging line-end whitespace for fit but still contribute visible width when rendered on the current line (`src/layout.ts:321-357`, `src/line-break.ts:458-466`, `src/line-break.ts:598-650`).

That separation is a core design decision. It lets the engine model browser-like hanging whitespace and discretionary hyphen behavior without re-measuring strings during layout.

## Algorithm 1: Text Analysis

The analysis stage begins in `analyzeText()` (`src/analysis.ts:981-1007`).

### Step 1: Choose whitespace mode and normalize

`WhiteSpaceMode` currently has two values: `'normal'` and `'pre-wrap'` (`src/analysis.ts:1-11`).

- In `'normal'`, whitespace runs collapse to one ordinary space, and leading/trailing ordinary space is trimmed (`src/analysis.ts:56-67`).
- In `'pre-wrap'`, CRLF is normalized to `\n`, carriage returns and form feeds become `\n`, but ordinary spaces, tabs, and hard breaks are preserved (`src/analysis.ts:69-74`).

This is intentionally smaller than full CSS `pre-wrap`. Contributor notes explicitly say it is an editor/input-oriented mode, not an attempt to support the whole CSS surface.

### Step 2: Segment with `Intl.Segmenter`

The analysis layer hoists a shared word segmenter and optionally retargets it via `setLocale()` / `setAnalysisLocale()` (`src/analysis.ts:76-95`, `src/layout.ts:714-717`). Pretext uses `Intl.Segmenter` because it gives script-aware word boundaries across Latin, CJK, Thai, Arabic, and mixed text without shipping a large custom Unicode segmentation runtime.

### Step 3: Classify break kinds

Each raw segment is split again by semantic break kind using `splitSegmentByBreakKind()` (`src/analysis.ts:336-385`). The break kinds are:

- `text`
- `space`
- `preserved-space`
- `tab`
- `glue`
- `zero-width-break`
- `soft-hyphen`
- `hard-break`

`classifySegmentBreakChar()` is the key classifier (`src/analysis.ts:321-334`). This is where `NBSP`, `NNBSP`, `WJ`, `ZWSP`, and soft hyphens become explicit engine concepts rather than being collapsed into a generic whitespace bucket.

### Step 4: Apply semantic merge and split rules

This is where most of the browser-accuracy intelligence lives. The repository notes explicitly say script-specific break-policy fixes belong in preprocessing rather than `layout()`, and the code follows that rule (`src/analysis.ts:783-944`).

Important rule families:

- CJK and kinsoku punctuation attachment
  `kinsokuStart`, `kinsokuEnd`, `leftStickyPunctuation`, `isCJKLineStartProhibitedSegment()`, and `carryTrailingForwardStickyAcrossCJKBoundary()` keep punctuation attached in browser-like ways (`src/analysis.ts:129-195`, `src/analysis.ts:233-245`, `src/analysis.ts:755-780`).
- Arabic punctuation and marks
  `endsWithArabicNoSpacePunctuation()` and the later `" " + combining marks` fix preserve no-space punctuation clusters and attach leading Arabic marks to following words (`src/analysis.ts:293-309`, `src/analysis.ts:827-839`, `src/analysis.ts:925-941`).
- Myanmar-specific follower/glue handling
  `endsWithMyanmarMedialGlue()` prevents breaks that the word segmenter alone would expose incorrectly (`src/analysis.ts:298-301`, `src/analysis.ts:820-827`).
- Quote and punctuation glue
  `isLeftStickyPunctuationSegment()`, `isForwardStickyClusterSegment()`, `isEscapedQuoteClusterSegment()`, and related passes make opening quotes stick to following text and closing punctuation stick to previous text (`src/analysis.ts:219-283`, `src/analysis.ts:849-890`).
- URL-like merging
  `mergeUrlLikeRuns()` and `mergeUrlQueryRuns()` treat URL path/query structure as intentionally narrow special cases so obvious mid-path breaks are avoided while query strings remain breakable units (`src/analysis.ts:396-508`).
- Numeric/time-range merging
  `mergeNumericRuns()`, `mergeAsciiPunctuationChains()`, and `splitHyphenatedNumericRuns()` preserve runs such as `7:00-9:00`, `२४×७`, and query-like ASCII punctuation chains (`src/analysis.ts:510-680`).
- Glue-connected runs
  `mergeGlueConnectedTextRuns()` turns `NBSP`-style glue between text runs into one larger text unit when appropriate, preserving visible content and non-breaking behavior (`src/analysis.ts:682-753`).

This stage is the main reason a new contributor should be cautious about "simple cleanup" refactors. Many seemingly redundant heuristics are actually the accumulated result of browser mismatch investigations documented in tests, corpora, and `RESEARCH.md`.

### Step 5: Compile chunk metadata

`compileAnalysisChunks()` converts hard-break aware segment streams into line-walking chunks (`src/analysis.ts:946-979`).

- In normal mode, everything is one chunk.
- In `pre-wrap`, each hard break closes one chunk and the next chunk begins after the break.
- Empty chunks are preserved so consecutive hard breaks can create visible empty lines without inventing an extra trailing line.

This chunk model is what lets the line-break layer handle `pre-wrap` cleanly without putting raw newline logic all over the walker.

### Pseudocode for `analyzeText()`

```text
function analyzeText(text, engineProfile, whiteSpaceMode):
  whiteSpaceProfile = chooseProfile(whiteSpaceMode)
  normalized = normalize(text, whiteSpaceProfile)
  if normalized is empty:
    return empty analysis

  rawSegments = Intl.Segmenter(normalized, granularity="word")
  splitPieces = []
  for rawSegment in rawSegments:
    splitPieces += splitSegmentByBreakKind(rawSegment)

  merged = mergeCJKPunctuationAndQuotes(splitPieces, engineProfile)
  merged = mergeArabicAndMyanmarGlueRules(merged)
  merged = mergeEscapedQuotesAndForwardStickyClusters(merged)
  merged = mergeGlueConnectedTextRuns(merged)
  merged = mergeUrlLikeRuns(merged)
  merged = mergeUrlQueryRuns(merged)
  merged = mergeNumericRuns(merged)
  merged = splitHyphenatedNumericRuns(merged)
  merged = mergeAsciiPunctuationChains(merged)
  merged = carryTrailingForwardStickyAcrossCJKBoundary(merged)
  merged = fixLeadingSpacePlusArabicMarks(merged)

  chunks = compileAnalysisChunks(merged, whiteSpaceProfile)
  return { normalized, merged segmentation, chunks }
```

## Algorithm 2: Measurement And Engine Profiles

Measurement logic lives in `src/measurement.ts`.

### Canvas context selection

`getMeasureContext()` prefers `OffscreenCanvas` when available, otherwise falls back to a DOM canvas element, and throws if neither exists (`src/measurement.ts:27-41`). That thrown error is why headless experiments in this ticket needed a fake `OffscreenCanvas`, matching the strategy already used by `src/layout.test.ts`.

### Per-font segment metric cache

The shared cache shape is:

```text
Map<font, Map<segment, SegmentMetrics>>
```

This lives in `segmentMetricCaches` (`src/measurement.ts:18-25`, `src/measurement.ts:43-63`). `SegmentMetrics` stores the raw width and lazy-derived facts such as:

- `containsCJK`
- `emojiCount`
- `graphemeWidths`
- `graphemePrefixWidths`

The important design principle here is laziness. Width is the universal cached fact. Other facts are only populated when some layout scenario needs them.

### Engine profile shims

`getEngineProfile()` detects a tiny set of browser-specific behaviors (`src/measurement.ts:65-101`):

- `lineFitEpsilon`
- `carryCJKAfterClosingQuote`
- `preferPrefixWidthsForBreakableRuns`
- `preferEarlySoftHyphenBreak`

These booleans are not feature flags for users. They are internal shims backed by browser investigations. For example:

- Safari gets a larger `lineFitEpsilon` (`1/64`) and prefers prefix widths for breakable runs.
- Chromium carries CJK after closing quotes.
- Safari also prefers an earlier soft-hyphen decision in the general walker.

This is an important design tradeoff. The repository prefers a small, explicit engine profile over hiding browser differences in diffuse heuristics.

### Emoji correction

Pretext contains a specific correction for the fact that Chrome and Firefox on macOS can measure emoji wider in canvas than in DOM at small sizes. `getEmojiCorrection()` measures one emoji in canvas, compares it to a hidden DOM span when needed, and caches the correction per font (`src/measurement.ts:123-151`). `getCorrectedSegmentWidth()` then subtracts that correction times the number of emoji graphemes in a segment (`src/measurement.ts:153-172`).

This logic is intentionally outside the hot path. It only runs during preparation and only when the text may contain emoji.

### Per-grapheme widths

For word-like text segments longer than one grapheme, Pretext may compute:

- `graphemeWidths`
- `graphemePrefixWidths`

These are used when a segment is wider than the allowed line width and the engine must honor `overflow-wrap: break-word` style behavior (`src/measurement.ts:174-212`).

The prefix-width variant exists because some browser behaviors are modeled more accurately by prefix widths than by summing isolated grapheme widths. This is another example of a narrow browser-profile shim rather than a generalized shaping model.

### Pseudocode for measurement helpers

```text
function getFontMeasurementState(font, needsEmojiCorrection):
  ctx.font = font
  cache = getOrCreateCacheForFont(font)
  fontSize = parseFontSize(font)
  emojiCorrection = needsEmojiCorrection ? calibrateEmoji(font, fontSize) : 0
  return { cache, fontSize, emojiCorrection }

function getSegmentMetrics(segment, cache):
  if cache has segment:
    return cached metrics
  metrics.width = ctx.measureText(segment).width
  metrics.containsCJK = isCJK(segment)
  cache.set(segment, metrics)
  return metrics
```

## Algorithm 3: From Analysis To Prepared State

`measureAnalysis()` in `src/layout.ts:191-391` is the bridge between semantic analysis and fast layout.

### Important responsibilities

1. Select measurement state for the requested font.
2. Precompute shared widths such as ordinary space width and discretionary hyphen width.
3. Walk analyzed segments and emit prepared segments.
4. Split CJK text segments into smaller prepared units at grapheme-like boundaries with kinsoku-aware carry rules.
5. Compute fit and paint advances per prepared segment.
6. Compute breakable grapheme widths for overlong word-like units.
7. Map analysis chunks into prepared chunks.
8. Optionally compute segment bidi levels for the rich path.

### Why CJK can expand segment count

One important subtlety is that analysis segments and prepared segments are not always 1:1. In `measureAnalysis()`, a `text` segment that contains CJK can be split into smaller prepared units while preserving punctuation attachment and quote carry rules (`src/layout.ts:277-319`). That is why `profilePrepare()` reports both `analysisSegments` and `preparedSegments` (`src/layout.ts:436-455`), and why benchmark tables in `STATUS.md` list counts like `1773→2667`.

### Opaque handle versus rich handle

`prepare()` returns `PreparedText`, which is only a branded opaque value. `prepareWithSegments()` returns the same internal arrays plus `segments` (`src/layout.ts:97-109`, `src/layout.ts:472-480`). This is a deliberate API boundary:

- the fast path should not calcify around current internal representation;
- custom rendering and diagnostics still need structural access.

An intern should treat `PreparedTextWithSegments` as a necessary escape hatch, not the central abstraction for the whole library.

### Prepared array assembly example

Conceptually, preparation turns:

```text
["foo", " ", "trans", "\u00AD", "atlantic"]
```

into something like:

```text
segments             = ["foo", " ", "trans", "\u00AD", "atlantic"]
kinds                = ["text", "space", "text", "soft-hyphen", "text"]
widths               = [w(foo), w(space), w(trans), 0, w(atlantic)]
lineEndFitAdvances   = [w(foo), 0, w(trans), hyphenWidth, w(atlantic)]
lineEndPaintAdvances = [w(foo), 0, w(trans), hyphenWidth, w(atlantic)]
breakableWidths[4]   = [w("a"), w("t"), ...]
```

That representation is what makes later soft-hyphen decisions and hanging space behavior possible without new string measurement.

## Algorithm 4: Counting Lines Fast

`layout()` is the smallest public function in the library for a reason. It simply delegates to `countPreparedLines()` and multiplies by `lineHeight` (`src/layout.ts:495-500`).

### Simple versus general walker

`countPreparedLines()` and `walkPreparedLines()` choose between two implementations based on `prepared.simpleLineWalkFastPath` (`src/line-break.ts:133-138`, `src/line-break.ts:368-375`).

The simple path covers the common case where segments are only `text`, collapsible `space`, or `zero-width-break`. The general path is used when preparation introduced richer segment kinds such as tabs, hard breaks, glue runs, preserved spaces, or soft hyphens.

This split is a performance optimization with an architectural consequence: rich features are allowed to complicate the rich/general path, but should not silently make the default path slower unless necessary.

### How the simple walker works

Key state in `countPreparedLinesSimple()`:

- `lineCount`
- `lineW`
- `hasContent`

Key behaviors:

- if the next segment still fits, add its width;
- if a collapsible space would overflow, drop it from line fit;
- if a segment is wider than the line and has `breakableWidths`, split it by grapheme widths;
- if the current line ends without content, count the final empty line correctly (`src/line-break.ts:140-202`).

### Simple-walker pseudocode

```text
for each prepared segment:
  if line is empty:
    place segment on a fresh line
    continue

  if lineWidth + segmentWidth fits:
    append segment
    continue

  if segment is collapsible space:
    skip it
    continue

  if segment is overlong and breakable:
    break it across graphemes
    continue

  start a new line and place the segment there
```

This is what makes `layout()` so cheap for the common app-text case.

## Algorithm 5: General Line Walking

The general walker in `walkPreparedLines()` and `layoutNextLineRange()` is where the harder details live (`src/line-break.ts:368-1056`).

### Pending break model

The central idea is a pending break state:

- `pendingBreakSegmentIndex`
- `pendingBreakFitWidth`
- `pendingBreakPaintWidth`
- `pendingBreakKind`

Whenever the walker sees a segment after which a break is allowed, it records what would happen if the line ended there. If a later segment overflows, the walker can fall back to the best pending break instead of naively breaking at the overflowing segment (`src/line-break.ts:400-466`, `src/line-break.ts:702-761`).

This pending-break design is what lets the engine model browser behavior like:

- trailing whitespace hanging off the fit boundary,
- tabs contributing paint width but not necessarily fit width at the line end,
- soft hyphen breaks adding visible hyphen width,
- line end choice after a zero-width break opportunity.

### Tab handling

Tabs exist only in `pre-wrap`. The line breaker computes tab width dynamically from the current line width using `getTabAdvance()` (`src/line-break.ts:48-54`). That means a tab is not a fixed stored width in the prepared representation. Instead, the prepared state stores the absolute tab-stop advance, and the walker computes the remaining distance to the next stop for each line (`src/layout.ts:203-205`, `src/line-break.ts:571-573`, `src/line-break.ts:841`).

### Hard breaks and chunks

The general walker iterates chunk by chunk (`src/line-break.ts:554-655`). Empty chunks produce empty lines. Normal chunks reset line state at their boundaries. `normalizeLineStart()` also uses chunk information so `layoutNextLine()` can resume correctly after leading spaces or a hard break (`src/line-break.ts:94-131`).

### Soft hyphen fitting

Soft hyphen behavior is one of the more intricate parts of the code. The walker must decide:

- whether to keep accumulating into the next segment,
- whether to end the line at the soft hyphen and paint a visible `-`,
- whether part of the following breakable segment can fit before the visible hyphen.

This is handled by:

- `fitSoftHyphenBreak()` (`src/line-break.ts:68-92`)
- `continueSoftHyphenBreakableSegment()` (`src/line-break.ts:504-540`)
- `maybeFinishAtSoftHyphen()` (`src/line-break.ts:796-836`)

The public rich API requirement is explicit in contributor notes and tests: if a soft hyphen wins, `line.text` must include a visible trailing `-` even though the prepared segment stream stores the soft hyphen itself as invisible unless chosen.

### Why fit width and paint width matter in the walker

When overflow happens, the general walker checks fit width first and paint width second:

- fit width decides whether a break location is legally within `maxWidth`;
- paint width decides what visible width the resulting line should report.

This prevents "invisible" hanging spaces from forcing new lines while still preserving the right rendered geometry.

## Algorithm 6: Rich Line APIs

The rich APIs in `src/layout.ts` layer text materialization and cursor handling on top of the shared line walker.

### `layoutWithLines()`

This is the batch rich API. It uses `walkPreparedLines()` to gather geometry, then materializes line text via `materializeLayoutLine()` and `buildLineTextFromRange()` (`src/layout.ts:612-705`).

### `walkLineRanges()`

This is the geometry-only batch API. It reports width plus start/end cursors but avoids string building (`src/layout.ts:667-679`). It exists for userland geometry problems such as shrink-wrap width search, obstacle-aware layout, and other aggregate calculations.

### `layoutNextLine()`

This is the streaming rich API. It relies on `layoutNextLineRange()` in `src/line-break.ts` and then materializes exactly one line (`src/layout.ts:681-689`, `src/line-break.ts:657-1056`).

This is the API to care about if you are building userland layout that changes width per line, such as text flowing around an image or through custom editorial shapes. The contributor notes explicitly say the browser demos should increasingly dogfood this path.

### Rich-path text materialization

The rich path keeps a `WeakMap`-backed per-prepared cache of grapheme splits so repeated line materialization does not keep re-segmenting the same segments (`src/layout.ts:67-77`, `src/layout.ts:503-527`).

`buildLineTextFromRange()` is worth reading carefully (`src/layout.ts:542-579`). It:

- skips hard-break and soft-hyphen control segments in normal text materialization,
- slices grapheme arrays correctly when a line starts or ends inside a breakable segment,
- appends a visible `-` when a discretionary hyphen wins.

That function is effectively the decoder from cursor ranges back into user-visible line strings.

## Bidi Metadata

`src/bidi.ts` is intentionally narrow. It computes simplified bidi embedding levels based on codepoint classification rules adapted from pdf.js (`src/bidi.ts:1-173`). The key design constraint is in the file header and the prepared representation:

- bidi levels are for rich-path custom rendering metadata only,
- line breaking itself does not read bidi levels (`src/bidi.ts:1-5`, `src/layout.ts:87-90`).

This matters because a newcomer might assume bidi is part of line-breaking correctness. In this repository, it is not. The line-breaking model stays width- and break-opportunity-driven. Bidi is preserved only where userland renderers may need it.

## Validation And Steering Tooling

The codebase is not just a library; it is a library plus a research harness.

### Durable invariant tests

`src/layout.test.ts` uses a deterministic fake `OffscreenCanvas` and focuses on long-lived invariants rather than mirroring every browser-specific investigation (`src/layout.test.ts:1-120`). The tests are organized around:

- prepare invariants,
- layout invariants.

The test file is also the best compact catalog of behaviors the maintainers consider worth permanently preserving:

- whitespace normalization,
- `pre-wrap` rules,
- non-breaking glue,
- zero-width spaces,
- soft hyphens,
- Arabic punctuation glue,
- URL and numeric merging,
- CJK punctuation handling,
- rich API agreement (`src/layout.test.ts:121-627`).

### Browser accuracy page

`pages/accuracy.ts` builds hidden DOM blocks with the same font, line height, and width as the library prediction target, then compares:

- actual DOM height from `getBoundingClientRect()`,
- predicted height from `layout()`,
- browser-extracted line content versus `layoutWithLines()` for mismatches (`pages/accuracy.ts:177-261`).

The line extractor uses `Range.getClientRects()` over grapheme-safe diagnostic units from `pages/diagnostic-utils.ts` (`pages/accuracy.ts:144-175`, `pages/diagnostic-utils.ts:11-31`). That is an important design point: diagnostics work from prepared segments and grapheme fallbacks, not from reconstructing line boundaries from already-rendered line strings.

### Benchmark page

`pages/benchmark.ts` measures:

- cold `prepare()` cost,
- hot `layout()` cost,
- DOM batch and interleaved resize baselines,
- rich-path API costs,
- long-form corpus stress,
- corpus-specific analysis versus measurement split (`pages/benchmark.ts:257-306`, `pages/benchmark.ts:313-377`, `pages/benchmark.ts:401-669`).

This page enforces the central architectural story:

- `prepare()` can be expensive,
- `layout()` must stay extremely cheap,
- DOM interleaving is the performance anti-pattern to beat.

### Browser automation

`scripts/browser-automation.ts` provides:

- a self-healing single-owner automation lock per browser,
- lightweight AppleScript control for Safari and Chrome,
- temporary Bun page server management,
- report retrieval through URL hash payloads (`scripts/browser-automation.ts:111-160`, `scripts/browser-automation.ts:193-363`).

The single-owner lock matters because corpus and accuracy jobs are not supposed to run in parallel against the same browser.

### Corpora and taxonomy

[corpora/STATUS.md](../../../../../../corpora/STATUS.md) is the compact dashboard for canary corpora. [corpora/TAXONOMY.md](../../../../../../corpora/TAXONOMY.md) provides a shared vocabulary for interpreting misses:

- `boundary-discovery`
- `glue-policy`
- `edge-fit`
- `shaping-context`
- `font-mismatch`
- `diagnostic-sensitivity`
- and others

This taxonomy is operationally important. It tells contributors what kind of fix to attempt:

- preprocessing changes for boundary/glue problems,
- tolerance or narrow shim investigation for edge-fit problems,
- skepticism and broader architectural caution for shaping-context problems.

## Design Decisions

### Decision 1: Keep `layout()` arithmetic-only

This is the most important decision in the project. The repository history explicitly rejected attempts to move measurement or full-string reconstruction into `layout()` because those ideas regressed the hot path and usually failed to solve the real browser canaries ([RESEARCH.md](../../../../../../RESEARCH.md), `src/layout.ts:486-500`).

### Decision 2: Put script-specific fixes in analysis, not the hot path

The contributor notes say this directly, and the code structure reinforces it. Punctuation glue, URL grouping, numeric grouping, Arabic mark handling, Myanmar glue, and similar fixes are all concentrated in `src/analysis.ts`, not spread through `layout()` or rich string materialization.

### Decision 3: Use parallel arrays and opaque fast-path types

The prepared representation is parallel-array based because the line walker wants predictable indexed access and low allocation overhead. `PreparedText` stays opaque so user code does not accidentally lock the project into a representation that is convenient to inspect but poor for hot-path performance (`src/layout.ts:97-109`).

### Decision 4: Use browser shims sparingly and explicitly

The engine profile exists, but it is intentionally tiny. The code prefers narrow, named shims such as `lineFitEpsilon` or `preferPrefixWidthsForBreakableRuns` over broad "magic" correction models (`src/measurement.ts:11-16`, `src/measurement.ts:65-101`).

### Decision 5: Keep long-form corpora and mixed app text as steering canaries

The official browser regression sweep is now mostly a gate, not the only steering metric. Current project docs repeatedly say the long-form corpora and mixed app text are where subtle regressions still show up ([STATUS.md](../../../../../../STATUS.md), [TODO.md](../../../../../../TODO.md), [corpora/STATUS.md](../../../../../../corpora/STATUS.md)).

## Alternatives Considered

The codebase and research log document several rejected approaches.

### Full DOM measurement in the runtime path

Rejected because it reintroduces layout/reflow cost and destroys the main value proposition of the library ([RESEARCH.md](../../../../../../RESEARCH.md)).

### Measuring full candidate lines during layout

Rejected because it adds string work and measurement cost exactly where the architecture wants none.

### Broad pair-level or shaping-aware correction layers on top of segment sums

Rejected repeatedly in Arabic investigations because the cost and complexity were real while the accuracy gains were narrow or unstable. The surviving improvements tended to be preprocessing, diagnostics, corpus cleanup, and tiny tolerances instead.

### Replacing `Intl.Segmenter` with a large custom Unicode stack

Rejected as a runtime center of gravity. The project explicitly treats larger stacks such as `text-shaper` as reference material, not as runtime replacements.

### Using server-side engines as the main truth source

Rejected because browser-parity was not good enough. HarfBuzz, server canvas, and other tools remain useful for probes, not as drop-in runtime truth.

## Implementation Guide For Future Changes

When you need to change behavior, first decide which layer the change belongs in.

### If the problem is wrong break opportunity discovery

Start in [`src/analysis.ts`](../../../../../../src/analysis.ts).

Typical signs:

- the browser and engine disagree on where a word/punctuation cluster should stay together,
- a new script-specific glue behavior appears,
- a product-shaped token like a URL or time range breaks obviously badly.

Typical workflow:

1. create a small reproducer,
2. add or refine preprocessing rule,
3. add or update a durable test only if the behavior is stable,
4. validate against browser canaries and corpora.

### If the problem is width disagreement with otherwise-correct boundaries

Start in [`src/measurement.ts`](../../../../../../src/measurement.ts) or the engine-profile logic.

Typical signs:

- every break opportunity looks semantically right,
- misses are tiny edge-fit drifts,
- one browser behaves differently from the others,
- font stack differences matter.

Typical workflow:

1. verify the font stack and browser,
2. inspect whether the issue is already taxonomy-classified as `edge-fit`, `font-mismatch`, or `diagnostic-sensitivity`,
3. prefer narrow calibration or tolerance shims over broad heuristics.

### If the problem is rich-path line materialization or cursor behavior

Start in [`src/layout.ts`](../../../../../../src/layout.ts) rich-path helpers or [`src/line-break.ts`](../../../../../../src/line-break.ts) streaming functions.

Typical signs:

- `layout()` line counts are correct but `layoutWithLines()` text is wrong,
- `layoutNextLine()` disagrees with `layoutWithLines()`,
- soft hyphen display is wrong,
- start/end cursors drift.

### If the problem is benchmark methodology or repo validation

Start in:

- [`pages/benchmark.ts`](../../../../../../pages/benchmark.ts)
- [`pages/accuracy.ts`](../../../../../../pages/accuracy.ts)
- [`scripts/browser-automation.ts`](../../../../../../scripts/browser-automation.ts)
- [STATUS.md](../../../../../../STATUS.md)
- [corpora/STATUS.md](../../../../../../corpora/STATUS.md)

Do not change algorithm code just because a probe or extractor is suspicious. The taxonomy explicitly reserves `diagnostic-sensitivity` for cases where the tool may be wrong before the engine is wrong.

## Safe Modification Workflow

Use this workflow for non-trivial engine changes:

1. Reproduce the mismatch with the smallest honest example.
2. Classify it using the corpus taxonomy vocabulary.
3. Decide whether the fix belongs in analysis, measurement, line walking, or diagnostics.
4. Add or adjust a narrow test only if the behavior is durable and repo-worthy.
5. Run:
   - `bun test`
   - `bun run check`
   - targeted `bun run accuracy-check`
   - relevant corpus checks/sweeps
   - benchmark refresh if the hot path or methodology changed
6. Update `STATUS.md`, benchmark snapshots, accuracy snapshots, or corpus representatives when the contributor notes require it.

## Ticket-Local Experiments

This ticket includes a small local experiment script and generated sample output:

- [`scripts/inspect-pipeline.ts`](../scripts/inspect-pipeline.ts)
- [`various/01-pipeline-samples.md`](../various/01-pipeline-samples.md)

The script snapshots:

- analysis output,
- prepared segments and widths,
- line results for representative examples,
- split prepare timing from `profilePrepare()`.

It uses a deterministic fake `OffscreenCanvas`, mirroring the repo’s test strategy, because the local shell environment used for this ticket does not expose a browser canvas backend.

## Worked Mental Model

When someone asks, "what does Pretext actually do?", the clearest answer is:

1. normalize the input according to the supported whitespace model;
2. discover semantically meaningful break units;
3. measure those units once with the browser’s font engine;
4. store the measured result in a compact representation;
5. answer future width questions by walking those cached units.

The simplest possible mental model for an intern is:

```text
Pretext is a specialized compiler.

Source language:
  raw browser text under a narrow CSS contract

IR 1:
  merged semantic segments with break kinds

IR 2:
  measured prepared arrays with grapheme fallback data

Execution:
  line walkers over measured arrays
```

Thinking in those terms makes the rest of the repository much easier to reason about. If a bug is reported, ask which representation is wrong:

- raw normalization,
- semantic segmentation,
- measured prepared state,
- or line walking.

## Open Questions

Current open questions visible in the repo are:

- whether line-fit tolerance should remain a browser shim or move toward runtime calibration,
- whether `pre-wrap` should grow beyond spaces, tabs, and `\n`,
- whether `system-ui` warrants a narrow prepare-time DOM fallback,
- whether automatic hyphenation belongs in scope,
- whether stronger bidi rendering concerns should ever move into scope,
- whether server canvas support should become an explicit supported backend ([TODO.md](../../../../../../TODO.md), contributor notes in `AGENTS.md`).

The right way for an intern to approach these is not to jump straight to implementation. First ask whether the requested capability preserves the existing center of gravity:

- preparation-heavy,
- arithmetic-only layout,
- browser-grounded validation,
- narrow, explicit scope.

## References

Primary source files:

- [`src/layout.ts`](../../../../../../src/layout.ts)
- [`src/analysis.ts`](../../../../../../src/analysis.ts)
- [`src/measurement.ts`](../../../../../../src/measurement.ts)
- [`src/line-break.ts`](../../../../../../src/line-break.ts)
- [`src/bidi.ts`](../../../../../../src/bidi.ts)
- [`src/layout.test.ts`](../../../../../../src/layout.test.ts)
- [`src/test-data.ts`](../../../../../../src/test-data.ts)
- [`pages/accuracy.ts`](../../../../../../pages/accuracy.ts)
- [`pages/benchmark.ts`](../../../../../../pages/benchmark.ts)
- [`pages/diagnostic-utils.ts`](../../../../../../pages/diagnostic-utils.ts)
- [`scripts/browser-automation.ts`](../../../../../../scripts/browser-automation.ts)

Project status and steering documents:

- [README.md](../../../../../../README.md)
- [STATUS.md](../../../../../../STATUS.md)
- [TODO.md](../../../../../../TODO.md)
- [RESEARCH.md](../../../../../../RESEARCH.md)
- [corpora/STATUS.md](../../../../../../corpora/STATUS.md)
- [corpora/TAXONOMY.md](../../../../../../corpora/TAXONOMY.md)

Ticket-local evidence:

- [`scripts/inspect-pipeline.ts`](../scripts/inspect-pipeline.ts)
- [`various/01-pipeline-samples.md`](../various/01-pipeline-samples.md)

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->
