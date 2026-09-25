# F02 · Streaming anomaly detection — Plan

## Summary
Edge-resident detector that learns a per-asset, per-metric baseline during warm-up, then scores each incoming reading against ISO 10816 vibration zones and OEM limits, emitting at most one anomaly per reading with a likely failure mode. No cloud round-trip; untrusted telemetry input must be sanitized before scoring.

## User stories
- As a plant operator, I want early warning of slow degradation so that I can act before a trip. (AC-F02-1, AC-F02-3)
- As a reliability engineer, I want vibration severity classified per ISO 10816 so that alerts match industry standards. (AC-F02-2, AC-F02-5)
- As a technician, I want anomalies tagged with a likely failure mode so that I can triage faster. (AC-F02-4)
- As an edge operator, I want malformed sensor readings safely rejected so that a compromised or faulty sensor can't poison baselines. (AC-F02-6)

## AC traceability
| AC | Covered by |
|---|---|
| AC-F02-1 | Baseline freeze after warm-up, z-score thresholds tuned on healthy fleet |
| AC-F02-2 | `vibrationZone` boundaries A/B/C/D |
| AC-F02-3 | `observe` per-tick scoring against per-asset baseline, fault injection test |
| AC-F02-4 | `classify` mapping anomalous-metric sets to failure modes |
| AC-F02-5 | Anomaly object shape validation; zone-D → severity `critical` |
| AC-F02-6 | Input validation in `observe` before baseline update/scoring |

## Contract
- `createDetector(opts?)` → `{ observe(reading): Anomaly[], rejected: { count, last } }`
- `vibrationZone(mmS)` → `'A'|'B'|'C'|'D'`
- `classify(metricNames)` → `{ failureMode, confidence }`
- `Anomaly = { id, ts, assetId, assetType, severity, score, rule, failureMode, confidence, metrics: [{ metric, value, z, severity, rule, limit }] }`

## Dependencies
F01 (telemetry reading shape and simulator output are the input to `observe`).

## Non-goals
Spectral analysis; cloud-side model training; multi-reading temporal smoothing beyond baseline warm-up.

## Risks
Baselines that keep learning absorb slow drift; mitigated by freezing spread after warm-up (Meko architecture decision). Non-finite/malformed input could corrupt baselines if not filtered pre-update.

## Telemetry & evals
Behavioural eval: precision ≥ 0.9, recall ≥ 0.9 on labelled 6-fault simulation. Track false-positive rate on healthy fleet (<1%, AC-F02-1) and rejected.count rate for malformed input (AC-F02-6). Anomalies logged with pseudonymous asset ids only, no operator/technician names.

## Definition of done
All AC-F02-1..6 pass under the QA acceptance suite; every function implementing an AC carries `// AC-F02-x` comment; module exports match contract exactly; no PII in logs; design doc and code reviewed against ISO 10816 zone boundaries and OEM limit table.
