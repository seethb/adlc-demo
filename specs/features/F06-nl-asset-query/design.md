# F06 · Natural-language asset queries — Design

## Module structure (edge/features/F06-nl-asset-query/index.js)

Exports: `parseQuery`, `healthScore`.

Internal helpers (not exported):
- `classifyIntent(text)` — keyword/pattern rules → one of `condition|trend|anomalies|ranking|inventory|work_orders|car`.
- `extractAssetIds(text)` — regex over known id patterns (e.g. `MTR-101`, `SHF 301` normalized to `SHF-301`).
- `extractAssetTypes(text)` — matches against `ASSET_TYPE_LEXICON` (motor, centrifugal pump, shaft, centrifugal compressor, gearbox), with a disambiguation step: "centrifugal" alone is not matched; requires adjacent "pump" or "compressor" token.
- `extractMetrics(text)` — matches against `METRIC_LEXICON` (vibration, temperature, pressure, flow, etc.).
- `extractWindow(text)` — parses relative phrases ("last 10 minutes") into `windowSec`; defaults to 600 if unspecified.
- `resolveAssets(assetIds, assetTypes, fleetIndex)` — looks up `resolvedAssets` from an in-memory fleet index injected at module load (no OT write access).
- `deviationPenalty(metricValue, nominal, stdBand)` — pure function used by `healthScore`.

Internal state: a static `ASSET_TYPE_LEXICON`, `METRIC_LEXICON`, `INTENT_PATTERNS` constant tables. No mutable module-level state; `parseQuery` and `healthScore` are pure given inputs (fleet index passed as parameter, not cached globally), keeping the module side-effect-free and read-only.

## Contract signatures

```
parseQuery(text: string) => {
  intent: 'condition'|'trend'|'anomalies'|'ranking'|'inventory'|'work_orders'|'car',
  assetIds: string[],          // e.g. ["SHF-301"]
  assetTypes: string[],        // e.g. ["centrifugal pump"]
  metrics: string[],           // e.g. ["vibration"]
  windowSec: number,           // e.g. 600
  resolvedAssets: { id: string, type: string }[]
}

healthScore(assetType: string, metrics: Record<string, number>) => number // 0–100
```

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F06-1 | `classifyIntent` deterministic pattern table tuned against golden set; no ML variance, ensures 100% reproducibility |
| AC-F06-2 | `extractAssetIds` (id normalization incl. "SHF 301"→"SHF-301") + `extractAssetTypes` with pump/compressor disambiguation |
| AC-F06-3 | `extractMetrics` + `extractWindow` relative-time parser |
| AC-F06-4 | `healthScore` = 100 − Σ`deviationPenalty`; nominal metrics → 100, severe deviation → <50 |

## Security & data classification

Per org data classification, NL-query questions and answers are **C2 Confidential** (reveal process/asset condition); resolved fleet health scores are **C1 Internal**. The module runs on the edge, reads only in-memory fleet/anomaly state populated by F02/F03/F05, and never issues writes or commands toward OT — strictly read-only. `parseQuery` performs input validation: unknown asset ids/types are dropped silently (not guessed), malformed time phrases fall back to the 600s default, and no arbitrary code/SQL is generated. No operator/technician names are ever attached to query text or output; only asset ids and pseudonymous team ids may appear downstream in telemetry, per privacy standard. All data stays edge-side unless explicitly forwarded to Studio/Claude, which must go over mutual TLS per the IoT security standard.

## Reused team decisions
- Contract shape (`parseQuery`, `healthScore`, intents list) taken verbatim from spec and atlas's F06 plan.
- Dependency wiring (F02 deviation signals, F03 work_orders/car grounding, F05 inventory grounding) reused from atlas's recorded decision.
- Privacy standard (no names, only asset ids/pseudonymous ids) and data classification table (C1/C2) reused from org security/privacy standards.
