# CR-003 Impact Analysis — Spare-parts low-stock alert (<2 items)

## Summary
Add a low-stock alert signal when a SKU's available quantity drops below 2 units, surfaced alongside existing `lowStock()` reorder-point logic in `createInventory` (edge/features/F05-inventory/index.js).

## Motivation
Operators need an explicit indicator that parts are nearing/below the minimum order level, distinct from the generic reorder-point requisition flow, to prioritize urgent restocking.

## Impact
**Changes:**
- `lowStock()` (or a new `alerts()` view) flags SKUs with `available < 2` with a distinct alert entry/flag, independent of whether a requisition is already open.
- Any operation mutating availability (reserve, release, consume, receive) re-evaluates this threshold.

**Stays the same:**
- `createInventory` contract signature and all other methods (`reserve`, `release`, `consume`, `receive`, `available`, `list`, `requisitions`, `reservations`) unchanged.
- Reorder-point requisition logic (one open requisition per SKU) untouched.
- SKU validation (unknown SKU throws) untouched.

## Acceptance-criteria traceability
| AC | Description | Verification |
|---|---|---|
| AC-CR003-1 | Below 2 items alerted | New test: reduce available to 1 via reserve/consume, assert alert flag/entry present; restore to ≥2, assert alert clears |
| AC-CR003-2 | Regression AC-F05-1..5 unchanged | Full existing F05 suite re-run, no modifications |
| AC-F05-1 | Reservations never negative, shortfall reported | Unchanged test, rerun |
| AC-F05-2 | Release/consume adjust stock and reservation | Unchanged test, rerun |
| AC-F05-3 | One open requisition per SKU at reorder point | Unchanged test, rerun |
| AC-F05-4 | Receiving restocks and closes requisition | Unchanged test, rerun |
| AC-F05-5 | Unknown SKU throws | Unchanged test, rerun |

## Risks & rollback
- Risk: conflating low-stock alert with reorder-point requisition could cause duplicate signaling confusion; mitigate by keeping alert as a separate field/flag, not a new requisition.
- Risk: threshold hardcoded at 2 may need to become configurable later; out of scope for this CR.
- Rollback: revert commit touching `index.js`; no schema/data migration involved, so rollback is a clean redeploy of prior build.

## Rollout
Deploy to `edge-staging` via Helm after human approval; edge gateway restarts on the new build to pick up the updated module.

## Definition of done
- AC-CR003-1 and AC-CR003-2 pass in CI.
- Full AC-F05-1..5 regression suite green, unchanged.
- Code review confirms `createInventory` contract shape unchanged.
- Deployed and verified on `edge-staging` with gateway restart confirmed.
