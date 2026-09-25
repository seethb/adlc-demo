# F01 · IoT telemetry simulator — Design

## Module structure
`edge/features/F01-iot-simulator/index.js` (pure ESM, no I/O, no network).

Internal state (closure per `createSimulator` instance):
- `rng` — seeded PRNG (mulberry32-style) derived from `seed`; all randomness flows through it (AC-F01-2).
- `clockMs` — current simulated time, initialized from `startTs` (default epoch 0), advanced by `stepMs` (default 1000) each `tick()`.
- `fleet` — asset list from `edge/reference/fleet.js` (or injected `assets`), each `{ id, type, metrics: { [metric]: { mean, sigma } } }`.
- `faultState` — `Map<assetId, { fault, ticksSinceInject }>` tracking active faults and degradation progress.

Internal helpers:
- `gaussian(rng)` — Box-Muller sample using `rng`.
- `nominalReading(asset)` — samples each metric within N(mean, σ), clamps to 4.5σ (AC-F01-1, AC-F01-3).
- `applyFaultProfile(asset, fault, ticks, reading)` — mutates signature metrics per fault-type table, magnitude grows with `ticks` (AC-F01-4).
- `validateAsset(assetId)` / `validateFault(assetId, fault)` — throw `RangeError`/`TypeError` on unknown asset or inapplicable fault (AC-F01-5).
- `round3(x)` — rounds metric values to 3 decimals per org numeric standard.

## Contract
```js
createSimulator({ seed, assets?, startTs?, stepMs? }) => {
  tick(): Reading[],
  inject(assetId, fault): void,
  clear(assetId): void,
  activeFaults(): { [assetId]: string },
  assets
}
Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }
```
`tick()` advances `clockMs` by `stepMs`, then returns one `Reading` per asset in `fleet` order.

## AC → design mapping
| AC | Design element |
|---|---|
| AC-F01-1 | `tick()` iterates full `fleet`, calls `nominalReading` for every metric of that asset's type; `fault` field set from `faultState` or `null` |
| AC-F01-2 | Single seeded `rng` instance, no `Math.random`/`Date.now`; identical `seed`+params ⇒ identical byte-for-byte stream |
| AC-F01-3 | `nominalReading` clamps every sampled metric to ±4.5σ around `mean` before rounding |
| AC-F01-4 | `inject()` sets `faultState`; `applyFaultProfile` scales signature-metric deviation with `ticksSinceInject`; `clear()` deletes the entry, restoring nominal sampling next tick |
| AC-F01-5 | `validateAsset`/`validateFault` throw before mutating state; unknown `assetId` or fault not in that asset type's applicable-fault list is rejected |

## Security & data classification
- Output readings are **C2 Confidential** (raw telemetry) per org data classification — must stay in the edge 7-day ring buffer; this module itself performs no persistence or transport, leaving storage/egress to downstream features.
- The module is a **pure generator with no OT connection**: it never reads or writes PLC/OPC-UA/setpoints, satisfying read-only-towards-OT by construction (there is no OT link to violate).
- Input validation treats `createSimulator` args and `inject`/`clear` calls as untrusted: reject non-finite `stepMs`/`startTs`, unknown `assetId`, unknown/inapplicable `fault` names — all throw synchronously (AC-F01-5), matching the "treat telemetry as untrusted input" standard applied to configuration inputs here.
- No PII is ever generated or accepted; only pseudonymous `assetId`s appear, never operator names.
- No credentials, keys or transport are handled by this module (out of scope per spec); any future MQTT publisher wrapping this simulator must use mTLS 1.2+/8883 per org standard.

## Reused team decisions
- Data classification table (C0–C3) and edge-only residency rule for raw telemetry — reused verbatim to mark simulator output as C2, edge-resident.
- IoT security standard "read-only towards OT" and "untrusted input" rules — reused to justify no-OT-write guarantee and strict validation in `inject`/`clear`.
- Numeric rounding-to-3-decimals convention and pseudonymous-id-only rule — reused from org standards for the `Reading` shape.
