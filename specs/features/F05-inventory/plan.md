# F05 · Spare-parts inventory tracking — Plan

## Summary
Track per-SKU on-hand, reserved and available inventory as work orders reserve, release, and consume parts, with automatic reorder requisitions and receiving, so stockouts are visible before they stall work orders.

## User stories
- As a maintenance planner, I want to reserve parts for a WO without ever going negative on availability, so that shortfalls are surfaced early. (AC-F05-1)
- As a technician, I want to release or consume a reservation, so that stock reflects actual usage. (AC-F05-2)
- As a purchasing agent, I want exactly one open requisition per SKU when stock hits reorder point, so that I don't double-order. (AC-F05-3)
- As a purchasing agent, I want receiving a requisition to restock and close it, so that inventory stays accurate. (AC-F05-4)
- As a system integrator, I want unknown SKUs to throw, so that bad data is caught early. (AC-F05-5)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F05-1 | Reservations never drive availability negative; shortfall reported | `reserve()` |
| AC-F05-2 | `release` returns stock; `consume` reduces on-hand, clears reservation | `release()`, `consume()` |
| AC-F05-3 | Exactly one open requisition per SKU at/below reorder point | `reserve()`/`consume()` triggering requisition logic |
| AC-F05-4 | Receiving a requisition restocks by quantity and closes it | `receive()` |
| AC-F05-5 | Unknown SKUs throw | all sku-taking methods |

## Contract
Export: `createInventory(parts?) → { reserve(sku, qty, ref), release(ref), consume(ref), receive(reqId), available(sku), list(), lowStock(), requisitions(), reservations() }`.
- `reserve` returns `{ ok, reserved, shortfall }`; never allows available < 0.
- `release(ref)` returns reserved qty to available.
- `consume(ref)` reduces on-hand and clears the reservation for `ref`.
- `receive(reqId)` restocks by the requisition's quantity and closes it.
- Any call referencing an unknown SKU throws.

## Dependencies
None.

## Non-goals
Multi-site stock; valuation.

## Risks
Long-lead parts (impellers, anti-surge valve trim) need visibility before the WO is raised; current scope only reacts at reorder point, not lead-time-adjusted.

## Telemetry & evals
Behavioural eval: replay a 6-fault scenario; assert availability never goes negative across all SKUs.

## Definition of done
- All AC-F05-1..5 covered by passing tests.
- `createInventory` exported from `edge/features/F05-inventory/index.js` matching contract.
- 6-fault replay eval passes with no negative availability.
- Reference impl (`edge/reference/inventory.js`) parity confirmed.
