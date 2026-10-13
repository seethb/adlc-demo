# F05 · Spare-parts inventory tracking — Plan

## Summary
Track per-SKU on-hand, reserved and available spare-parts stock as work orders reserve, release, or consume parts, and automatically raise/close purchase requisitions at the reorder point.

## User stories
- As a maintenance planner, I want to reserve parts against a work order without ever letting availability go negative, so that I can trust stock numbers. (AC-F05-1)
- As a technician, I want to release or consume a reservation, so that stock reflects real usage. (AC-F05-2)
- As a planner, I want exactly one open requisition per SKU when stock hits the reorder point, so that duplicate orders aren't raised. (AC-F05-3)
- As a storeroom clerk, I want receiving a requisition to restock and close it, so that inventory stays accurate. (AC-F05-4)
- As a developer, I want unknown SKUs to throw, so that bad data is caught early. (AC-F05-5)

## Acceptance criteria traceability
| AC id | Covered by |
|---|---|
| AC-F05-1 | `reserve` caps reservations to available stock, returns shortfall |
| AC-F05-2 | `release`/`consume` implementations |
| AC-F05-3 | reorder-point check, single open requisition per SKU |
| AC-F05-4 | `receive(reqId)` restocks and closes requisition |
| AC-F05-5 | SKU existence validation on all entry points |

## Contract
`createInventory(parts?)` → `{ reserve(sku, qty, ref): { ok, reserved, shortfall }, release(ref), consume(ref), receive(reqId), available(sku), list(), lowStock(), requisitions(), reservations() }`
Exports: `createInventory`.

## Dependencies
None.

## Non-goals
Multi-site stock; valuation.

## Risks
Long-lead parts (impellers, anti-surge valve trim) need visibility before the WO is raised; mitigated by `lowStock()`/`requisitions()` surfacing open reorders early.

## Telemetry & evals
Behavioural eval: a 6-fault scenario replay never shows negative availability (ties to AC-F05-1). All telemetry/log entries reference SKU/asset ids and pseudonymous team ids only, never operator or technician names, per org privacy standard. Timestamps are ISO-8601 UTC; numeric values rounded to 3 decimals.

## Definition of done
- `edge/features/F05-inventory/index.js` exports `createInventory` matching the contract.
- All AC-F05-1..5 pass in `specs/features/F05-inventory.acceptance.test.js`.
- 6-fault replay eval shows no negative availability.
- No PII/operator names in logs or telemetry.
