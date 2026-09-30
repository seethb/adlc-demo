# F02 · Streaming anomaly detection — Design

## Module structure (edge/features/F02-anomaly-detection/index.js)

Exports: `createDetector`, `vibrationZone`, `classify`.

Internal helpers (not exported):
- `isFiniteReading(reading)` — validates ts/assetId/type/metrics are finite numbers, rejects NaN/Infinity/non-numbers/unknown asset/unknown metric.
- `updateBaseline(state, assetId, metric, value)` — Welford-style running mean/variance, frozen after `warmupTicks` per asset (risk mitigation: no drift absorption post-warmup).
- `zScore(state, assetId, metric, value)` — `(value - mean) / max(stddev, epsilon)`.
- `limitCheck(metric, value)` — OEM/ISO 10816-3 limit lookup, returns severity + rule id.
- `severityOf(zscore, limitSeverity)` — combines statistical + engineering severity, max wins.
- `makeAnomaly(reading, metricHits)` — assembles contract-shaped `Anomaly`, calls `classify`.

Internal state (closed over per `createDetector()` instance):
- `baselines: Map<assetId, Map<metric, { n, mean, m2, frozen }>>`
- `tickCounts: Map<assetId, number>` — for warm-up gating.
- `seen: Map<assetId, lastTs>` — replay/out-of-order guard.
- `rejected: { count: number, last: any }`.
- `opts` — `{ warmupTicks = 30, zThreshold = 3 }`.

## Contract signatures

```
createDetector(opts?: { warmupTicks?: number, zThreshold?: number })
  → { observe(reading: Reading): Anomaly[], rejected: { count: number, last: Reading|null } }

vibrationZone(mmS: number) → 'A' | 'B' | 'C' | 'D'
  // A ≤2.8 < B ≤4.5 < C ≤7.1 < D, per ISO 10816-3 (AC-F02-2)

classify(metricNames: string[]) → { failureMode: string, confidence: number }
  // maps co-occurring anomalous metric sets to known failure modes (bearing, misalignment, surge, etc.)

Anomaly = { id, ts, assetId, assetType, severity: 'low'|'medium'|'high'|'critical',
            score, rule, failureMode, confidence,
            metrics: [{ metric, value, z, severity, rule, limit }] }
```

`observe` returns `[]` or `[Anomaly]` — never more than one per reading.

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F02-1 | Baseline frozen post-warmup; `zThreshold` tuned so stable metrics rarely cross threshold |
| AC-F02-2 | `vibrationZone` pure function with exact boundary constants |
| AC-F02-3 | `updateBaseline`+`zScore` detect deviation per asset independently; `tickCounts` bounds detection latency |
| AC-F02-4 | `classify` keyed on metric-name sets from labelled fault signatures |
| AC-F02-5 | `makeAnomaly` enforces exact shape; `severityOf` forces `critical` when `vibrationZone==='D'` |
| AC-F02-6 | `isFiniteReading` runs first in `observe`; on failure increments `rejected.count`, sets `rejected.last`, returns `[]` without touching `baselines` |

## Security & data classification
- Handles **C2** telemetry (per-asset metrics) and derived anomaly events — both classified C2, no PII, asset ids only (no operator/technician names).
- Raw readings never leave the edge; only `Anomaly` events are eligible to cross to cloud, over MQTT/mTLS (existing transport), QoS 1.
- Module is strictly **read-only toward OT**: it only consumes `Reading` objects, never writes/commands back to devices.
- All inputs validated at `observe()` entry: reject non-finite values, unknown assetId, unknown metric name, and out-of-order/replayed `ts` (per-asset `seen` map) — rejects counted, never scored, never mutate baseline.

## Reused team decisions
- Baseline freezes spread after warm-up (Meko architecture decision) to avoid drift absorption.
- Contract shapes for `createDetector`/`vibrationZone`/`classify`/`Anomaly` taken verbatim from feature spec and plan.
- Telemetry treated as untrusted input per IoT security standard: reject non-finite/unknown ids/metrics, drop replayed/out-of-order readings.
- Data classification table: raw telemetry stays edge-only; only anomaly events (C2) leave OT zone via MQTT/mTLS.
