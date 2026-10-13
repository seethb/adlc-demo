# F06 Natural-language asset queries — Plan

## Summary
Deterministic NLQ planner that parses free-text questions into intent, resolved assets/types, metrics, and time window, plus a per-asset health score. Grounds Claude's Studio answers in live fleet state (F02), work orders (F03), and inventory (F05) data without duplicating their logic.

## User stories
- As a reliability engineer, I want the system to correctly classify my question's intent so I get relevant answers. (AC-F06-1)
- As an engineer, I want to refer to assets by id (e.g. "SHF 301") or type (e.g. "centrifugal pump") and have them resolved correctly. (AC-F06-2)
- As a user, I want to specify metrics and time windows in plain English ("last 10 minutes") and have them extracted precisely. (AC-F06-3)
- As a user, I want a single health number per asset so I can quickly tell nominal from severe deviation. (AC-F06-4)

## Acceptance criteria traceability

| AC id | Covered by |
|---|---|
| AC-F06-1 | Intent rule cascade (inventory→work_orders→car→anomalies→trend→ranking→condition) validated against golden set |
| AC-F06-2 | Asset id regex (incl. spaced "SHF 301") + asset-type keyword table, with centrifugal disambiguation |
| AC-F06-3 | Metric keyword table + window regex ("last N s/m/h") with 300s default |
| AC-F06-4 | healthScore(assetType, metrics) returns 100 at nominal, <50 under severe deviation |

## Contract
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`
- `healthScore(assetType, metrics)` → 0–100

Intents: `condition`, `trend`, `anomalies`, `ranking`, `inventory`, `work_orders`, `car`.

## Dependencies
- **F02** — supplies live metrics/anomaly state used to resolve `resolvedAssets` and compute `healthScore` deviations; F06 must not reimplement zone/classification logic.
- **F03** — supplies work-order data for the `work_orders` intent; F06 reads WO shape, never recomputes it.
- **F05** — supplies inventory data for the `inventory` intent; F06 reads availability/lowStock, never reimplements reservation logic.

## Non-goals
- No free-form SQL generation.
- No write actions (e.g. creating WOs, reserving parts) from chat.

## Risks
"Centrifugal" is ambiguous between pump and compressor. Mitigation: if "compressor" present, resolve to `centrifugal_compressor` only; bare "centrifugal" or "pump" resolves to `centrifugal_pump`.

## Telemetry & evals
- Behavioural eval: golden-set intent accuracy must equal 1.0 (AC-F06-1), run on every change to `edge/reference/nlq.js` and `edge/features/F06-nl-asset-query/index.js`.
- Log parsed query shape (intent, resolvedAssets count, windowSec) for debugging, never operator/technician names (asset ids only, per privacy standard).

## Definition of done
- `parseQuery` and `healthScore` implemented per contract in `edge/features/F06-nl-asset-query/index.js`.
- All AC-F06-1..4 pass against `F06-nl-asset-query.golden.json` and acceptance suite.
- No duplication of F02/F03/F05 internal logic; only their documented contracts are called.
- Design doc's AC→design mapping and reused-team-decisions sections stay consistent with this plan.
