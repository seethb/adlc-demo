---
id: F06
slug: F06-nl-asset-query
title: Natural-language asset queries
owner: sage
priority: should
depends: [F02, F03, F05]
module: edge/features/F06-nl-asset-query/index.js
reference: edge/reference/nlq.js
exports: parseQuery, healthScore
---

# F06 · Natural-language asset queries (NLQ)

## Problem
Developers and reliability engineers want to ask "how is motor MTR-101 performing?"
or "which centrifugal pumps have cavitation risk?" without writing queries.

## Scope
A deterministic query planner (intent, assets, asset types, metrics, time window) that
selects the slice of live fleet state to answer from, and a health score per asset. The
Studio answers with Claude, grounded in that slice plus Meko knowledge.

**Non-goals:** free-form SQL generation; write actions from chat.

## Contract
`parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`,
`healthScore(assetType, metrics)` → 0–100.

Intents: `condition`, `trend`, `anomalies`, `ranking`, `inventory`, `work_orders`, `car`.

## Acceptance criteria
- **AC-F06-1** Intent accuracy on the golden set is 100 %.
- **AC-F06-2** Asset ids (including "SHF 301") and asset types (motor, centrifugal pump, shaft, centrifugal compressor, gearbox) are resolved.
- **AC-F06-3** Metrics and time windows ("last 10 minutes") are extracted.
- **AC-F06-4** Health is 100 at nominal and below 50 with severe deviation.

## Telemetry & evals
Behavioural eval: golden-set intent accuracy = 1.0.

## Risks
"Centrifugal" is ambiguous between pumps and compressors; the planner must disambiguate.
