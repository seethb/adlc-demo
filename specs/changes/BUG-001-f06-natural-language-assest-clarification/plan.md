# Impact Analysis — BUG-001 · Natural-language asset clarification (F06)

## Summary
`condition` intent queries currently answer from a snapshot without guaranteeing the *latest* fleet status per resolved asset. BUG-001 requires that status-related queries surface the current live/not-live status per asset (e.g. "Asset 1- Live", "Asset 2- Not Live"), without altering planner or health-score behavior.

## Motivation
Users asking status questions ("is MTR-101 live?") got stale or ambiguous answers. Fix must guarantee latest-state resolution per asset while leaving all existing F06 contract behavior intact.

## Impact
**Changes** in `edge/features/F06-nl-asset-query/index.js`:
- After `parseQuery` resolves `resolvedAssets`, the response-assembly path (consumer of `parseQuery`/`healthScore` for `condition`/status queries) must fetch each asset's latest live-state and format per-asset status lines ("Asset <id> - Live" / "Asset <id> - Not Live").
- No new intent added; this augments the existing `condition` intent's downstream formatting, not the planner's intent-matching order.

**Stays unchanged**:
- `parseQuery` signature/output shape `{ intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets }`.
- `healthScore(assetType, metrics)` → 0–100 logic and thresholds (100 nominal, <50 severe deviation).
- All planner rules: intent precedence order, asset id/type resolution (incl. "SHF 301", centrifugal disambiguation), metric keyword table, window parsing/defaults.

## Acceptance-criteria traceability

| AC | Requirement | Verification |
|---|---|---|
| AC-BUG001-1 | Latest status per asset (e.g. "Asset 1- Live", "Asset 2- Not Live") | New unit test on status formatting path using live-state fixtures |
| AC-BUG001-2 | Regression: AC-F06-1..4 unchanged | Re-run F06 golden-set + acceptance suite, 100% pass, no diffs |
| AC-F06-1 | Intent accuracy 100% on golden set | Unchanged; golden-set suite re-run |
| AC-F06-2 | Asset id/type resolution ("SHF 301", motor, pump, shaft, compressor, gearbox) | Unchanged; suite re-run |
| AC-F06-3 | Metrics + time window extraction ("last 10 minutes") | Unchanged; suite re-run |
| AC-F06-4 | Health 100 nominal, <50 severe deviation | Unchanged; `healthScore` untouched, suite re-run |

## Risks & rollback
Risk: touching shared formatting code could regress non-status intents (trend, ranking, etc.) if status logic isn't scoped tightly to `condition`/status paths. Mitigation: gate new logic behind explicit status-detection, keep other intents' output paths untouched. Rollback: revert index.js to pre-BUG-001 commit; no schema/data migration involved.

## Rollout
Deploy to `edge-staging` via Helm after human approval, per BUG-001 rollout note; edge gateway restarts on the new build to pick up updated index.js.

## Definition of done
- AC-BUG001-1 verified with new tests.
- Full F06 golden-set + acceptance suite (AC-F06-1..4) green, unchanged.
- Deployed to edge-staging, gateway restarted, smoke-tested with sample status queries.
