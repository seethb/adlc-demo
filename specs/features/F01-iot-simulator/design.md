# F01 · IoT telemetry simulator — Design

## Module structure (`edge/features/F01-iot-simulator/index.js`)
Pure ES module, no I/O, no transport.

**Exported:**
- `createSimulator({ seed, assets?, startTs?, stepMs? })` — factory, returns instance.

**Instance methods:**
- `tick()` → `Reading[]`
- `inject(assetId, fault)`
- `clear(assetId)`
- `activeFaults()` → `{ [assetId]: fault|null }`
- `assets` — resolved fleet array (from `edge/reference/fleet.js` unless overridden)

**Internal helpers (not exported):**
- `makeRng(seed)` — mulberry32-style deterministic PRNG.
- `gaussian(rng, mean, sigma)` — Box-Muller sample, clamped to ±4.5σ for healthy state.
- `validateAsset(assetId)` / `validateFault(assetId, fault)` — throw `RangeError` on unknown.
- `degrade(fault, elapsedTicks)` — monotonic drift curve applied to signature metrics.
- `round3(n)` — 3-decimal rounding per org numeric standard.

**Internal state (closure, per instance):**
- `rng` (seeded generator), `clock` (current ts, advanced by `stepMs`, default 1000ms)
- `faultState: Map<assetId, { fault, since }>`
- `tickCount`

## Contract signatures
```
createSimulator({ seed: number, assets?: Asset[], startTs?: string, stepMs?: number })
  -> {
    tick(): Reading[],
    inject(assetId: string, fault: string): void,
    clear(assetId: string): void,
    activeFaults(): { [assetId: string]: string|null },
    assets: Asset[]
  }

Reading = {
  ts: string,          // ISO-8601
  assetId: string,
  type: string,
  metrics: { [metric: string]: number },
  fault: string|null
}
```

## AC → design mapping
| AC | Design element |
|---|---|
| AC-F01-1 | `tick()` iterates `assets` once, builds one `Reading` per asset with every nominal metric from fleet definition; `fault: null` unless `faultState` has entry |
| AC-F01-2 | `rng` seeded once from `seed`; no `Math.random`/`Date.now`; identical seed ⇒ identical draw sequence |
| AC-F01-3 | `gaussian` clamps healthy samples to ±4.5σ around nominal mean per metric |
| AC-F01-4 | `inject` sets `faultState`; `tick` calls `degrade` to progressively shift signature metrics with elapsed ticks and labels `fault`; `clear` deletes entry, restoring nominal distribution |
| AC-F01-5 | `validateAsset`/`validateFault` throw before mutating state on unknown asset id or fault not applicable to asset type |

## Security & data classification
- Output readings are **C2 Confidential** raw telemetry (per org data classification), even though simulated — treated identically to real plant data for downstream consumers.
- Data is **edge-resident only**: this module produces in-memory objects; it performs no network calls, storage, or cloud egress. Only 1-minute aggregates/anomalies (F02+) may leave the OT zone — not this module's concern, but it must not shortcut that boundary.
- **Read-only towards OT**: the module never writes to, commands, or controls any device; it only simulates sensor output for consumption by other features. No actuation surface exists.
- **Input validation** (OWASP IoT I5, treat as untrusted input): reject non-finite values (`NaN`/`Infinity`) surfacing from PRNG edge cases; `validateAsset` rejects unknown `assetId`; `validateFault` rejects faults not defined for the asset's type; `createSimulator` validates `seed` is present and numeric.
- Header comment must explicitly reference the IoT security standard and C2/edge-only/read-only stance for audit purposes.
- No PII: readings carry only `assetId`, never operator/technician identifiers.

## Reused team decisions
- Data shape for `Reading` and `createSimulator` signature taken verbatim from spec/plan (Meko: F01 design + orion's AC-F01-1 test note).
- C2 classification, edge-only residency, and read-only-towards-OT header requirement per orion's F01/develop decision and org data-classification table.
- Input validation rules (finite values, unknown asset/fault rejection) per org IoT security standard and sentinel's F01/review decision to reference it in comments.
- Privacy standard: no operator/technician names anywhere in output, only asset ids.
