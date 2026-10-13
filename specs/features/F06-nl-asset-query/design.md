# F06 · Natural-language asset queries — Design

## Module structure (`edge/features/F06-nl-asset-query/index.js`)

Pure, stateless functions — no module-level mutable state (deterministic planner, as required by the golden-set accuracy check).

- `INTENT_RULES`: ordered array of `{ intent, test(lowerText) }`, evaluated top-to-bottom; first match wins (inventory → work_orders → car → anomalies → trend → ranking → condition).
- `ASSET_TYPE_PATTERNS`: ordered list resolving motor/pump/compressor/shaft/gearbox keywords, with the "centrifugal" disambiguation rule applied after compressor/pump checks.
- `ASSET_ID_RE`: regex matching `XXX-###` and `XXX ###` forms, normalizing spaced ids (`SHF 301` → `SHF-301`) to canonical hyphenated form.
- `METRIC_KEYWORDS`: ordered keyword→metric map per the spec table.
- `WINDOW_RE`: regex for `last N (s|sec|seconds|m|min|minutes|h|hours)`, default 300.
- `NOMINAL_RANGES`: per-assetType per-metric `{ nominal, limit }` used by `healthScore`.
- `resolveAssets(assetIds, assetTypes, fleet)`: internal helper, called by `parseQuery` when `resolvedAssets` requires fleet context (optional `fleet` arg, defaults to `[]`, kept out of the public contract).
- `parseQuery(text)`, `healthScore(assetType, metrics)`: the two exports.

## Contract signatures

```js
parseQuery(text: string) => {
  intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car',
  assetIds: string[],          // canonical ids, e.g. ['SHF-301']
  assetTypes: string[],        // e.g. ['motor','centrifugal_pump']
  metrics: string[],           // e.g. ['vibration','bearingTemp']
  windowSec: number,           // default 300
  resolvedAssets: string[]     // explicit ids, else all matching-type ids, else whole fleet
}

healthScore(assetType: string, metrics: { [metric: string]: number }) => number // 0-100
```

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F06-1 | `INTENT_RULES` ordered ladder, exact precedence from spec; validated against `F06-nl-asset-query.golden.json` |
| AC-F06-2 | `ASSET_ID_RE` (incl. spaced→canonical normalization) + `ASSET_TYPE_PATTERNS` with centrifugal disambiguation |
| AC-F06-3 | `METRIC_KEYWORDS` lookup + `WINDOW_RE` extraction with 300s default |
| AC-F06-4 | `healthScore` computed from `NOMINAL_RANGES` deviation: 100 at nominal, decays below 50 past severe thresholds (reuses F02 vibration-zone-style severity bands conceptually, no F02 import needed) |

## Security & data classification

- NL-query questions/answers and the fleet-state slice they're grounded in are **C2 Confidential** (per org data classification: asset register, telemetry-derived answers). `healthScore` output and aggregate rankings are **C1 Internal**.
- Module is edge-resident only; it reads live state exported by F02/F03/F05 and never writes back — strictly read-only towards OT, consistent with IoT security guidance.
- No network/transport calls in this module; any transmission of C2 answers to Studio/cloud must go over the already-mandated encrypted channel (out of scope here).
- `parseQuery` input is free-text and treated as untrusted: only matched against fixed regex/keyword tables, never interpolated into queries or code (no eval, no SQL), satisfying the "no free-form SQL generation" non-goal.
- Per org privacy standard, outputs reference only asset ids — never operator/technician names.

## Reused team decisions

- Followed atlas's plan decision: F06 consumes F02/F03/F05 contracts only for condition/anomalies/trend, work_orders, and inventory intents respectively, without duplicating their internal logic.
- Applied the org privacy standard: all NLQ answers and this design reference assets only, never people, by id.
- Applied the C1/C2/C3 data classification scheme from the security design doc to label NLQ questions/answers (C2) and health scores (C1).
- Treated the normative golden set (`F06-nl-asset-query.golden.json`) and the exact planner rules/table from the feature spec as binding for intent, asset, metric, and window resolution.
