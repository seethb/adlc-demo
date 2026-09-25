# F01 · IoT telemetry simulator — Plan

## Summary
`createSimulator` produces a seeded, repeatable stream of per-asset telemetry readings for the eight reference fleet assets, with support for injecting and clearing fault scenarios that progressively degrade signature metrics. It is the foundation feed for all downstream analytics, maintenance and query features.

## User stories
- As an analytics developer, I want a deterministic seeded stream so that I can write reproducible tests. (AC-F01-2)
- As a maintenance-ML developer, I want each tick to emit a full, well-formed reading per asset so that downstream pipelines can rely on shape and nominal-value coverage. (AC-F01-1)
- As a reliability engineer, I want healthy readings bounded to 4.5σ so that noise doesn't produce false fault detections. (AC-F01-3)
- As a maintenance-ML developer, I want to inject and clear faults so that I can validate detection and recovery logic against progressive degradation. (AC-F01-4)
- As an integrator, I want invalid asset ids or mismatched faults to throw so that misuse is caught early. (AC-F01-5)

## Acceptance criteria traceability
| AC | Story | Notes |
|---|---|---|
| AC-F01-1 | tick emits full readings | fault=null when healthy |
| AC-F01-2 | seeded reproducibility | same seed ⇒ identical stream |
| AC-F01-3 | bounded healthy noise | 4.5σ band, all metrics |
| AC-F01-4 | inject/clear fault | progressive degradation + label |
| AC-F01-5 | validation | unknown asset/fault ⇒ throw |

## Contract
```
createSimulator({ seed, assets?, startTs?, stepMs? }) => {
  tick(): Reading[],
  inject(assetId, fault): void,
  clear(assetId): void,
  activeFaults(): { [assetId]: string },
  assets
}
Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }
```
Timestamps are ISO-8601 UTC; numeric metrics rounded to 3 decimals per org standard. Each AC-implementing function must carry `// AC-F01-x` comments.

## Dependencies
None.

## Non-goals
No physics modelling; no MQTT/OPC-UA transport; no persistence.

## Risks
Noise calibration is a trade-off: too low makes faults trivially detectable, too high causes false positives on healthy readings. σ values owned by reliability team ("nominal operating bands").

## Telemetry & evals
Behavioural eval: run 200 ticks healthy and assert every metric stays within 4.5σ (AC-F01-3). Regression eval: fixed seed replay diffed byte-for-byte against golden fixture (AC-F01-2). Fault eval: inject each of the 7 fault types on a valid asset, assert progressive degradation of signature metrics over N ticks and correct label (AC-F01-4); assert clear() restores nominal band within tolerance.

## Definition of done
All 5 ACs covered by tests owned by QA (immutable, feature agents do not edit them); simulator rejects unknown asset ids and inapplicable faults by throwing (AC-F01-5); module exports match contract exactly; no PII/OT-untrusted-input violations (treat inputs as untrusted per IoT security standard — reject non-finite metric values internally); code reviewed and merged into `edge/features/F01-iot-simulator/index.js`.
