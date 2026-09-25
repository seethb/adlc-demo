# F06 · Natural-language asset queries — Plan

## Summary
A deterministic NL query planner resolves intent, asset ids/types, metrics, and time windows from free text, selecting a grounded slice of fleet state for the Studio's Claude-backed answers. A companion `healthScore` maps asset metrics to a 0–100 score.

## User stories
- As a reliability engineer, I want to ask "how is motor MTR-101 performing?" and get the right data slice, so that I don't need to write queries. (AC-F06-1, AC-F06-2)
- As a developer, I want asset ids like "SHF 301" and asset types (motor, centrifugal pump, shaft, centrifugal compressor, gearbox) correctly resolved, so that the answer targets the right assets. (AC-F06-2)
- As an operator, I want to ask about vibration trends "over the last 10 minutes", so that the planner extracts the right metric and window. (AC-F06-3)
- As a manager, I want an at-a-glance health score that's 100 when nominal and drops below 50 under severe deviation, so that I can triage quickly. (AC-F06-4)

## Acceptance criteria traceability
| AC id | Covered by |
|---|---|
| AC-F06-1 | Intent rule cascade (inventory→work_orders→car→anomalies→trend→ranking→condition), validated against golden set |
| AC-F06-2 | Asset id regex (incl. spaced "SHF 301") + asset-type keyword map with centrifugal disambiguation |
| AC-F06-3 | Metric keyword table + "last N unit" window parser (default 300s) |
| AC-F06-4 | `healthScore(assetType, metrics)` deviation-based scoring |

## Contract
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`. Intents: `condition, trend, anomalies, ranking, inventory, work_orders, car`.
- `healthScore(assetType, metrics)` → number 0–100.

## Dependencies
- F02 (createDetector, vibrationZone, classify): supplies live metrics/anomaly severity data for `condition`/`anomalies`/`trend`/`ranking` intents.
- F03 (createWorkOrderService): supplies work order records for `work_orders` intent; do not reimplement WO logic.
- F05 (createInventory): supplies stock/reservation data for `inventory` intent; do not reimplement inventory logic.

## Non-goals
Free-form SQL generation; write actions (creating WOs, reserving parts) from chat.

## Risks
"Centrifugal" alone is ambiguous between pump and compressor; resolver must require "pump"/"compressor" qualifier and must not double-assign both types from "centrifugal" plus "compressor".

## Telemetry & evals
Behavioural eval against `F06-nl-asset-query.golden.json`: intent accuracy must equal 1.0 (AC-F06-1). Track false asset-id/type resolution and window-parse mismatches as regressions.

## Definition of done
- `parseQuery`/`healthScore` exported from `edge/features/F06-nl-asset-query/index.js` matching contract shapes exactly.
- Golden-set intent accuracy 100% (AC-F06-1).
- Asset id/type resolution incl. "SHF 301" and centrifugal disambiguation verified (AC-F06-2).
- Metric + window extraction verified incl. "last 10 minutes" (AC-F06-3).
- Health score 100 nominal, <50 severe deviation verified (AC-F06-4).
- No operator/technician names surfaced in answers, only asset ids, per privacy standard.
