# CR-002 Impact Analysis — F05 Notification on Low Parts Count

## Summary
Adds a low-stock notification to F05 Spare-parts inventory tracking: when the inventory is viewed and any SKU's available quantity is below 5, a notification is surfaced. No existing behavior changes.

## Motivation
Operators currently discover low stock only via requisitions, not proactively. A visible alert at view-time raises awareness and reduces stall risk on work orders (per AC-CR002-1).

## Impact
**Changes** in `edge/features/F05-inventory/index.js`:
- The view/inspection path (backed by `list()`/`lowStock()`) is augmented so that calling it computes, for each SKU, whether `available(sku) < 5`, and emits a `notifications` array (or equivalent field) alongside existing output when threshold is breached.
- No new exported function; `createInventory` signature and existing methods (`reserve`, `release`, `consume`, `receive`, `available`, `list`, `lowStock`, `requisitions`, `reservations`) are unchanged in shape and semantics.

**Stays unchanged**:
- `createInventory(parts?)` contract shape.
- Reservation, release, consume, requisition, and receive logic and their negative-availability guarantees (AC-F05-1..4).
- Unknown SKU error behavior (AC-F05-5).
- Timestamps remain ISO-8601 UTC strings per org standard; numeric telemetry rounded to 3 decimals.

## Acceptance-criteria traceability

| AC ID | Description | Verification |
|---|---|---|
| AC-CR002-1 | Notification pops up when viewing inventory and a SKU's count is below 5 | New unit test: seed SKU below 5, call view/list, assert notification present; assert absent when ≥5 |
| AC-CR002-2 | Regression: AC-F05-1..5 unchanged | Full existing F05 test suite re-run, no modifications to assertions |
| AC-F05-1 | Reservations never drive availability negative; shortfall reported | Existing test suite, unchanged |
| AC-F05-2 | Release returns stock; reduces on-hand, clears reservation | Existing test suite, unchanged |
| AC-F05-3 | Exactly one open requisition per SKU at/below reorder point | Existing test suite, unchanged |
| AC-F05-4 | Receiving a requisition restocks and closes it | Existing test suite, unchanged |
| AC-F05-5 | Unknown SKUs throw | Existing test suite, unchanged |

## Risks & rollback
- Risk: notification computation could inadvertently mutate state or slow the view path — mitigated by keeping it a pure read derived from `available()`.
- Rollback: revert the single commit touching `index.js`; no schema/data migration involved, so rollback is safe and immediate.

## Rollout
Deployed to `edge-staging` via Helm after human approval; edge gateway restarts to load the new build. No feature flag; behavior change is additive and low-risk.

## Definition of done
- AC-CR002-1 and AC-CR002-2 pass.
- Full AC-F05-1..5 regression suite passes unchanged.
- Code review confirms `createInventory` contract shape untouched.
- Deployed to edge-staging, gateway restarted, smoke-tested.
