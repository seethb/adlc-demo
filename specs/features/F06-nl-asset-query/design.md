# F06 · Natural-language asset queries — Design

## Module structure (`edge/features/F06-nl-asset-query/index.js`)
Pure functions, no mutable module-level state (deterministic, side-effect-free).

- `normalize(text)` — lower-case, trim, collapse whitespace. Internal.
- `resolveIntent(normText)` — runs the 6 keyword rules in fixed order, returns first match or `'condition'`. Internal.
- `ASSET_ID_RE` — regex matching `[A-Z]{2,4}[-\s]?\d{2,4}` on the *original* text (case preserved for ids), canonicalizes spaced form (`SHF 301` → `SHF-301`). Internal const.
- `resolveAssetTypes(normText)` — keyword map lookup; applies centrifugal disambiguation (compressor keyword wins over bare "centrifugal"; pump added only if "pump" or bare "centrifugal" without "compressor" present). Internal.
- `METRIC_MAP` — ordered array of `{ re, metric }` pairs per the keyword table. Internal const.
- `resolveMetrics(normText)` — collects all matching metrics, de-duplicated, preserving table order. Internal.
- `resolveWindow(normText)` — regex `last (\d+)\s*(s|sec|seconds|m|min|minutes|h|hours)` → seconds; default `300`. Internal.
- `resolveAssets(assetIds, assetTypes, fleet)` — explicit ids win; else all assets of matched types from `fleet`; else whole fleet. Internal, pure given a `fleet` list injected by caller (Studio layer), not stored here.
- `parseQuery(text, fleet = [])` (exported) — composes the above, returns the contract shape.
- `healthScore(assetType, metrics)` (exported) — per-asset-type nominal ranges/weights table (internal const `NOMINAL_RANGES`); computes normalized deviation per metric, weighted average, maps to 0–100, clamped.

No network, disk, or OT calls — module is a pure planner/scorer; it does not itself fetch F02/F03/F05 data. Callers (Studio backend) inject `fleet` and any WO/inventory slices separately, keeping F06 free of duplicated logic per the F06/plan dependency decision.

## Contract signatures
```
parseQuery(text: string, fleet?: Asset[]) →
  {
    intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car',
    assetIds: string[],          // canonical ids, e.g. ['SHF-301']
    assetTypes: string[],        // e.g. ['centrifugal_pump']
    metrics: string[],           // e.g. ['vibration','bearingTemp']
    windowSec: number,           // default 300
    resolvedAssets: string[]     // asset ids selected to answer from
  }

healthScore(assetType: string, metrics: Record<string, number>) → number  // 0-100
```

## AC → design mapping
| AC id | Design element |
|---|---|
| AC-F06-1 | `resolveIntent` fixed-order rule cascade (inventory→work_orders→car→anomalies→trend→ranking→condition), verified against golden set |
| AC-F06-2 | `ASSET_ID_RE` (handles spaced "SHF 301") + `resolveAssetTypes` keyword map with centrifugal disambiguation logic |
| AC-F06-3 | `METRIC_MAP` keyword table via `resolveMetrics` + `resolveWindow` "last N unit" parser, default 300s |
| AC-F06-4 | `healthScore` deviation-weighted scoring against `NOMINAL_RANGES`, clamped 0–100 |

## Security & data classification
NL-query questions and answers, resolved asset ids, and metrics are **C2 Confidential** (per the security design doc); health scores/aggregated KPIs are **C1 Internal**. All processing stays edge/plant-local; no raw question/answer text leaves the trust boundary except via the existing Studio/cloud channel already approved for C2 data, over encrypted transport. F06 is strictly read-only toward OT: it never issues control commands or writes to F02/F03/F05 state, only reads injected snapshots. Input validation: `text` is treated as untrusted free text — regexes are anchored/bounded to avoid catastrophic backtracking, unmatched input safely falls back to `'condition'` intent with empty arrays rather than throwing. Per the org privacy standard, no operator/technician names may appear in `parseQuery`/`healthScore` output — only asset ids and roles-free data.

## Reused team decisions
- F06 must not duplicate F02/F03/F05 internal logic; it consumes their data via injected slices only (atlas/F06 plan decision).
- Data classification table (C0–C3) from the security design doc governs C2 treatment of NL Q&A and C1 treatment of health scores.
- Privacy standard: outputs reference only asset ids, never operator/technician names.
- Exact export names `parseQuery`, `healthScore` and file path fixed by feature spec and prior sage/vega decisions.
