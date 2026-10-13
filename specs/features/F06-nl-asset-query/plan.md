# F06 · Natural-language asset queries — Plan

## Summary
A deterministic query planner that parses operator questions into intent, asset ids/types, metrics, and time windows, then grounds Studio's Claude-powered answers in the resulting fleet-state slice, plus a 0–100 health score per asset.

## User stories
- As a reliability engineer, I want to ask "how is motor MTR-101 performing?" and get an accurate intent so the system queries the right data. (AC-F06-1)
- As a developer, I want asset ids like "SHF 301" and asset types like "centrifugal pump" resolved correctly so results scope to the right equipment. (AC-F06-2)
- As a user, I want metrics and time windows like "last 10 minutes" extracted from my question so the query reflects what I actually asked. (AC-F06-3)
- As an operator, I want a 0–100 health score per asset so I can tell nominal from severely deviating equipment at a glance. (AC-F06-4)

## Acceptance criteria traceability
| AC | Covered by |
|---|---|
| AC-F06-1 | `parseQuery` intent rule ladder (inventory→work_orders→car→anomalies→trend→ranking→condition), validated against golden set |
| AC-F06-2 | `parseQuery` asset id/type resolution incl. "SHF 301" spaced form and centrifugal disambiguation |
| AC-F06-3 | `parseQuery` metric keyword table and window regex ("last N s/m/h") default 300s |
| AC-F06-4 | `healthScore(assetType, metrics)` scoring: 100 nominal, <50 severe deviation |

## Contract
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`
- `healthScore(assetType, metrics)` → number 0–100
- Intents: `condition`, `trend`, `anomalies`, `ranking`, `inventory`, `work_orders`, `car`

## Dependencies
- F02 (createDetector, vibrationZone, classify) — supplies live metrics/anomaly state for `condition`/`anomalies`/`trend` answers; not reimplemented here.
- F03 (createWorkOrderService) — supplies data for `work_orders` intent.
- F05 (createInventory) — supplies data for `inventory` intent.

F06 must not duplicate internal logic of F02/F03/F05; it only consumes their exported contracts.

## Non-goals
- Free-form SQL generation.
- Write actions from chat (no mutating inventory/work orders via NLQ).

## Risks
"Centrifugal" alone is ambiguous between pump and compressor; planner resolves bare "centrifugal" to `centrifugal_pump` unless "compressor" is present, per rules. Golden set is normative for intent disambiguation edge cases.

## Telemetry & evals
Behavioural eval: golden-set intent accuracy must equal 1.0 (AC-F06-1). Track parse failures (unresolved assets/metrics) as eval regressions.

## Definition of done
- `edge/features/F06-nl-asset-query/index.js` exports `parseQuery`, `healthScore` matching contract shapes exactly.
- All golden-set cases pass with 100% intent accuracy (AC-F06-1).
- Asset id/type resolution, including "SHF 301" and the five listed types, verified by tests (AC-F06-2).
- Metric and window extraction verified for representative phrasings, incl. "last 10 minutes" (AC-F06-3).
- `healthScore` returns 100 at nominal metrics and <50 under severe deviation across supported asset types (AC-F06-4).
- No operator/technician names surfaced in NLQ answers — asset ids only.
