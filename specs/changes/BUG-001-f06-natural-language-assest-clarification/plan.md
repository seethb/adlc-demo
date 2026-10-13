# BUG-001 Impact Analysis · F06 Natural-language asset queries

## Summary
Fixes `condition`-intent status queries so they surface each resolved asset's latest status (e.g. "Asset 1- Live", "Asset 2- Not Live") instead of only raw metrics, satisfying AC-BUG001-1 without altering existing F06 behavior (AC-BUG001-2).

## Motivation
Users asking status-style questions ("is MTR-101 live?") got health/metric output but no explicit latest live/not-live status line, forcing manual inference. Reliability engineers need an at-a-glance status per asset.

## Impact
**Changes** in `edge/features/F06-nl-asset-query/index.js`:
- For `condition`/status-style queries, after `resolvedAssets` is computed, append a per-asset status label (`"<assetLabel>- Live"` / `"<assetLabel>- Not Live"`) derived from existing liveness/telemetry-freshness state (no new data source).
- Status derivation is additive formatting logic layered on current output; does not alter `parseQuery`'s returned shape (`intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets`).

**Stays unchanged:**
- `parseQuery(text)` signature/fields and intent-matching order (inventory→work_orders→car→anomalies→trend→ranking→condition).
- Asset id/type resolution, metric keyword table, window parsing defaults (300s).
- `healthScore(assetType, metrics)` contract and 0–100 scale/thresholds.
- Golden-set file `F06-nl-asset-query.golden.json` as normative reference — no new golden cases removed or reordered.

## Acceptance-criteria traceability
| AC id | Requirement | Verification |
|---|---|---|
| AC-BUG001-1 | Latest status shown (e.g. Asset 1- Live / Asset 2- Not Live) | New unit tests on status-intent queries asserting the `"<id>- Live/Not Live"` string per resolved asset |
| AC-BUG001-2 | AC-F06-1..4 unchanged | Full existing F06 suite + golden set rerun, 0 regressions |
| AC-F06-1 | 100% intent accuracy on golden set | Golden-set regression run |
| AC-F06-2 | Asset ids/types resolved incl. "SHF 301" | Existing resolution unit tests |
| AC-F06-3 | Metrics & windows extracted ("last 10 minutes") | Existing extraction unit tests |
| AC-F06-4 | Health 100 nominal, <50 severe deviation | Existing `healthScore` unit tests |

## Risks & rollback
Risk: status derivation misclassifies an asset as Live/Not Live if liveness source is stale — mitigate by reusing already-validated telemetry-freshness check, no new polling path. Rollback: Helm redeploy of previous F06 build; gateway restarts automatically on rollback, reverting to pre-BUG-001 behavior.

## Rollout
Deploy to `edge-staging` via Helm after human approval; edge gateway restarts on the new build (per BUG-001 CR rollout).

## Definition of done
AC-BUG001-1 verified via new tests; AC-BUG001-2 verified via zero-regression full F06 + golden-set run; PR merged, deployed to edge-staging, gateway restarted, Meko memory updated.
