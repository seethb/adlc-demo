# F05 · Spare-parts inventory tracking — Plan

## Summary
Implements per-SKU inventory tracking with reservations, release/consume, automatic requisitions at reorder point, and receiving. Module: `edge/features/F05-inventory/index.js`, exporting `createInventory`.

## User stories
- As a maintenance planner, I want to reserve parts for a work order so that stock is held without going negative. (AC-F05-1)
- As a technician, I want to release or consume a reservation so that stock accurately reflects what was used or returned. (AC-F05-2)
- As a planner, I want a single open requisition per SKU when stock hits the reorder point so that I don't double-order. (AC-F05-3)
- As a store clerk, I want receiving a requisition to restock and close it so that inventory stays current. (AC-F05-4)
- As a system integrator, I want unknown SKUs to throw errors so that bad data is caught early. (AC-F05-5)

## AC traceability
| AC id | Covered by |
|---|---|
| AC-F05-1 | `reserve()` returns `{ ok, reserved, shortfall }`; never negative availability |
| AC-F05-2 | `release(ref)` and `consume(ref)` logic |
| AC-F05-3 | requisition dedup logic on `reserve`/`consume` when available ≤ reorder point |
| AC-F05-4 | `receive(reqId)` restocks and closes requisition |
| AC-F05-5 | SKU validation throws on all entry points |

## Contract
Exports: `createInventory`.
`createInventory(parts?) → { reserve(sku, qty, ref), release(ref), consume(ref), receive(reqId), available(sku), list(), lowStock(), requisitions(), reservations() }`.

## Dependencies
None.

## Non-goals
Multi-site stock; valuation.

## Risks
Long-lead parts (impellers, anti-surge valve trim) need visibility before the WO is raised; mitigated by `lowStock()`/`requisitions()` exposing open reorder state early.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay must never show negative availability. Telemetry and logs reference only SKU/asset ids and pseudonymous team ids, never operator or technician names, per org privacy standard. Timestamps ISO-8601 UTC; numeric values rounded to 3 decimals.

## Definition of done
All AC-F05-1..5 pass in `specs/features/F05-inventory.acceptance.test.js`; `createInventory` exported from `edge/features/F05-inventory/index.js`; no PII in telemetry/logs; design doc cross-referenced; reviewed by owner (rigel).
