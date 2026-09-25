# F06 · Natural-language asset queries — Design

## Module structure (`edge/features/F06-nl-asset-query/index.js`)

Internal state: none persisted; module is pure/stateless. Constants held in module scope:
- `ASSET_TYPE_LEXICON`: map of surface forms → canonical type (`motor`, `centrifugal pump`, `shaft`, `centrifugal compressor`, `gearbox`).
- `INTENT_PATTERNS`: ordered list of `{intent, regex/keywords}` for `condition`, `trend`, `anomalies`, `ranking`, `inventory`, `work_orders`, `car`.
- `METRIC_LEXICON`: map of surface forms → canonical metric names (must match F02 metric keys).
- `TIME_UNIT_MS`: map of `minute|hour|day` → seconds multiplier.
- `NOMINAL_RANGES`: per assetType, `{ metric: {min, max} }` used by `healthScore`.

Internal helper functions (not exported): `normalizeText`, `extractIntent`, `extractAssetIds` (regex for patterns like `MTR-101`, `SHF 301`), `extractAssetTypes` (with disambiguation for "centrifugal"), `extractMetrics`, `extractWindow`, `resolveAssets` (looks up live fleet state from F02's exported read accessor, and F03/F05 read accessors for `work_orders`/`inventory` intents).

Exported functions: `parseQuery`, `healthScore`.

## Contract signatures

```js
parseQuery(text: string) => {
  intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car',
  assetIds: string[],          // e.g. ["SHF-301"], ids normalized to canonical hyphenated form
  assetTypes: string[],        // canonical types, may hold both on ambiguous "centrifugal"
  metrics: string[],           // canonical metric names, [] if none mentioned
  windowSec: number|null,      // e.g. "last 10 minutes" -> 600
  resolvedAssets: Array<{ assetId: string, assetType: string }>  // from F02 fleet state
}

healthScore(assetType: string, metrics: Record<string, number>) => number  // 0–100, integer
```

`healthScore` computes deviation of each provided metric from `NOMINAL_RANGES[assetType]`, returns 100 minus a weighted penalty; unknown assetType defaults to a generic range.

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F06-1 | `extractIntent` uses ordered `INTENT_PATTERNS`; deterministic, no ML, tuned against golden set for 100% accuracy |
| AC-F06-2 | `extractAssetIds` regex handles "SHF 301"→"SHF-301"; `extractAssetTypes` + `ASSET_TYPE_LEXICON` resolve types, with context-word disambiguation for "centrifugal" (pump vs compressor keywords) |
| AC-F06-3 | `extractMetrics` maps phrases to `METRIC_LEXICON`; `extractWindow` parses "last N minutes/hours" into `windowSec` via `TIME_UNIT_MS` |
| AC-F06-4 | `healthScore` returns 100 when all metrics within `NOMINAL_RANGES`, drops below 50 when deviation exceeds severe threshold |

## Security & data classification

- Inputs (NL question text) and outputs (`resolvedAssets`, metrics, answers) are **C2 Confidential** (NL-query questions/answers per data classification standard) — process only on edge/Studio backend, never logged to public channels.
- `healthScore` output alone (aggregated 0–100) is **C1 Internal** and safe for dashboards.
- Module is strictly read-only toward OT: it only reads live state exposed by F02/F03/F05 accessors, never issues control or write commands.
- Input validation: `text` must be a non-empty string, length-capped (e.g. 2000 chars) before regex processing to avoid ReDoS; unresolved asset ids/types yield empty arrays rather than throwing.
- No operator/technician names ever appear in output — only asset ids, per org privacy standard. No PII is accepted or emitted; any PII substrings are treated as opaque tokens, not extracted.

## Reused team decisions

- Followed atlas's F06/plan decision: F06 depends on F02 (live metrics/anomalies), F03 (work orders), F05 (inventory) without duplicating their internal logic — accessed via each module's exported read functions.
- Applied org privacy standard: outputs reference only asset ids, never operator/technician names; no PII sent to Claude or Meko.
- Applied Security design data classification: NL-query Q&A and telemetry classified C2, health scores/KPIs classified C1, driving module residency and logging rules.
- Kept exact contract shapes for `parseQuery`/`healthScore` and intent set as fixed in the F06 spec and plan.
