# F06 · Natural-language asset queries — Design

## Module structure
`edge/features/F06-nl-asset-query/index.js`, pure ES module, no I/O, no network.

Internal state: none persisted across calls; module holds only static lookup tables (const, module-scope):
- `INTENT_PATTERNS`: ordered array of `{intent, regexes[]}` — order matters, first match wins, ensures determinism (AC-F06-1).
- `ASSET_TYPE_ALIASES`: map of surface forms → canonical type (`motor`, `centrifugal pump`, `shaft`, `centrifugal compressor`, `gearbox`), including disambiguation rule: bare "centrifugal" without "pump"/"compressor" resolves to `null` type + flags `ambiguous: true` in resolvedAssets metadata rather than guessing.
- `METRIC_ALIASES`: map of phrase → canonical metric key (e.g. "vibration" → `vibrationMm`).
- `TIME_UNIT_SEC`: `{minute:60, minutes:60, hour:3600, hours:3600, second:1, seconds:1}`.
- `NOMINAL_RANGES` / `HEALTH_WEIGHTS` per assetType, used only by `healthScore`.

Internal functions (not exported): `classifyIntent(text)`, `extractAssetIds(text)`, `extractAssetTypes(text)`, `extractMetrics(text)`, `extractWindow(text)`, `resolveAssets(ids, types, fleetIndex?)`, `deviationScore(metricValue, nominal)`.

## Contract signatures

```js
parseQuery(text: string) => {
  intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car',
  assetIds: string[],            // normalized, e.g. "SHF 301" -> "SHF-301"
  assetTypes: string[],          // canonical types, [] if none/ambiguous
  metrics: string[],             // canonical metric keys
  windowSec: number|null,        // e.g. "last 10 minutes" -> 600
  resolvedAssets: {
    ids: string[],
    ambiguous: boolean,          // true when type unresolved (e.g. bare "centrifugal")
    candidates: string[]         // e.g. ['centrifugal pump','centrifugal compressor']
  }
}

healthScore(assetType: string, metrics: Record<string, number>) => number // 0-100, integer
```

`parseQuery` throws `TypeError` on non-string/empty input. `healthScore` throws on unknown `assetType`, or on any non-finite metric value (reject NaN/Infinity per IoT security standard), never silently coerces.

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F06-1 | `classifyIntent` uses ordered, deterministic regex table `INTENT_PATTERNS`; golden-set eval asserts 100% match; no ML/nondeterminism. |
| AC-F06-2 | `extractAssetIds` normalizes free-text ids ("SHF 301"→"SHF-301"); `extractAssetTypes` + `ASSET_TYPE_ALIASES` resolve the 5 canonical types and flag "centrifugal" ambiguity into `resolvedAssets.ambiguous/candidates` per the plan's risk mitigation. |
| AC-F06-3 | `extractMetrics` via `METRIC_ALIASES`; `extractWindow` parses "last N unit(s)" using `TIME_UNIT_SEC` into `windowSec`. |
| AC-F06-4 | `healthScore` = 100 − weighted sum of `deviationScore` per metric vs `NOMINAL_RANGES[assetType]`, clamped [0,100]; nominal inputs yield 100, severe deviation (large weighted distance) drives result below 50. |

## Security & data classification
- Inputs (NL question text) and outputs (parsed query, health score) are **C2 Confidential** (NL-query questions/answers, asset topology) per the org data classification standard; module output must never be published as C0/C1 and must stay within edge/Studio backend boundary, not logged verbatim to public channels.
- No PII: assets are referenced only by asset id/type, never operator/technician names, per the privacy standard; any free-text fed in is not persisted beyond query lifetime and must pass the pii-scan guardrail before reaching Claude/Meko.
- Read-only towards OT: this module never writes PLC/OPC-UA/setpoints; `parseQuery`/`healthScore` only read/derive from already-collected metrics, consistent with IEC 62443 read-only edge analytics.
- Input validation: reject non-finite metric values (NaN/Infinity), unknown asset types, and unknown metrics — comment each guard with the IoT security standard reference for audit, even though this module doesn't handle raw device transport.
- No credentials, no network calls in this module — pure computation only.

## Reused team decisions
- Privacy standard: asset ids only, no operator names, pii-scan/egress shield applies to NL text and answers.
- IoT security standard: reject NaN/Infinity and unknown ids/metrics; edge is read-only towards OT.
- Sentinel decision (F01 review): comment security-standard references explicitly even in non-transport modules, for audit ease.
- Data classification kb: NL-query Q&A and health scores classed C2/C1 respectively, bounding storage/egress.
