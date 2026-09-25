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

### Planner rules (the golden set in `F06-nl-asset-query.golden.json` is normative)
Matching is case-insensitive on the lower-cased question.

**Intent** — the first rule that matches wins, in this order:
1. `inventory` — part, parts, spare, spares, stock, inventory, reorder
2. `work_orders` — "work order(s)", "wo"/"wos", "maintenance backlog"
3. `car` — car, cars, corrective, "root cause"
4. `anomalies` — anomal*, alarm(s), alert(s), fault*, risk
5. `trend` — trend, history, "last N …", "over time"
6. `ranking` — worst, rank*, most, healthiest, least
7. otherwise `condition`

**Asset ids** — `MTR-101` and the spaced form `SHF 301` both resolve to the canonical id.

**Asset types** — motor(s) → `motor`; pump(s) or bare "centrifugal" → `centrifugal_pump`;
compressor(s) → `centrifugal_compressor` (and then "centrifugal" alone does **not** also add
`centrifugal_pump` unless "pump" is present); shaft(s) → `shaft`; gearbox / gear box → `gearbox`.

**Metrics** — keyword → metric:

| Keywords | Metric |
|---|---|
| vibrat*, shak* | `vibration` |
| bearing* | `bearingTemp` |
| winding*, stator | `windingTemp` |
| current, amp(s), load | `current` |
| rpm, speed | `rpm` |
| flow | `flow` |
| suction, npsh, cavitat* | `suctionPressure` |
| "discharge pressure", head | `dischargePressure` |
| misalign*, alignment | `misalignment` |
| orbit, runout | `shaftOrbit` |
| torque | `torque` |
| surge | `surgeMargin` |
| oil | `oilTemp` |
| particle*, debris | `particleCount` |

**Window** — "last N s|sec|seconds|m|min|minutes|h|hours" → seconds; default 300.
`resolvedAssets` = explicit ids, else all assets of the matched types, else the whole fleet.

## Acceptance criteria
- **AC-F06-1** Intent accuracy on the golden set is 100 %.
- **AC-F06-2** Asset ids (including "SHF 301") and asset types (motor, centrifugal pump, shaft, centrifugal compressor, gearbox) are resolved.
- **AC-F06-3** Metrics and time windows ("last 10 minutes") are extracted.
- **AC-F06-4** Health is 100 at nominal and below 50 with severe deviation.

## Telemetry & evals
Behavioural eval: golden-set intent accuracy = 1.0.

## Risks
"Centrifugal" is ambiguous between pumps and compressors; the planner must disambiguate.
