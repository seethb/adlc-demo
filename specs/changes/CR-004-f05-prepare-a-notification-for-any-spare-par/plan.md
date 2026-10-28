# CR-004 Impact Analysis — Spare-parts notification below 10 parts (F05)

## Summary
Adds a notification when any SKU's available count drops below 10, layered on top of existing CR-002 (<5) and CR-003 (<2) alerts in `edge/features/F05-inventory/index.js`. No contract changes.

## Motivation
Maintain reorder quantity visibility and track inventory performance by surfacing an early warning tier before stock hits the more urgent CR-002/CR-003 thresholds, giving planners more lead time.

## Impact
**Changes:**
- Internal alert-evaluation logic extended with a third tier: `available < 10` → emit/queue a "low-stock notification" (distinct from the <5 and <2 alerts), evaluated after every `reserve`, `release`, `consume`, `receive` mutation.
- Notification state exposed via existing introspection pattern established by CR-002/CR-003 (e.g. appended to `lowStock()` or an internal notifications list), not a new exported function.

**Stays unchanged:**
- `createInventory(parts?)` signature and all returned methods: `reserve`, `release`, `consume`, `receive`, `available`, `list`, `lowStock`, `requisitions`, `reservations`.
- Reservation, release, consume, requisition, and receive core behaviors (AC-F05-1..5).
- CR-002 (<5) and CR-003 (<2) alert behaviors remain intact and independently triggered.

## Acceptance-criteria traceability

| AC | Description | Verification |
|---|---|---|
| AC-CR004-1 | Notification fires when a part's count is less than 10 | Unit test: reduce SKU to 9 via reserve/consume, assert notification present; at 10 assert absent |
| AC-CR004-2 | Regression: AC-F05-1..5 unchanged | Full F05 regression suite re-run, no modified expectations |
| AC-F05-1 | Reservations never drive availability negative; shortfall reported | Existing regression test |
| AC-F05-2 | Release returns stock, clears reservation | Existing regression test |
| AC-F05-3 | Exactly one open requisition per SKU at/under reorder point | Existing regression test |
| AC-F05-4 | Receiving restocks and closes requisition | Existing regression test |
| AC-F05-5 | Unknown SKUs throw | Existing regression test |

## Risks & rollback
Risk: overlapping thresholds (10/5/2) could cause duplicate or conflicting notifications — mitigate by keeping tiers independent and additive, not replacing prior alerts. Rollback: redeploy prior build via Helm; no data migration since no persisted schema changes.

## Rollout
Released to `edge-staging` via Helm after human approval; edge gateway restarts on the new build, consistent with CR-002/CR-003 rollout pattern.

## Definition of done
- Code updated in `edge/features/F05-inventory/index.js` with <10 tier notification.
- New test covers AC-CR004-1; full regression suite (AC-F05-1..5, CR-002, CR-003) passes.
- Deployed to edge-staging, gateway restarted, verified.
