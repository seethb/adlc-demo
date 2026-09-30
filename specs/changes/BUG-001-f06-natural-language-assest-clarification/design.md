# Design Delta — BUG-001 · Natural-language asset clarification (F06)

## Changed functions & internal state
`edge/features/F06-nl-asset-query/index.js`:
- **`answerFromSnapshot(plan, snapshot)`** — augmented (not `parseQuery`/`healthScore`). Adds a status-formatting branch invoked when `plan.intent === 'condition'` **and** the source text (or plan) signals a status query. Since `answerFromSnapshot` doesn't currently see raw text, we detect status intent structurally: the branch fires for `condition` whenever no explicit `metrics` were requested (i.e. `plan.metrics.length === 0`), meaning the user asked generic "how is X" / "is X live" rather than a metric-specific question. This is a superset-safe heuristic: metric-specific `condition` answers keep the existing formatting.
- New pure helper **`isLive(asset)`** — internal, not exported. Reads `asset.status` (or `asset.openAnomaly`/last-seen freshness already present on the snapshot asset) and returns boolean. No new fields are required on the snapshot beyond what F06/F03 already produce (`asset.status ?? (asset.openAnomaly ? false : true)`).
- No new module-level state; no caching, no timers — status is always derived fresh from the passed-in `snapshot` each call.

## Exact data shapes of every changed return value
`answerFromSnapshot` still returns a `string` (unchanged type). For the new branch, the string is composed of one line per resolved asset:
```
"Asset <id> - Live"      // isLive(asset) === true
"Asset <id> - Not Live"  // isLive(asset) === false
```
joined with a single space, in the order of `snapshot.assets.filter(...)` (same ordering as existing branches). Example: `"Asset MTR-101 - Live Asset SHF-301 - Not Live"`.

`parseQuery` and `healthScore` return shapes are **unchanged**.

## AC → design mapping
| AC | Design element |
|---|---|
| AC-BUG001-1 | New status branch in `answerFromSnapshot`; formats "Asset <id> - Live/Not Live" per resolved asset using `isLive(asset)` on live snapshot data. |
| AC-BUG001-2 | No edits to `parseQuery` or `healthScore`; intent precedence, id/type resolution, metric table, window parsing untouched. New branch is additive and gated so metric-bearing `condition` queries keep pre-existing formatting, preserving golden-set + AC-F06-1..4 behavior. |

## Backward compatibility
- `parseQuery(text)` contract `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }` is byte-for-byte unchanged; all callers relying on this shape (Studio chat handler, F06 golden-set tests) are unaffected.
- `healthScore(assetType, metrics)` logic/thresholds unchanged (100 nominal, <50 severe deviation per AC-F06-4).
- `answerFromSnapshot` keeps its `(plan, snapshot) → string` signature; existing `condition`-with-metrics, `ranking`, `inventory`, `work_orders`, `car` branches are untouched — only a new conditional path is inserted before the generic per-asset loop.
- Any caller pattern-matching on the previous generic "health N/100" string for status-only queries will see new output; this is the intended bug fix and is scoped via `metrics.length === 0`.

## Security & data classification
- Data handled: derived operational-technology (OT) telemetry status (live/not-live), classified **operational, internal-use** — same class as existing F06 outputs; no new PII or credentials introduced.
- Data must remain within the edge gateway / Studio trust boundary already established for F06; no new external egress.
- Strict **read-only** toward OT preserved: `answerFromSnapshot` only reads `snapshot`/`asset` fields, never writes back to fleet or asset state.
- Input validation: `isLive` treats missing/non-boolean `asset.status` and non-finite metric values defensively, defaulting to "Not Live" rather than throwing, per org policy of rejecting untrusted/non-finite telemetry.

## Reused team decisions
- Reused the normative planner rules and golden-set precedence from `F06-nl-asset-query.golden.json` (intent order, id/type resolution, metric table) — kept fully intact per AC-BUG001-2.
- Reused prior F06 contract shapes for `parseQuery`/`healthScore` recorded by sentinel/sage/vega in shared memory.
- Applied org IoT security standard: read-only toward OT, reject non-finite/unknown telemetry (OWASP IoT I5).
