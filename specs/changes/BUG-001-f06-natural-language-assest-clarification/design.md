# BUG-001 design delta · F06 edge/features/F06-nl-asset-query/index.js

## Changed functions / internal state
- `answerFromSnapshot(plan, snapshot)`: new branch when `plan.intent === 'condition'` AND query is status-style (detected via a new internal regex `STATUS_WORDS = /\bstatus\b|\blive\b|\bup\b|\bdown\b|\brunning\b/` matched against the original lower-cased text, passed through as `plan._statusQuery` — see below). No new exported state; one new module-private const `STATUS_WORDS`.
- `parseQuery(text)` gains one additive internal field `_statusQuery: boolean` on the returned object, computed from `STATUS_WORDS.test(q)`. It is **not** part of the documented contract tuple and callers must not depend on its absence/presence for anything but this feature.
- New internal helper `statusLabel(asset)` → `"Live"` if `asset.openAnomaly` is absent AND `snapshot`-freshness check (existing `asset.lastSeenSec`/freshness field already in snapshot) is within threshold, else `"Not Live"`. Reuses existing freshness data; no new telemetry source.

## Exact data shapes
- `parseQuery(text)` → `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets, _statusQuery }` — all prior fields unchanged in type/order; `_statusQuery: boolean` appended.
- `answerFromSnapshot(plan, snapshot)` → `string` (unchanged type). When `plan.intent === 'condition' && plan._statusQuery`, output is lines of the form `"<id>- Live"` / `"<id>- Not Live"` per resolved asset, joined with a space, instead of the metric-dump lines.
- `healthScore(assetType, metrics)` → unchanged: `number` 0–100.

## AC → design mapping
- **AC-BUG001-1**: `statusLabel` + the new `condition`/`_statusQuery` branch in `answerFromSnapshot` produce `"Asset 1- Live"` / `"Asset 2- Not Live"` strings per resolved asset.
- **AC-BUG001-2**: `parseQuery`'s five original fields and intent-match order are untouched; `_statusQuery` is additive-only. `healthScore` untouched. Non-status `condition` queries and all other intents fall through to the pre-existing branches unchanged. Golden set (`F06-nl-asset-query.golden.json`) asserted unchanged via regression run.

## Backward compatibility
- `parseQuery` callers destructuring `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }` are unaffected; `_statusQuery` is an extra enumerable field, safe under object spread/destructure.
- `healthScore` signature, scale, and thresholds unchanged.
- `answerFromSnapshot` keeps its `(plan, snapshot) → string` signature; only status-style `condition` queries change their text, all other intents byte-for-byte identical.
- Any caller strictly validating `parseQuery`'s field set (e.g. deep-equal) must be updated to tolerate `_statusQuery`; none currently do per golden-set/regression scope.

## Security & data classification
- Status derivation reuses existing in-memory snapshot fields only (`openAnomaly`, freshness) — read-only towards OT, no new telemetry ingestion path, no write path introduced.
- No new external transport; existing mTLS 1.2+/MQTT 8883 ingestion untouched.
- Status strings contain only asset id + Live/Not Live — no raw metrics/PII, consistent with F06's existing non-sensitive output classification.

## Reused team decisions
- Followed org IoT security standard: read-only toward OT, no new ingestion/write path (org security-standard memory).
- Preserved `parseQuery`/`healthScore` contract shape from F06 plan/design (adlc:atlas, adlc:vega).
- Golden set `F06-nl-asset-query.golden.json` kept normative per F06 contract memory.
