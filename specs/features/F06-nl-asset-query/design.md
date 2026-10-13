# F06 · Natural-language asset queries — Design

## Module structure (`edge/features/F06-nl-asset-query/index.js`)

Pure, stateless functions over regex/keyword tables. No internal mutable state; all tables are module-level `const`s.

- `INTENT_RULES` — ordered array of `{ intent, test(lowerText) }`, checked in spec order (inventory → work_orders → car → anomalies → trend → ranking → condition fallback).
- `ASSET_ID_RE` — matches `[A-Z]{3}-\d{3}` and spaced form `[A-Z]{3} \d{3}`, normalizes to hyphenated canonical id.
- `ASSET_TYPE_KEYWORDS` — ordered map of keyword → type, with compressor checked before bare "centrifugal" to implement disambiguation.
- `METRIC_KEYWORDS` — keyword → metric per the contract table.
- `WINDOW_RE` — `/last\s+(\d+)\s*(s|sec|seconds|m|min|minutes|h|hours)/i`, converts to seconds; default 300.
- `NOMINAL_RANGES` — per assetType, per metric, `{ mean, limit }` used by `healthScore` to compute normalized deviation (reused from F02's zone thresholds where applicable, not reimplemented — F06 only reads metric values passed in, never recomputes F02 detection logic).

### Internal helpers
- `matchIntent(lowerText)`, `extractAssetIds(lowerText)`, `extractAssetTypes(lowerText)`, `extractMetrics(lowerText)`, `extractWindow(lowerText)`, `resolveAssets({ assetIds, assetTypes })` — the last consults the fleet asset registry (injected or imported, read-only) to expand types into ids, falling back to the whole fleet if nothing resolves.

## Contract signatures

```
parseQuery(text: string) → {
  intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car',
  assetIds: string[],           // canonical, e.g. ['SHF-301']
  assetTypes: string[],         // e.g. ['centrifugal_pump']
  metrics: string[],            // e.g. ['vibration','bearingTemp']
  windowSec: number,            // default 300
  resolvedAssets: string[]      // final asset id list used to answer
}

healthScore(assetType: string, metrics: Record<string, number>) → number  // 0–100
```

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F06-1 | `INTENT_RULES` ordered cascade, exact precedence per spec; validated against `F06-nl-asset-query.golden.json` |
| AC-F06-2 | `ASSET_ID_RE` (incl. spaced "SHF 301"), `ASSET_TYPE_KEYWORDS` with compressor-before-centrifugal disambiguation |
| AC-F06-3 | `METRIC_KEYWORDS` table + `WINDOW_RE` with unit conversion and 300s default |
| AC-F06-4 | `healthScore` using `NOMINAL_RANGES` deviation scoring: 100 at mean, scaled down to <50 past the severe-deviation limit |

## Security & data classification
- Inputs (NL questions) and outputs (parsed query, health scores) are **C2 Confidential** (per org standard: "NL-query questions and answers" are explicitly C2) — may be processed and cached on edge/Studio backend, never logged to public/C0 channels.
- Module is **read-only** toward OT: it never issues commands to F02/F03/F05, only calls their documented read accessors (`createDetector` output, `createWorkOrderService().list()/get()`, `createInventory().available()/lowStock()`); no writes, no `reserve`/`consume`/`release` calls.
- Input validation: `text` coerced to string, length-capped before regex matching to avoid ReDoS; unmatched/garbage input falls through to `condition` intent with empty `assetIds`/`assetTypes` rather than throwing.
- No operator/technician names ever appear in parsed output or logs — only asset ids, per the org privacy standard.

## Reused team decisions
- Followed atlas's F06/plan decision: F06 depends on F02/F03/F05 only through their documented contracts, no duplicated internal logic (anomaly scoring, WO lifecycle, reservation logic).
- Applied org data-classification standard: NL-query Q&A and telemetry-derived health scores classed C2/C1 respectively, driving storage/logging rules above.
- Applied org privacy standard: asset ids only, never operator/technician names, in any parsed query or log output.
- Preserved exact exports (`parseQuery`, `healthScore`) and shapes mandated by sage's implementation task and the feature contract.
