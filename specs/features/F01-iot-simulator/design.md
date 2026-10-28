# F01 · IoT telemetry simulator — Design

## Module structure (`edge/features/F01-iot-simulator/index.js`)

**Exports:** `createSimulator(opts)`

**Internal helpers (not exported):**
- `makeRng(seed)` — mulberry32-style deterministic PRNG, returns `next(): number in [0,1)`.
- `gaussian(rng, mu, sigma)` — Box-Muller transform using `rng`, clamped to ±4.5σ for healthy readings (AC-F01-3).
- `applyFaultDrift(metricValue, fault, metric, elapsedTicks, assetType)` — progressive degradation curve (monotonic drift scaled by `elapsedTicks` since injection) for signature metrics defined per fault in `edge/reference/simulator.js`.
- `validateAsset(assetId)` / `validateFault(assetId, fault)` — throw `Error` on unknown asset id or fault not applicable to the asset's type (AC-F01-5).
- `round3(n)` — rounds metrics to 3 decimals per org numeric standard.

**Internal state (closed over per simulator instance):**
- `rng` — seeded PRNG instance (AC-F01-2).
- `clock` — `{ ts: number }` current simulated time, advanced by `stepMs` each `tick()`.
- `faults` — `Map<assetId, { fault, startedTick }>`.
- `tickCount` — integer, incremented each `tick()`.
- `assets` — frozen array sourced from `edge/reference/fleet.js` (or injected `opts.assets`), never mutated.

## Contract

```js
createSimulator({ seed, assets?, startTs?, stepMs? }) => {
  tick(): Reading[],
  inject(assetId, fault): void,
  clear(assetId): void,
  activeFaults(): { [assetId]: string },
  assets: Asset[]
}

Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }
```
`seed` required number; `assets` defaults to `FLEET`; `startTs` defaults to `Date.now()`; `stepMs` defaults to `1000`.

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F01-1 | `tick()` iterates `assets`, builds one `Reading` per asset with every nominal metric key from `ASSET_TYPES[type]`; `fault` field is `faults.get(assetId)?.fault ?? null`. |
| AC-F01-2 | Single `rng` seeded once in `createSimulator`; all randomness (noise, drift jitter) draws from it in asset-then-metric order — reproducible per seed. |
| AC-F01-3 | `gaussian` clamps output to `[mu-4.5σ, mu+4.5σ]`; σ per metric taken from fleet reference ("nominal operating bands"). |
| AC-F01-4 | `inject` records `startedTick`; `applyFaultDrift` scales signature-metric offset by elapsed ticks each `tick()`; `clear` deletes the map entry, restoring healthy generation next tick. |
| AC-F01-5 | `validateAsset`/`validateFault` throw synchronously inside `inject`/`clear` before mutating state. |

## Security & data classification
- Simulated readings are **Class C2 (Confidential)** — treated identically to real raw telemetry since downstream consumers (F02+) cannot distinguish origin.
- Per data-residency rule, raw per-tick readings must stay at the edge process/ring buffer; this module never sends data to cloud or persists beyond caller-held memory.
- The module is **read-only toward OT**: it only synthesizes data and never opens any connection to a real gateway, PLC, or OT network; no transport code is included (explicit non-goal).
- Input validation (OWASP IoT I5, applied even to synthetic input): `inject`/`clear` reject unknown `assetId` or a `fault` not in the asset type's signature set; all generated metric values are checked finite (no NaN/Infinity) before being returned, matching the org IoT security standard despite the absence of real network input.
- No operator/technician identifiers are ever included — `Reading` carries only `assetId` per the org privacy standard.

## Reused team decisions
- Data classification and edge/cloud residency rules reused from the org security design doc (C2 raw telemetry, edge-only).
- IoT security standard's untrusted-input validation (finite-value checks, unknown id/metric rejection) applied per sentinel's F01 review decision.
- Exact `Reading` shape and `createSimulator` contract reused verbatim from the feature spec and plan.
- Privacy standard (asset ids only, no operator names) applied to all emitted readings.
