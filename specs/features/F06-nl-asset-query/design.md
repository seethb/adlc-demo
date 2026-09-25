# F06 · Natural-language asset queries — Design

## Module structure (`edge/features/F06-nl-asset-query/index.js`)

Internal state: none persisted; module holds constant lookup tables built at load time:
- `INTENT_PATTERNS` — ordered list of `{ intent, regexes }` for the 7 intents.
- `ASSET_TYPE_ALIASES` — map of surface forms → canonical type (`motor`, `centrifugal_pump`, `shaft`, `centrifugal_compressor`, `gearbox`), including disambiguation entries for "centrifugal".
- `METRIC_ALIASES` — map of surface forms → canonical metric names.
- `NOMINAL_RANGES` — per-asset-type `{ metric: { min, max } }` used by `healthScore`.
- `assetRegistry` — read-only snapshot passed in via `init(fleetState)` (from F02/F03/F05 state), never mutated.

Functions:
- `init(fleetState)` — optional, stores read-only reference to live fleet slice (asset ids, types, current metrics) for `resolvedAssets` lookups.
- `classifyIntent(text)` — internal, returns intent or `null`.
- `extractAssets(text)` — internal, resolves ids (e.g. "SHF 301" → `SHF-301`) and types, disambiguating "centrifugal" using following noun.
- `extractMetricsAndWindow(text)` — internal, parses metric names and phrases like "last 10 minutes" → seconds.
- `parseQuery(text)` — exported, composes the above.
- `healthScore(assetType, metrics)` — exported, deviation-based scoring against `NOMINAL_RANGES`.

## Contract signatures

```js
parseQuery(text: string) => {
  intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car'|null,
  assetIds: string[],          // e.g. ["SHF-301"]
  assetTypes: string[],        // canonical types
  metrics: string[],           // canonical metric names
  windowSec: number|null,      // e.g. 600 for "last 10 minutes"
  resolvedAssets: Array<{ id: string, type: string }>
}

healthScore(assetType: string, metrics: Record<string, number>) => number // 0-100
```

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F06-1 | `classifyIntent` ordered regex table, tuned/tested against golden set for 100% accuracy |
| AC-F06-2 | `extractAssets`: id regex (`[A-Z]{2,4}[\s-]?\d{3}` normalized), `ASSET_TYPE_ALIASES` with centrifugal disambiguation, `resolvedAssets` lookup against `assetRegistry` |
| AC-F06-3 | `extractMetricsAndWindow`: `METRIC_ALIASES` map, time-phrase regex → `windowSec` |
| AC-F06-4 | `healthScore`: deviation from `NOMINAL_RANGES` mapped to 100 at nominal, <50 when any metric severely out of range |

## Security & data classification

- Query text, parsed output and `resolvedAssets` are **C2 Confidential** (NL-query questions/answers, asset register/topology) per org data classification.
- Module runs edge-side only; no raw query text or resolved asset detail is written to Meko or GitHub — only aggregated health scores (C1) may be logged.
- Strictly **read-only** toward OT/fleet state: `init` stores a reference for lookups only, no writes back to F02/F03/F05 state or OT systems.
- Input validation: `text` must be a non-empty string, length-capped; unresolved intent/assets return `null`/empty arrays rather than guessing (fail-closed disambiguation for "centrifugal").
- No PII: query text must never contain operator/technician names; if present, upstream pii-scan/egress shield redacts before this module or before egress, per org privacy standard.

## Reused team decisions

- Reused `parseQuery`/`healthScore` contract and intent enum exactly as fixed in the F06 plan and feature spec.
- Reused dependency decision (atlas/F06 plan): F02 feeds `healthScore`/anomaly signals, F03 grounds `work_orders`/`car`, F05 grounds `inventory`.
- Applied org privacy standard: asset ids only, no operator/technician names, in queries and logs.
- Applied C2 classification for NL-query data per data-classification KB.
