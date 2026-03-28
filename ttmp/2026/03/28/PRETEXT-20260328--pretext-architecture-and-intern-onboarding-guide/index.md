---
Title: Pretext architecture and intern onboarding guide
Ticket: PRETEXT-20260328
Status: active
Topics:
    - pretext
    - text-layout
    - browser-accuracy
    - intern-onboarding
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: README.md
      Note: Public API contract and scope summary
    - Path: RESEARCH.md
      Note: Historical algorithm exploration and rejected approaches
    - Path: STATUS.md
      Note: Current browser accuracy and benchmark dashboard
    - Path: TODO.md
      Note: Current priorities and open questions
    - Path: corpora/STATUS.md
      Note: Long-form canary status and current corpus steering picture
    - Path: corpora/TAXONOMY.md
      Note: Shared mismatch vocabulary used for reasoning about fixes
    - Path: pages/accuracy.ts
      Note: Browser sweep and DOM-vs-engine diagnostics
    - Path: pages/benchmark.ts
      Note: Performance methodology and corpus stress harness
    - Path: pages/diagnostic-utils.ts
      Note: Grapheme-safe diagnostic extraction helpers
    - Path: scripts/browser-automation.ts
      Note: Browser control and checker plumbing
    - Path: src/analysis.ts
      Note: Whitespace normalization and semantic segmentation rules
    - Path: src/bidi.ts
      Note: Rich-path-only bidi metadata helper
    - Path: src/layout.test.ts
      Note: Durable invariants and behavior catalog
    - Path: src/layout.ts
      Note: Public API
    - Path: src/line-break.ts
      Note: Hot-path and rich-path line walking algorithms
    - Path: src/measurement.ts
      Note: Canvas measurement cache and browser profile shims
    - Path: src/test-data.ts
      Note: Shared short-form text corpus for accuracy and benchmark pages
    - Path: ttmp/2026/03/28/PRETEXT-20260328--pretext-architecture-and-intern-onboarding-guide/scripts/inspect-pipeline.ts
      Note: Ticket-local experiment script for representative pipeline snapshots
    - Path: ttmp/2026/03/28/PRETEXT-20260328--pretext-architecture-and-intern-onboarding-guide/various/01-pipeline-samples.md
      Note: Generated sample output for the experiment script
ExternalSources: []
Summary: ""
LastUpdated: 2026-03-28T09:19:48.224755704-04:00
WhatFor: Track a detailed architecture and onboarding analysis of the Pretext text layout engine.
WhenToUse: Use when an engineer needs a codebase map, algorithm explanation, validation workflow, or intern-oriented implementation guide.
---



# Pretext architecture and intern onboarding guide

## Overview

This ticket captures a full architecture and algorithm analysis of the Pretext repository for a new engineer. The deliverables are:

- a detailed design and implementation guide for the text engine,
- a chronological investigation diary,
- a ticket-local experiment script and generated pipeline snapshots,
- docmgr bookkeeping and reMarkable delivery evidence.

## Key Links

- Main design doc: `design-doc/01-pretext-architecture-algorithms-and-intern-implementation-guide.md`
- Investigation diary: `reference/01-investigation-diary.md`
- Ticket-local experiment script: `scripts/inspect-pipeline.ts`
- Generated experiment output: `various/01-pipeline-samples.md`
- Repo status dashboard: `../../../../../../STATUS.md`
- Repo research log: `../../../../../../RESEARCH.md`

## Status

Current status: **active**

Work completed in this ticket:

- ticket workspace created,
- architecture evidence gathered from source files and current repo status documents,
- intern-oriented design guide written,
- ticket-local experiment script created and run,
- validation and delivery steps recorded in the diary.

## Topics

- pretext
- text-layout
- browser-accuracy
- intern-onboarding

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
