# F06 · Natural-language asset queries — Plan

## Summary
A deterministic NL query planner (`parseQuery`) resolves intent, asset ids/types, metrics, and time windows from developer/engineer text, and a `healthScore` function scores asset condition 0–100. This grounds Claude's Studio answers in the correct live-state slice without free-form SQL or write actions.

## User stories
- As a reliability engineer, I want to ask about an asset by id or type in plain language so that I get grounded answers without writing queries. (AC-F06-1, AC-F06-2)
- As a developer, I want asset ids like "SHF 301" and types like "centrifugal pump" resolved correctly so that queries hit the right assets. (AC-F06-2)
- As a user, I want to specify time windows ("last 10 minutes") and metrics in my question so that the answer reflects the right data slice. (AC-F06-3)
- As a reliability engineer, I want a numeric health score per asset so that I can quickly judge nominal vs. severe deviation. (AC-F06-4)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F06-1 | Intent accuracy on golden set = 100% | `parseQuery` intent classification, golden-set eval |
| AC-F06-2 | Asset ids ("SHF 301") and types resolved | `parseQuery` asset/type resolver |
| AC-F06-3 | Metrics and time windows extracted | `parseQuery` metric/window extractor |
| AC-F06-4 | Health 100 nominal, <50 severe deviation | `healthScore` |

## Contract
`edge/features/F06-nl-asset-query/index.js` exports:
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`. Intents: `condition`, `trend`, `anomalies`, `ranking`, `inventory`, `work_orders`, `car`.
- `healthScore(assetType, metrics)` → number 0–100.

## Dependencies
- F02 (Streaming anomaly detection): supplies live metrics/anomaly state used to resolve and score assets.
- F03 (Automated work orders): supplies work-order data for `work_orders` intent.
- F05 (Spare-parts inventory tracking): supplies inventory data for `inventory` intent.

## Non-goals
Free-form SQL generation; write actions triggered from chat.

## Risks
"Centrifugal" is ambiguous between pump and compressor; the planner must use surrounding words to disambiguate asset type, falling back to both types with lower confidence if unresolved.

## Telemetry & evals
Behavioural eval: golden-set intent accuracy must equal 1.0 (AC-F06-1). Track parse failures and disambiguation fallbacks as counters for ongoing regression detection. Answers never include operator/technician names, only asset ids.

## Definition of done
All AC-F06-1..4 pass via executable acceptance suite; `parseQuery` and `healthScore` exported with the exact contract shapes; golden-set eval at 100% intent accuracy; disambiguation logic for "centrifugal" documented and tested; module integrates with F02/F03/F05 data without duplicating their logic.
