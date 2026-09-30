# CR-002 Impact Analysis — F05 Notification on Low Stock

## Summary
Adds a low-stock notification, surfaced whenever inventory is viewed and any SKU's availability is below 5, to F05 "Spare-parts inventory tracking".

## Motivation
Operators need an immediate alert signal to act on shortages, rather than discovering low stock only via `lowStock()` polling by other systems.

## Impact
**Changes in `edge/features/F05-inventory/index.js`:**
- `list()` and `available(sku)` (the "look at inventory" read paths) must compute a `notifications` array/flag for any SKU with `available < 5`, e.g. `{ sku, available, message }`.
- Threshold `5` is a fixed constant, independent of each SKU's `reorderPoint` (which drives requisitions, AC-F05-3) — notification logic is additive and must not alter requisition creation.
- `createInventory` contract gains an additive return field (e.g. `notifications()` or a `notifications` key on `list()` output); no existing field is removed or renamed.

**Stays unchanged:**
- `reserve`, `release`, `consume`, `receive`, `requisitions`, `reservations`, `lowStock` behavior and signatures.
- Reorder-point/requisition logic (AC-F05-3, AC-F05-4).
- SKU validation (AC-F05-5).

## Acceptance-criteria traceability

| AC id | Description | Verification |
|---|---|---|
| AC-CR002-1 | Notification pops up when inventory viewed and count < 5 | New test: seed SKU with available < 5, call `list()`/`available()`, assert notification present |
| AC-CR002-2 | Regression: AC-F05-1..5 unchanged | Existing F05 suite reruns unmodified, must be 5/5 pass |
| AC-F05-1 | Reservations never negative; shortfall reported | Existing test, `reserve('A',7,'WO-1')` → `ok:false` |
| AC-F05-2 | Release/consume adjust stock, clear reservation | Existing test |
| AC-F05-3 | Exactly one open requisition per SKU at ≤ reorderPoint | Existing test |
| AC-F05-4 | Receiving restocks and closes requisition | Existing test |
| AC-F05-5 | Unknown SKUs throw | Existing test |

## Risks & rollback
Risk: notification threshold (5) hard-coded, may misalign with per-SKU `reorderPoint` for SKU B (reorderPoint 1), producing noisy alerts. Mitigation: document as intentional per CR wording. Rollback: revert `index.js` to prior commit; contract change is additive so no downstream break expected.

## Rollout
Deploy to `edge-staging` via Helm after human approval; edge gateway restarts to load the new build, per CR-002 rollout instructions.

## Definition of done
- AC-CR002-1 and AC-CR002-2 automated tests added and passing.
- Full F05 regression suite (AC-F05-1..5) green, 5/5.
- Deployed to edge-staging, gateway restarted, notification observed live.
