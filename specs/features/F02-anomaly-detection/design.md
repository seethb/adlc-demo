# F02 · Streaming anomaly detection — Design

## Module structure (`edge/features/F02-anomaly-detection/index.js`)

Exported:
- `createDetector(opts?)`
- `vibrationZone(mmS)`
- `classify(metricNames)`

Internal helpers:
- `isFiniteNumber(v)` — strict numeric validation.
- `validateReading(reading)` → `{ ok, reason }`, used by `observe` before any baseline touch.
- `updateBaseline(state, assetId, metric, value)` — Welford online mean/variance; frozen once `warmupTicks` reached.
- `zScore(baseline, value)` — `(value - mean) / max(spread, epsilon)`.
- `limitSeverity(metric, value, assetType)` — checks OEM static limits (bearing/winding temp, surge margin, suction pressure, misalignment, orbit, oil) and vibration via `vibrationZone`.
- `combineSeverity(zSev, limitSev)` — takes the worse of statistical and engineering-limit severity.
- `buildAnomaly(reading, metricHits)` — assembles contract-shaped `Anomaly`, calls `classify`.
- `FAILURE_RULES` — table mapping metric-name sets/patterns to `{ failureMode, confidence }`.

Internal state (closure per `createDetector` instance):
- `baselines: Map<assetId, Map<metric, { n, mean, m2, frozen }>>`
- `warmupTicks` (opt, default 30)
- `rejected = { count: 0, last: null }`
- `seenKeys: Map<assetId, lastTs>` for monotonic/replay rejection.

## Contract signatures

```
createDetector(opts?: { warmupTicks?: number, zThreshold?: number })
  → { observe(reading: Reading): Anomaly[], rejected: { count: number, last: Reading|null } }

vibrationZone(mmS: number) → 'A' | 'B' | 'C' | 'D'

classify(metricNames: string[]) → { failureMode: string, confidence: number }

Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }

Anomaly = { id, ts, assetId, assetType, severity: 'low'|'medium'|'high'|'critical',
            score, rule, failureMode, confidence,
            metrics: [{ metric, value, z, severity, rule, limit }] }
```

`observe` returns 0 or 1 `Anomaly` per call; invalid readings are rejected (counted, never scored, never affect baselines) and return `[]`.

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F02-1 | Baseline freezes spread at `warmupTicks`; `zThreshold` tuned conservative; validated input only feeds baseline |
| AC-F02-2 | `vibrationZone` literal boundaries 2.8/4.5/7.1 mm/s RMS |
| AC-F02-3 | Per-asset `Map` isolates baselines; z-score computed every tick → detection within 30 ticks, no cross-asset leakage |
| AC-F02-4 | `classify` + `FAILURE_RULES` maps anomalous metric set → `failureMode`/`confidence` ≥60% of fault-window anomalies |
| AC-F02-5 | `buildAnomaly` fixed shape; `limitSeverity` forces `critical` when `vibrationZone === 'D'` |
| AC-F02-6 | `validateReading`/`isFiniteNumber` reject NaN/Infinity/non-number/unknown asset/replayed ts before baseline update; `rejected.count`/`last` updated |

## Security & data classification

- Handles **C2** telemetry and derived anomaly events (per org data-classification table). Raw readings never leave the edge gateway; only anomaly events may be published to cloud over MQTT/mTLS QoS 1.
- Module is strictly **read-only toward OT**: no exported function writes back to the simulator/device; `observe` only consumes `Reading` objects.
- Input validation (OWASP IoT I5): reject non-finite values, unknown asset ids, unknown metrics, and out-of-order/replayed `ts` (tracked via `seenKeys`) — all counted in `rejected`, none reach baseline state.
- No PII: anomalies reference `assetId`/`assetType` only, never operator/technician identity.

## Reused team decisions
- Baseline must freeze spread after warm-up (Meko architecture decision, risk mitigation for AC-F02-1).
- Telemetry is untrusted input: reject non-finite values, unknown asset/metric, drop replayed/out-of-order readings (org IoT security standard, OWASP I5).
- Anomaly events are C2 data, may leave the OT zone only via MQTT/mTLS QoS 1 (security data-classification table).
- Exports must be exactly `createDetector`, `vibrationZone`, `classify` with contract shapes as specified by lyra/sentinel memories.
