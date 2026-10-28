# F01 · IoT telemetry simulator — Plan

## Summary
A seeded, deterministic telemetry simulator for the eight reference fleet assets, emitting one reading per asset per `tick()`, with injectable fault scenarios that progressively degrade signature metrics. Provides the baseline data stream consumed by F02 and downstream features.

## User stories
- As an analytics developer, I want `tick()` to emit a full reading per asset with all nominal metrics so that I can build detection logic against realistic data. (AC-F01-1)
- As a test author, I want identical streams from the same seed so that I can write deterministic assertions. (AC-F01-2)
- As a reliability engineer, I want healthy noise bounded to 4.5σ so that false positives stay controlled. (AC-F01-3)
- As a maintenance engineer, I want to inject and clear faults so that I can validate detection and work-order flows against degrading signatures. (AC-F01-4)
- As an integrator, I want invalid asset/fault combinations to throw so that bugs surface early. (AC-F01-5)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F01-1 | One reading/asset/tick, all nominal metrics, `fault:null` healthy | `tick()` |
| AC-F01-2 | Same seed → identical stream | seeded RNG in `createSimulator` |
| AC-F01-3 | Healthy readings within 4.5σ | noise generator |
| AC-F01-4 | Injected fault progressively degrades signature metrics, `clear` restores | `inject`/`clear` |
| AC-F01-5 | Unknown asset/invalid fault throws | validation in `inject`/`clear` |

## Contract
Exports: `createSimulator`

```
createSimulator({ seed, assets?, startTs?, stepMs? }) => {
  tick(): Reading[],
  inject(assetId, fault): void,
  clear(assetId): void,
  activeFaults(): { [assetId]: string },
  assets: Asset[]
}
Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }
```

## Dependencies
None.

## Non-goals
No physics-based modeling. No MQTT/OPC-UA transport; the edge bus is out of scope.

## Risks
Noise calibration tradeoff: too low makes fault detection trivial, too high creates false positives. σ values owned by the reliability team ("nominal operating bands").

## Telemetry & evals
Behavioural eval: 200-tick replay must stay within the 4.5σ band on every metric for healthy assets (AC-F01-3). Fault injection eval verifies progressive degradation and restoration on `clear` (AC-F01-4).

## Definition of done
- All five ACs covered by passing acceptance tests using `FLEET`/`ASSET_TYPES` from `edge/reference/fleet.js`.
- `createSimulator` exported from `edge/features/F01-iot-simulator/index.js`.
- Numeric metrics rounded to 3 decimals; timestamps ISO-8601 UTC, per org standard.
- No PII/operator names in readings or logs — asset ids only.
