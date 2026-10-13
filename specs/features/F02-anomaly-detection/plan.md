# F02 · Streaming anomaly detection — Plan

## Summary
Edge-resident detector that learns a per-asset, per-metric baseline during warm-up, flags anomalies per reading against ISO 10816 vibration zones and OEM limits, classifies likely failure mode, and rejects untrusted non-finite readings without corrupting baselines.

## User stories
- As a reliability engineer, I want the detector to stay quiet on a healthy fleet after warm-up, so that I trust alerts. (AC-F02-1)
- As a vibration analyst, I want standard ISO 10816 zone boundaries applied, so that severity matches plant convention. (AC-F02-2)
- As an operator, I want injected faults caught quickly on the right asset only, so that I can act before trip. (AC-F02-3)
- As a technician, I want anomalies tagged with a likely failure mode, so that I know what to inspect. (AC-F02-4)
- As a downstream consumer, I want a stable anomaly shape with correct critical severity, so that UIs and automations can rely on it. (AC-F02-5)
- As a security-conscious operator, I want malformed telemetry rejected and counted, never silently scored or absorbed into baselines, so that the system resists bad/untrusted input. (AC-F02-6)

## Acceptance criteria traceability
| AC | Covered by |
|---|---|
| AC-F02-1 | Baseline freeze after warm-up, low-noise scoring |
| AC-F02-2 | `vibrationZone` boundaries A/B/C/D |
| AC-F02-3 | Per-asset/per-metric z-score detection, ≤30-tick latency |
| AC-F02-4 | `classify` mapping anomalous metric sets to failure modes |
| AC-F02-5 | `Anomaly` shape, zone-D → `critical` |
| AC-F02-6 | Input validation in `observe`, `rejected.count`/`last` |

## Contract
- `createDetector(opts?)` → `{ observe(reading): Anomaly[], rejected: { count, last } }`
- `vibrationZone(mmS)` → `'A'|'B'|'C'|'D'`
- `classify(metricNames)` → `{ failureMode, confidence }`
- `Anomaly = { id, ts, assetId, assetType, severity, score, rule, failureMode, confidence, metrics: [{ metric, value, z, severity, rule, limit }] }`

## Dependencies
F01 `createSimulator` provides `Reading = { ts, assetId, type, metrics, fault }` fed into `observe`.

## Non-goals
Spectral analysis; cloud-side model training.

## Risks
Ever-learning baselines absorb slow drift; mitigated by freezing spread after warm-up (architecture decision recorded in Meko). Non-finite inputs could poison baselines if validation is skipped; mitigated by rejecting before any baseline update.

## Telemetry & evals
Behavioural eval: precision ≥ 0.9, recall ≥ 0.9 over labelled 6-fault simulation; track false-positive rate on healthy fleet (<1%), detection latency (≤30 ticks), and `rejected.count` on fuzzed non-finite inputs.

## Definition of done
All AC-F02-1..6 pass in executable acceptance suite; `edge/features/F02-anomaly-detection/index.js` exports `createDetector`, `vibrationZone`, `classify` matching contract; eval thresholds met; no baseline corruption observed under rejected-input fuzzing.
