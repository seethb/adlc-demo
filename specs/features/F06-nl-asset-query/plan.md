# F06 · Natural-language asset queries — Plan

## Summary
A deterministic query planner that parses natural-language questions about fleet assets into structured intent, resolved assets/types, metrics, and time windows, plus a health scoring function. Grounds Claude's Studio answers without free-form SQL generation.

## User stories
- As a reliability engineer, I want to ask "how is motor MTR-101 performing?" and get an accurate intent classification, so that the right answer path is chosen. (AC-F06-1)
- As a developer, I want asset ids like "SHF 301" and asset types (motor, centrifugal pump, shaft, centrifugal compressor, gearbox) resolved from my question, so that the query targets the right fleet slice. (AC-F06-2)
- As an engineer, I want to specify metrics and time windows like "last 10 minutes" in plain English, so that I get relevant data without writing filters. (AC-F06-3)
- As an operator, I want a 0–100 health score per asset that reflects nominal vs. severe deviation, so that I can quickly triage condition. (AC-F06-4)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F06-1 | Intent accuracy 100% on golden set | parseQuery intent classifier + golden-set eval |
| AC-F06-2 | Resolve asset ids ("SHF 301") and asset types | parseQuery asset/type resolver |
| AC-F06-3 | Extract metrics and time windows ("last 10 minutes") | parseQuery metric/window extractor |
| AC-F06-4 | Health 100 nominal, <50 severe deviation | healthScore |

## Contract
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`
- `healthScore(assetType, metrics)` → number (0–100)
- Intents: `condition`, `trend`, `anomalies`, `ranking`, `inventory`, `work_orders`, `car`

## Dependencies
- F02 (Streaming anomaly detection) — supplies deviation signals feeding healthScore.
- F03 (Automated work orders) — grounds `work_orders`/`car` intents.
- F05 (Spare-parts inventory tracking) — grounds `inventory` intent.

## Non-goals
Free-form SQL generation; write actions from chat.

## Risks
"Centrifugal" is ambiguous between pumps and compressors; the planner must disambiguate using surrounding context (e.g., "pump" vs. "compressor" qualifier) before matching asset type.

## Telemetry & evals
Behavioural eval: golden-set intent accuracy must equal 1.0 (AC-F06-1). No PII (names, technician identity) is ever logged with query telemetry; only asset ids and pseudonymous team ids per org privacy standard.

## Definition of done
- `edge/features/F06-nl-asset-query/index.js` exports `parseQuery` and `healthScore` matching the contract exactly.
- All AC-F06-1..4 pass in the executable acceptance suite.
- Golden-set intent accuracy = 100%.
- Ambiguous "centrifugal" cases resolved correctly per risk note.
