---
id: F02
slug: F02-anomaly-detection
title: Streaming anomaly detection
owner: lyra
priority: must
depends: [F01]
module: edge/features/F02-anomaly-detection/index.js
reference: edge/reference/anomaly.js
exports: createDetector, vibrationZone, classify
---

# F02 · Streaming anomaly detection

## Problem
Operators miss slow degradation until a trip. The edge must flag abnormal behaviour per
reading, say how bad it is, and name the likely failure mode, without cloud round-trips.

## Scope
- A per-asset, per-metric statistical baseline learnt during warm-up.
- Engineering limits: ISO 10816-3 vibration zones and OEM limits (bearing temp,
  winding temp, surge margin, suction pressure, misalignment, orbit, oil).
- Failure-mode classification from the set of anomalous metrics.

**Non-goals:** spectral analysis, model training in the cloud.

## Contract
`createDetector(opts?)` → `{ observe(reading): Anomaly[], rejected: { count, last } }` (0 or 1 anomaly per reading),
`vibrationZone(mmS)` → `'A'|'B'|'C'|'D'`, `classify(metricNames)` → `{ failureMode, confidence }`.

```
Anomaly = { id, ts, assetId, assetType, severity: low|medium|high|critical,
            score, rule, failureMode, confidence, metrics: [{ metric, value, z, severity, rule, limit }] }
```

## Acceptance criteria
- **AC-F02-1** False-positive rate on a healthy fleet after warm-up is below 1 %.
- **AC-F02-2** ISO 10816 zones: A ≤ 2.8 < B ≤ 4.5 < C ≤ 7.1 < D (mm/s RMS).
- **AC-F02-3** Each injected fault is detected on the right asset within 30 ticks, with no anomalies on healthy assets.
- **AC-F02-4** ≥ 60 % of anomalies during a fault carry the matching failure mode.
- **AC-F02-5** Anomalies have the contract shape; zone-D vibration is `critical`.
- **AC-F02-6** Readings with non-finite values (NaN, Infinity, non-numbers) are rejected and counted in `rejected.count`, never scored, and never corrupt a baseline (IoT security: telemetry is untrusted input).

## Telemetry & evals
Behavioural eval: precision ≥ 0.9 and recall ≥ 0.9 over a labelled 6-fault simulation.

## Risks
Baselines that keep learning absorb slow drift — the baseline must freeze its spread
after warm-up (architecture decision recorded in Meko).
