# F01 · IoT telemetry simulator — Plan

## Summary
A seeded, deterministic telemetry simulator for the eight reference fleet assets, emitting one reading per asset per `tick()` with nominal metrics and optional injectable fault progression. It underpins all downstream analytics/maintenance/query features without a physics model or transport layer.

## User stories
- As a data scientist (TM-04), I want `tick()` to emit one complete reading per asset so I can build detectors against realistic batches. (AC-F01-1)
- As a QA engineer, I want identical seeds to reproduce identical streams so tests are deterministic. (AC-F01-2)
- As a reliability engineer, I want healthy readings bounded to 4.5σ so false positives stay low. (AC-F01-3)
- As a maintenance engineer, I want to inject and clear faults with progressive degradation and labeling so I can validate detection/response workflows. (AC-F01-4)
- As an integrator, I want invalid asset ids or mismatched faults to throw so errors surface early. (AC-F01-5)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F01-1 | One reading/asset/tick, all nominal metrics, fault null when healthy | `tick()` |
| AC-F01-2 | Same seed → identical stream | seeded RNG in `createSimulator` |
| AC-F01-3 | Healthy readings within 4.5σ | noise generator bound |
| AC-F01-4 | Fault injection progressively degrades + labels; `clear` restores | `inject`/`clear` |
| AC-F01-5 | Unknown asset/fault mismatch throws | input validation in `inject`/`tick` |

## Contract
Exports: `createSimulator`.

```
createSimulator({ seed, assets?, startTs?, stepMs? }) => {
  tick(): Reading[],
  inject(assetId, fault): void,
  clear(assetId): void,
  activeFaults(): { assetId, fault }[],
  assets: Asset[]
}
Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }
```
Timestamps ISO-8601 UTC; metrics rounded to 3 decimals per org standard.

## Dependencies
None.

## Non-goals
No physics model; no MQTT/OPC-UA transport (edge bus out of scope).

## Risks
Noise calibration: too low makes faults trivially detectable, too high causes false positives in healthy readings. σ values owned by reliability team ("nominal operating bands").

## Telemetry & evals
Behavioural eval: 200-tick replay must stay within the 4.5σ band on every metric for healthy assets. No operator/technician names in logs — asset ids and pseudonymous team ids only, per org privacy standard.

## Definition of done
- `edge/features/F01-iot-simulator/index.js` exports `createSimulator` matching the contract shape exactly.
- All AC-F01-1..5 covered by executable acceptance tests and passing.
- 200-tick eval replay passes 4.5σ bound check.
- No PII/operator names in any telemetry, logs, or fixtures.
