# F01 · IoT telemetry simulator — Plan

## Summary
`createSimulator` produces a deterministic, seedable stream of per-asset telemetry readings for the eight fleet assets, with injectable fault scenarios that progressively degrade signature metrics. It underpins F02 (anomaly detection), F03 (work orders), and downstream features that need realistic data before a real plant is connected.

## User stories
- As a data scientist (TM-04), I want each tick to emit one reading per asset with all nominal metrics so I can build detection pipelines against realistic shapes. (AC-F01-1)
- As a QA engineer, I want the same seed to reproduce an identical stream so tests are reliable. (AC-F01-2)
- As a reliability engineer, I want healthy readings bounded within 4.5σ of nominal so false positives stay low. (AC-F01-3)
- As a maintenance analyst, I want to inject a fault and see its signature metrics progressively degrade, and clear it to restore health, so I can validate fault-response workflows. (AC-F01-4)
- As an integrator, I want invalid asset ids or mismatched faults to throw immediately so bugs surface early. (AC-F01-5)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F01-1 | One reading per asset per tick, all nominal metrics, `fault:null` when healthy | `tick()` |
| AC-F01-2 | Same seed → identical stream | seeded PRNG in `createSimulator` |
| AC-F01-3 | Healthy readings within 4.5σ of nominal | noise generator bound |
| AC-F01-4 | Injected fault progressively degrades signature metrics; `clear` restores health | `inject`/`clear` |
| AC-F01-5 | Unknown assets / inapplicable faults throw | validation in `inject`/`tick` |

## Contract
Exports: `createSimulator`.
```
createSimulator({ seed, assets?, startTs?, stepMs? }) ->
  { tick(): Reading[], inject(assetId, fault), clear(assetId), activeFaults(), assets }
Reading = { ts: ISO-8601, assetId, type, metrics: {[metric]: number}, fault: string|null }
```

## Dependencies
None.

## Non-goals
No physics modeling; no MQTT/OPC-UA transport.

## Risks
Noise calibration: too low makes anomalies trivial to detect, too high causes false positives. σ bands owned by reliability team ("nominal operating bands").

## Telemetry & evals
Behavioural eval: 200-tick replay stays within the 4.5σ band on every metric for all healthy assets. Timestamps are ISO-8601 UTC; numeric metrics rounded to 3 decimals per org standard.

## Definition of done
All 5 ACs pass in the executable acceptance suite (`implementations('F01-iot-simulator', 'simulator.js')`), module lives at `edge/features/F01-iot-simulator/index.js`, exports match contract exactly, and the 200-tick eval passes.
