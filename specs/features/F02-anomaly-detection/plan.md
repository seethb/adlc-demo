# F02 · Streaming anomaly detection — Plan

## Summary
Per-asset, per-metric streaming detector that learns a baseline during warm-up, scores incoming readings against ISO 10816 vibration zones and OEM limits, and classifies anomalies into likely failure modes — all on-edge, no cloud round-trip.

## User stories
- As an operator, I want false alarms kept rare after warm-up so I trust the alerts. (AC-F02-1)
- As an operator, I want vibration severity graded by ISO 10816 zones so I know urgency. (AC-F02-2, AC-F02-5)
- As an operator, I want faults caught quickly on the right asset so I can act before trip. (AC-F02-3)
- As a technician, I want anomalies tagged with a failure mode so I know what to inspect. (AC-F02-4)
- As a platform engineer, I want malformed telemetry rejected safely so bad sensors can't poison baselines. (AC-F02-6)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F02-1 | FP rate < 1% post warm-up | baseline freeze + z-score thresholding |
| AC-F02-2 | ISO 10816 zone boundaries | `vibrationZone` |
| AC-F02-3 | Fault detected ≤30 ticks, right asset only | per-asset baseline + scoring loop |
| AC-F02-4 | ≥60% anomalies carry matching failure mode | `classify` |
| AC-F02-5 | Anomaly contract shape; zone D → `critical` | `observe` output + `vibrationZone` |
| AC-F02-6 | Non-finite readings rejected, counted, never corrupt baseline | input validation in `observe` |

## Contract
- `createDetector(opts?)` → `{ observe(reading): Anomaly[], rejected: { count, last } }`
- `vibrationZone(mmS)` → `'A'|'B'|'C'|'D'`
- `classify(metricNames)` → `{ failureMode, confidence }`
- `Anomaly = { id, ts, assetId, assetType, severity, score, rule, failureMode, confidence, metrics: [{ metric, value, z, severity, rule, limit }] }`

## Dependencies
F01 (`createSimulator`) supplies `Reading = { ts, assetId, type, metrics, fault }` streams for testing and evals.

## Non-goals
Spectral analysis; cloud-side model training; multi-tick smoothing windows beyond the 30-tick detection budget.

## Risks
Continuously-learning baselines absorb drift as "normal," masking slow degradation — mitigated by freezing spread after warm-up (recorded architecture decision).

## Telemetry & evals
Behavioural eval: precision ≥ 0.9 and recall ≥ 0.9 over a labelled 6-fault simulation (observed: precision 0.99, recall 1.00 per Sentinel's Oct 13 2026 report, 6/6 AC tests passing).

## Definition of done
All 6 ACs pass in the executable acceptance suite; behavioural eval meets precision/recall targets; `rejected.count` verified non-zero under malformed-input fuzzing with zero baseline corruption; module exports exactly `createDetector`, `vibrationZone`, `classify` from `edge/features/F02-anomaly-detection/index.js`.
