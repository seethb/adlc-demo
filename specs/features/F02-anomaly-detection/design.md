# F02 · Streaming anomaly detection — Design

## Module structure (`edge/features/F02-anomaly-detection/index.js`)

**Exports:** `createDetector`, `vibrationZone`, `classify`

**Internal helpers (not exported):**
- `isFiniteNumber(v)` — strict numeric guard (`typeof v === 'number' && Number.isFinite(v)`).
- `isoZone(mmS)` — boundary lookup backing `vibrationZone`.
- `limitFor(assetType, metric)` — OEM limit table lookup (bearing temp, winding temp, surge margin, suction pressure, misalignment, orbit, oil).
- `zScore(baseline, metric, value)` — `(value - mean) / stdev`, guarded against `stdev === 0`.
- `severityFor(metric, z, zone, limit)` — maps z-score / zone / OEM limit breach to `low|medium|high|critical`; zone `D` forces `critical`.
- `updateBaseline(baseline, metric, value)` — Welford online mean/variance during warm-up only; frozen after `opts.warmupTicks`.
- `failureModeTable` — static map of metric-name-sets → `{ failureMode, weight }`, used by `classify`.

**Internal state (per detector instance, closed over in `createDetector`):**
- `baselines: Map<assetId, Map<metric, { mean, m2, count, frozen }>>`
- `warmupTicks` (default 30), `zThreshold` (default 3.0)
- `rejected = { count: 0, last: null }`

## Contract signatures

```js
createDetector(opts?: {
  warmupTicks?: number,   // default 30
  zThreshold?: number     // default 3.0
}) => {
  observe(reading: Reading) => Anomaly[],   // 0 or 1 element
  rejected: { count: number, last: Reading|null }
}

vibrationZone(mmS: number) => 'A' | 'B' | 'C' | 'D'

classify(metricNames: string[]) => { failureMode: string, confidence: number }
```

`Reading` matches F01's shape: `{ ts, assetId, type, metrics: {...}, fault }`.
`Anomaly` matches the feature contract exactly (id, ts, assetId, assetType, severity, score, rule, failureMode, confidence, metrics[]).

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F02-1 | `updateBaseline` freezes spread after `warmupTicks`; z-threshold tuned so post-warm-up FP rate < 1%. |
| AC-F02-2 | `vibrationZone` / `isoZone` pure function with hardcoded ISO 10816-3 boundaries (2.8/4.5/7.1). |
| AC-F02-3 | Per-`assetId` baseline map isolates scoring; `observe` scores only the reading's own asset, bounding detection to the tick it crosses threshold (≤30 ticks given warm-up window). |
| AC-F02-4 | `classify(metricNames)` maps anomalous metric sets to `failureModeTable`, attached to each `Anomaly.failureMode/confidence`. |
| AC-F02-5 | `observe` assembles `Anomaly` in exact contract shape; `severityFor` forces `critical` when `vibrationZone === 'D'`. |
| AC-F02-6 | `isFiniteNumber` validates every metric value before baseline update or scoring; failures increment `rejected.count`, set `rejected.last`, and `updateBaseline` is skipped entirely for that reading. |

## Security & data classification
- Handles **C2** telemetry-derived data (raw metrics in, anomaly events out), per the recalled Edge/Cloud residency table. Raw per-reading metrics stay in-process/edge memory only (never persisted beyond the detector's own baseline state); only resulting `Anomaly` events are eligible to leave the OT zone, and only over MQTT/mTLS QoS 1 (handled by a downstream module, not this one).
- This module performs **no writes or commands toward OT** — it only reads `Reading` objects passed in; `observe` has no side channel back to simulators/devices. Strictly read-only toward OT.
- **Input validation:** every metric value is checked with `isFiniteNumber` before use; non-finite or non-numeric values cause the whole reading to be rejected and counted, never partially scored, and never folded into `updateBaseline` (prevents baseline poisoning from untrusted telemetry, AC-F02-6).
- No PII is ever present in `Reading`/`Anomaly` shapes (asset ids only, per org privacy standard).

## Reused team decisions
- Baseline freeze-after-warm-up architecture decision (Meko risk note) is implemented via the `frozen` flag in `updateBaseline`.
- Exact `Anomaly` and function signatures reused verbatim from the recalled F02 contract memory.
- Data classification/residency table (C2, edge-sourced, MQTT/mTLS egress) reused from the recalled security design memory.
- F01's `Reading` shape reused unchanged as `observe`'s input type.
