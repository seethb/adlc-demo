# CR-002 Impact Analysis — F05 Spare-parts inventory tracking

## Summary
Adds a low-stock notification to F05: when inventory is viewed, any SKU with `available(sku) < 5` surfaces a notification. No change to `createInventory` signature or existing behaviors.

## Motivation
Users need an alert when stock drops below 5 to raise awareness before a work order stalls, per CR-002's stated need to "raise an alert."

## Impact
**Changes in `edge/features/F05-inventory/index.js`:**
- Extend the viewing path (`list()`/`lowStock()`) to compute a `notification` flag/list for any SKU with `available(sku) < 5`.
- No new exports; `createInventory` return shape unchanged except for the added notification surfaced via existing `list()`/`lowStock()`.

**Stays the same:**
- `createInventory(parts?)` signature and all method names/signatures (`reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations`).
- Reservation math, requisition creation/closing, receiving logic, and unknown-SKU error behavior are untouched.

## Acceptance-criteria traceability

| AC id | Description | Verification |
|---|---|---|
| AC-CR002-1 | Notification pops up when viewing inventory and count < 5 | New test: seed SKU below 5, call `list()`/`lowStock()`, assert notification present |
| AC-CR002-2 | Regression: AC-F05-1..5 unchanged | Full existing F05 test suite re-run, no modifications, all pass |
| AC-F05-1 | Reservations never drive availability negative | Existing suite |
| AC-F05-2 | `release`/`consume` returns/reduces stock, clears reservation | Existing suite |
| AC-F05-3 | Exactly one open requisition per SKU at reorder point | Existing suite |
| AC-F05-4 | Receiving restocks and closes requisition | Existing suite |
| AC-F05-5 | Unknown SKUs throw | Existing suite |

## Risks & rollback
- Risk: notification logic accidentally alters `list()`/`lowStock()` output shape, breaking consumers — mitigate by additive field only.
- Risk: threshold hardcoded as 5 diverges from per-SKU reorder point — document as intentional, separate from AC-F05-3 reorder logic.
- Rollback: revert `index.js` to prior commit; no data migration involved, no contract change to undo.

## Rollout
Released to `edge-staging` via Helm after human approval; edge gateway restarts on the new build (per CR-002 rollout spec).

## Definition of done
- AC-CR002-1 and AC-CR002-2 test cases pass; full AC-F05-1..5 regression suite green; code reviewed; deployed to `edge-staging` with gateway restart confirmed.
