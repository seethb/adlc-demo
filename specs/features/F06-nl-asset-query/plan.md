# F06 · Natural-language asset queries — Plan

## Summary
A deterministic query planner (`parseQuery`) extracts intent, asset ids/types, metrics and time windows from NL text, and `healthScore` computes a 0–100 health value per asset type/metrics. The Studio uses this parsed slice plus Meko knowledge to ground Claude's answers.

## User stories
- As a reliability engineer, I want my question's intent correctly classified so I get the right kind of answer. [AC-F06-1]
- As a user, I want to reference an asset by id (e.g. "SHF 301") or type (motor, centrifugal pump, shaft, centrifugal compressor, gearbox) and have it resolved to the right asset(s). [AC-F06-2]
- As a user, I want to ask about specific metrics over a time window ("last 10 minutes") and have those extracted for the query. [AC-F06-3]
- As a user, I want a single health score per asset so I can quickly see if it's nominal or degraded. [AC-F06-4]

## AC traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F06-1 | Intent accuracy on golden set = 100% | parseQuery intent classifier + golden-set eval |
| AC-F06-2 | Asset id/type resolution incl. "SHF 301", centrifugal disambiguation | parseQuery asset resolver |
| AC-F06-3 | Metrics & time window extraction ("last 10 minutes") | parseQuery metric/window extractor |
| AC-F06-4 | Health 100 nominal, <50 severe deviation | healthScore |

## Contract
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`
  - `intent`: one of `condition | trend | anomalies | ranking | inventory | work_orders | car`
- `healthScore(assetType, metrics)` → number 0–100

## Dependencies
- F02 (streaming anomaly detection): supplies deviation/anomaly signals consumed by `healthScore` and `anomalies`/`trend` intents.
- F03 (automated work orders): grounds `work_orders`/`car` intents.
- F05 (spare-parts inventory): grounds `inventory` intent.

## Non-goals
- No free-form SQL generation.
- No write actions (creating work orders, reservations, etc.) from chat.

## Risks
- "Centrifugal" is ambiguous between pump and compressor; planner must disambiguate via qualifying nouns ("centrifugal pump" vs "centrifugal compressor") and fail closed to "unresolved" rather than guessing.
- Golden-set drift as new phrasing patterns emerge could regress AC-F06-1; requires versioned golden set.

## Telemetry & evals
- Behavioural eval: golden-set intent accuracy must equal 1.0 (AC-F06-1), run on every change to `parseQuery`.
- Log parse failures (unresolved assets, no intent match) as structured events for eval-set growth, without operator/technician names, per privacy standard.

## Definition of done
- `edge/features/F06-nl-asset-query/index.js` exports `parseQuery` and `healthScore` matching the contract.
- Executable acceptance suite passes AC-F06-1 through AC-F06-4.
- Golden-set eval reports 100% intent accuracy.
- Disambiguation logic for "centrifugal" verified by tests for both pump and compressor phrasing.
