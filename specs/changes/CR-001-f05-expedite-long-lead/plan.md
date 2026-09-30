# CR-001 Impact Analysis: Expedite long-lead critical spares (F05)

## Summary
Adds early, prioritized requisitions for long-lead critical spares (leadTimeDays ≥ 14: IMP-250, AVV-DN50, VRN-F) and enriches requisition records with `priority`/`etaDays`/`reason`, plus immediate requisitioning at creation and an extended `list()` shape. `createInventory` contract is preserved.

## Motivation
F05's own risk note flags that long-lead parts need visibility before the work order is raised. Today reorder logic is threshold-only and reactive, so a plant can be exposed for weeks, and parts already short at startup wait until touched.

## Impact
**Changes in edge/features/F05-inventory/index.js:**
- Reorder trigger becomes SKU-aware: `available ≤ reorderPoint + 1` for long-lead parts (leadTimeDays ≥ 14); `available ≤ reorderPoint` otherwise.
- Requisition objects gain `priority` (`expedite`|`normal`), `etaDays` (`ceil(leadTimeDays/2)` or `leadTimeDays`), `reason`.
- `createInventory(parts)` now scans all parts at construction time and opens one requisition each for any already at/below threshold.
- `list()` adds `reorderPoint`, `leadTimeDays`, `low` fields to existing sku/name/onHand/reserved/available output.

**Stays unchanged:** `createInventory` exports and method signatures (`reserve`, `release`, `consume`, `receive`, `available`, `lowStock`, `requisitions`, `reservations`); one-open-requisition-per-SKU invariant; reservation/consume/receive semantics; unknown-SKU error behavior.

## AC Traceability
| AC | Coverage |
|---|---|
| AC-CR001-1 | Test: long-lead SKU reorders at reorderPoint+1; normal SKU still reorders at reorderPoint |
| AC-CR001-2 | Test: requisition fields priority/etaDays/reason match expedite/normal formulas |
| AC-CR001-3 | Test: at construction, pre-low parts each get exactly one open requisition |
| AC-CR001-4 | Test: `list()` shape includes reorderPoint, leadTimeDays, low, consistent with AC-CR001-1 threshold |
| AC-CR001-5 | Full AC-F05-1..5 regression suite rerun unchanged |
| AC-F05-1 | Reservation shortfall never negative (regression) |
| AC-F05-2 | Release restores on-hand, clears reservation (regression) |
| AC-F05-3 | Exactly one open requisition per SKU (regression, now dual-threshold) |
| AC-F05-4 | Receive restocks and closes requisition (regression) |
| AC-F05-5 | Unknown SKU throws (regression) |

## Risks & Rollback
Risk: dual-threshold logic could create duplicate requisitions if not guarded per-SKU — mitigated by reusing existing open-requisition check. Risk: `list()` shape change may break UI consumers expecting old fields — additive only, no removals. Rollback: redeploy previous gateway build; no data migration needed since requisition schema is additive.

## Rollout
Deploy to `edge-staging` via Helm after approval; edge gateway restarts on new build; verify Edge Ops UI shows expedited critical spares and new list fields.

## Definition of Done
All AC-CR001-1..5 and AC-F05-1..5 pass; CR-001 test file green; contract signature unchanged; rollout verified on edge-staging.
