# F06 · Natural-language asset queries — Plan

## Summary
Deterministic NL query planner + health scorer grounding Studio chat answers. Parses intent, asset ids/types, metrics, and time windows from free text; computes per-asset health 0–100. No PII, no asset write actions, no SQL generation.

## User stories
- As a reliability engineer, I want to ask "how is motor MTR-101 performing?" and get intent+asset resolved, so that Studio can answer grounded in live state. (AC-F06-1, AC-F06-2)
- As a developer, I want asset ids like "SHF 301" and types like "centrifugal pump" recognized despite ambiguity, so that queries target the right fleet slice. (AC-F06-2)
- As a user, I want to say "last 10 minutes" and have the metric and window extracted, so that trend queries scope correctly. (AC-F06-3)
- As a user, I want a 0–100 health score per asset that reflects severe deviation, so that I can triage at a glance. (AC-F06-4)

## AC traceability table
| AC | Description | Covered by |
|---|---|---|
| AC-F06-1 | Intent accuracy 100% on golden set | parseQuery intent classifier + eval suite |
| AC-F06-2 | Resolve asset ids ("SHF 301") and types (motor, centrifugal pump, shaft, centrifugal compressor, gearbox) | parseQuery asset/type resolver |
| AC-F06-3 | Extract metrics and time windows ("last 10 minutes") | parseQuery metric/window extractor |
| AC-F06-4 | Health = 100 nominal, <50 severe deviation | healthScore |

## Contract
```
parseQuery(text) → { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }
healthScore(assetType, metrics) → 0–100
```
Intents: condition, trend, anomalies, ranking, inventory, work_orders, car.
Module: edge/features/F06-nl-asset-query/index.js. Reference: edge/reference/nlq.js.

## Dependencies
- F02: live fleet telemetry/metrics as input to healthScore and query grounding.
- F03: anomaly/deviation signals feeding severe-deviation health cases.
- F05: inventory data for `inventory` intent queries.

## Non-goals
Free-form SQL generation; write actions (no reserve/consume/CAR-create) from chat; no PII/operator names in resolved assets or answers.

## Risks
"Centrifugal" is ambiguous between pump and compressor — planner must use surrounding context (explicit "pump"/"compressor") to disambiguate, else request clarification. Golden-set drift could regress intent accuracy below 100%.

## Telemetry & evals
Behavioural eval: golden-set intent accuracy must equal 1.0 (AC-F06-1). Log parsed query shape (intent, resolved asset count, window) per request, timestamps ISO-8601 UTC, numeric values rounded to 3 decimals. No PII in logs.

## Definition of done
- parseQuery and healthScore implemented per contract, each branch commented with the AC id it satisfies.
- All AC-F06-1..4 pass under QA's immutable acceptance suite.
- Ambiguity handling for "centrifugal" verified against golden set.
- No PII/operator names surface in parsed output or logs; egress shield checked.
