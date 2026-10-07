# F01 · IoT telemetry simulator — Design

## Module structure (edge/features/F01-iot-simulator/index.js)

Exports: `createSimulator(config)`.

Internal helpers (not exported):
- `mulberry32(seed)` — deterministic PRNG, source of all randomness (AC-F01-2).
- `gaussian(rng, mean, sigma)` — Box-Muller noise generator clamped to ±4.5σ (AC-F01-3).
- `applyFault(type, fault, metrics, age)` — mutates signature metrics progressively using `age` (ticks since injection); returns degraded metrics.
- `validateAssetId(assetId)` / `validateFault(type, fault)` — throw `RangeError` on unknown asset or fault/type mismatch (AC-F01-5).
- `round3(n)` — rounds metrics to 3 decimals per org numeric standard.
- `assertFinite(n)` — rejects NaN/Infinity per IoT security standard (OWASP IoT I5), used on every emitted metric before it leaves the module.

Internal state (closed over per simulator instance, never exported):
- `rng` — PRNG state seeded from `config.seed`.
- `clockTs` — current simulated timestamp, advanced by `stepMs` each `tick()`.
- `faults: Map<assetId, { fault, since }>` — active fault registry.
- `FLEET` — imported read-only reference from `edge/reference/fleet.js`; `config.assets` may override/subset it but is validated against the same type/metric schema.

## Contract signatures

```js
createSimulator({ seed: number, assets?: Asset[], startTs?: string, stepMs?: number })
  => {
    tick(): Reading[],
    inject(assetId: string, fault: string): void,
    clear(assetId: string): void,
    activeFaults(): { assetId: string, fault: string }[],
    assets: Asset[]
  }

Reading = {
  ts: string,        // ISO-8601 UTC
  assetId: string,
  type: string,
  metrics: { [metric: string]: number }, // finite, rounded to 3 decimals
  fault: string | null
}
```

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F01-1 | `tick()` iterates `assets` (= FLEET by default), emits exactly one `Reading` per asset with all nominal metrics from the reference definition; `fault` defaults to `null` via `faults.get(assetId)` lookup. |
| AC-F01-2 | `rng = mulberry32(seed)`; no other entropy source; same seed ⇒ identical draw sequence ⇒ identical stream. |
| AC-F01-3 | `gaussian()` noise is clamped/rejected beyond 4.5σ before being added to nominal metric means. |
| AC-F01-4 | `inject(assetId, fault)` validates via `validateFault`, stores `{fault, since: clockTs}`; `tick()` calls `applyFault` with `age = ticksSince(since)` to progressively degrade signature metrics and sets `fault` label; `clear(assetId)` deletes the map entry, restoring healthy generation next tick. |
| AC-F01-5 | `validateAssetId` throws for ids not in `assets`; `validateFault` throws when fault is not in the type's allowed fault list (e.g. cavitation on a motor). |

## Security & data classification

Per org data-classification table and `adlc:orion` decision: simulator output is **C2 Confidential** telemetry (equivalent to raw plant telemetry) and must remain **edge-resident only** — this module never sends data to cloud, Claude, or Meko; callers are responsible for keeping raw `Reading[]` inside the edge ring buffer. The module is **read-only towards OT**: it has no actuation API, no setpoint/write path, and no network client — it only generates in-memory readings. All entry points (`tick`, `inject`, `clear`) validate inputs: `assertFinite` on every metric before return, unknown `assetId`/fault combinations throw (AC-F01-5), and no operator/technician identifiers are ever embedded — only `assetId` strings, per the privacy standard. Header comments in `index.js` must restate classification (C2), edge-only residency, and read-only-to-OT stance for audit, per `adlc:sentinel` review decision.

## Reused team decisions
- C2/edge-only classification and read-only-to-OT header requirement (`adlc:orion`, kb data-classification table).
- Finite-value and unknown-id/metric rejection per IoT security standard I5 (`adlc:org security-standard`).
- Exact `Reading` shape and `createSimulator` signature from the feature spec and `adlc:orion` AC-F01-1 test expectations.
- Privacy standard: asset ids only, never operator/technician names (`adlc:org standard`).
