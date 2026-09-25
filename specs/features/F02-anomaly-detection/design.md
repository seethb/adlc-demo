# F02 · Streaming anomaly detection — Design

## Module structure (edge/features/F02-anomaly-detection/index.js)

Internal state (per `createDetector` instance, closed over — never module-level/global):
- `baselines: Map<assetId, Map<metric, { n, mean, m2, frozen, spread }>>` — Welford online stats, one entry per asset/metric.
- `warmupTicks` (opt, default 30) — ticks per asset before a baseline freezes its spread.
- `rejected: { count: 0, last: null }`.
- `tickCounts: Map<assetId, number>` — for warm-up gating.

Exported functions:
- `createDetector(opts?)` — builds closures above, returns `{ observe, rejected }`.
- `vibrationZone(mmS)` — pure function, ISO 10816-3 boundaries.
- `classify(metricNames)` — pure lookup from anomalous-metric-name sets → failure mode table (bearing, misalignment, surge, cavitation, oil, electrical).

Internal helpers (not exported): `isFiniteReading(reading)`, `updateBaseline(stats, value)`, `zScore(stats, value)`, `limitFor(assetType, metric)` (OEM limit table from `edge/reference/anomaly.js`), `severityFor(zone|z, limit)`, `makeAnomalyId()`.

## Contract signatures

```
createDetector(opts?: { warmupTicks?: number, zThreshold?: number })
  → { observe(reading: Reading): Anomaly[], rejected: { count: number, last: Reading|null } }

vibrationZone(mmS: number) → 'A' | 'B' | 'C' | 'D'

classify(metricNames: string[]) → { failureMode: string, confidence: number }

Anomaly = {
  id: string, ts: number, assetId: string, assetType: string,
  severity: 'low'|'medium'|'high'|'critical', score: number, rule: string,
  failureMode: string, confidence: number,
  metrics: [{ metric: string, value: number, z: number, severity: string, rule: string, limit: number }]
}
```
`observe` returns an array of length 0 or 1 (contract cap).

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F02-1 | Baseline spread freezes after `warmupTicks`; z-threshold tuned so healthy-fleet FP rate <1% |
| AC-F02-2 | `vibrationZone`: A≤2.8, B≤4.5, C≤7.1, D>7.1 mm/s RMS |
| AC-F02-3 | `observe` scores every reading per-asset against its own frozen baseline; fault-injection eval checks 30-tick detection window and no cross-asset leakage |
| AC-F02-4 | `classify` maps the anomalous-metric-name set to a `failureMode` + `confidence`; used to populate `Anomaly.failureMode` |
| AC-F02-5 | Anomaly builder always emits the full contract shape; `severityFor` forces `critical` when `vibrationZone === 'D'` |
| AC-F02-6 | `isFiniteReading` runs before any baseline update or scoring; failures increment `rejected.count`, set `rejected.last`, and are never passed to `updateBaseline` |

## Security & data classification
- Data handled: raw vibration/temperature/pressure telemetry and derived anomaly events — classification **C2** (per Meko datapack). Raw 1 Hz readings never leave the edge; only anomaly events (this module's output) may cross to cloud, over MQTT/mTLS QoS 1, per the shared edge/cloud residency table.
- The module is strictly **read-only towards OT**: it only consumes `Reading` objects produced upstream (F01/gateway ingest); it never writes PLC registers, coils, or OPC-UA setpoints, and holds no OT-write API surface.
- Input validation: every reading passes `isFiniteReading` (rejects NaN/Infinity/non-number fields) before it can touch a baseline or produce a score, per the IoT untrusted-telemetry standard. Unknown `assetId`/`metric` combinations are dropped, not scored, and counted as rejected.
- No PII: anomalies carry only pseudonymous `assetId`/`assetType`, never operator/technician identifiers.

## Reused team decisions
- Reused the org IoT security standard: treat telemetry as untrusted, reject non-finite values, and enforce edge read-only towards OT (both cited verbatim from Meko `org · security-standard` entries).
- Reused the data-classification/residency table (Meko "Security design" doc): anomaly events are C2, edge-sourced, sent to cloud only via MQTT/mTLS QoS 1; raw telemetry stays edge-only.
- Reused the frozen-baseline architecture decision recorded against F02 risks (baseline spread freezes after warm-up to avoid drift absorption).
- Followed F01's precedent (Vega/Sentinel) of documenting exact module structure, internal state, and contract shapes before implementation.
