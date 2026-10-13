# F02 · Streaming anomaly detection — Plan

## Summary
Detect per-reading anomalies on edge from a per-asset, per-metric baseline plus ISO 10816-3 vibration zones and OEM limits, and classify a likely failure mode from the anomalous metric set, entirely on-device with no cloud round-trip.

## User stories
- As an operator, I want early warning of slow degradation so that I can act before a trip. (AC-F02-1, AC-F02-3)
- As an operator, I want vibration severity graded to a recognized standard so that I trust the alarm level. (AC-F02-2, AC-F02-5)
- As a technician, I want the likely failure mode named so that I diagnose faster. (AC-F02-4)
- As a platform engineer, I want malformed telemetry rejected safely so that bad sensors can't poison baselines or trigger false alarms. (AC-F02-6)

## Acceptance criteria traceability

| AC | Description | Verified by |
|---|---|---|
| AC-F02-1 | FP rate < 1% post-warm-up | healthy-fleet simulation eval |
| AC-F02-2 | ISO 10816 zone boundaries | `vibrationZone` unit tests |
| AC-F02-3 | Fault detected on right asset ≤30 ticks, no false alarms | injected-fault simulation |
| AC-F02-4 | ≥60% anomalies carry matching failure mode | `classify` labelled eval |
| AC-F02-5 | Anomaly contract shape; zone D → `critical` | schema + severity tests |
| AC-F02-6 | Non-finite readings rejected, counted, baseline untouched | fuzz/adversarial input tests |

## Contract
- `createDetector(opts?)` → `{ observe(reading): Anomaly[], rejected: { count, last } }`; observe emits 0 or 1 anomaly per reading.
- `vibrationZone(mmS)` → `'A'|'B'|'C'|'D'` per AC-F02-2 boundaries.
- `classify(metricNames)` → `{ failureMode, confidence }`.
- `Anomaly = { id, ts, assetId, assetType, severity, score, rule, failureMode, confidence, metrics: [{ metric, value, z, severity, rule, limit }] }`.

## Dependencies
F01 `createSimulator` supplies `Reading = { ts, assetId, type, metrics, fault }` via `tick()`/`inject()`, consumed by `observe(reading)`.

## Non-goals
Spectral analysis; cloud-side model training; multi-reading batching (one anomaly max per reading).

## Risks
Baselines must freeze spread after warm-up — a continuously-learning baseline absorbs slow drift and masks real faults (architecture decision recorded in Meko).

## Telemetry & evals
Behavioural eval: precision ≥ 0.9 and recall ≥ 0.9 over a labelled 6-fault simulation, plus explicit FP-rate and fault-detection-latency (≤30 ticks) checks.

## Definition of done
All AC-F02-1..6 pass in the executable acceptance suite; `edge/features/F02-anomaly-detection/index.js` exports exactly `createDetector`, `vibrationZone`, `classify`; non-finite inputs never mutate baseline state or reach scoring; module treats telemetry as untrusted input (read-only toward OT, no PII).
