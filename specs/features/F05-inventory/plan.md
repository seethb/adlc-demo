# F05 · Spare-parts inventory tracking — Plan

## Summary
Tracks per-SKU on-hand/reserved/available inventory tied to work orders, with reservation, release, consume, automatic reorder requisitions, and receiving. Implemented in `edge/features/F05-inventory/index.js` exporting `createInventory`.

## User stories
- As a technician, I want to reserve parts for a work order so that stock is set aside for me. (AC-F05-1, AC-F05-5)
- As a technician, I want to release or consume a reservation so that stock is returned or accurately drawn down. (AC-F05-2, AC-F05-5)
- As a planner, I want a purchase requisition raised automatically when stock hits reorder point so that I never miss reordering. (AC-F05-3)
- As a planner, I want receiving a requisition to restock and close it so that inventory reflects reality. (AC-F05-4)
- As a planner, I want unknown SKUs rejected so that bad data never enters the system. (AC-F05-5)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F05-1 | Reservations never drive availability negative; shortfall reported | `reserve()` |
| AC-F05-2 | `release` returns stock; `consume` reduces on-hand and clears reservation | `release()`, `consume()` |
| AC-F05-3 | Exactly one open requisition per SKU once available ≤ reorder point | `reserve()`/`consume()` reorder check |
| AC-F05-4 | Receiving a requisition restocks by its quantity and closes it | `receive()` |
| AC-F05-5 | Unknown SKUs throw | validation in all methods taking a SKU |

## Contract
`createInventory(parts?)` → `{ reserve(sku, qty, ref): { ok, reserved, shortfall }, release(ref), consume(ref), receive(reqId), available(sku), list(), lowStock(), requisitions(), reservations() }`. Exports: `createInventory`.

## Dependencies
None.

## Non-goals
Multi-site stock; valuation.

## Risks
Long-lead parts (impellers, anti-surge valve trim) need visibility before the WO is raised; mitigate via `lowStock()`/`requisitions()` surfaced in dashboards.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay must never show negative availability. Sentinel test report (2026-09-25) confirmed 5/5 acceptance tests passed, 0 negative availability states, 0 duplicate requisitions across 500 random operations. No operator/technician names in telemetry, only asset/SKU ids, per privacy standard.

## Definition of done
All AC-F05-1..5 pass via automated tests; behavioural eval shows zero negative-availability events across a 6-fault replay; `createInventory` contract matches spec exactly; no PII in code, logs, or telemetry.
