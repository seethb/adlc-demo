# F05 · Spare-parts inventory tracking — Plan

## Summary
Tracks per-SKU on-hand, reserved and available quantities as work orders reserve, release and consume parts. Automatically raises a single open requisition when a SKU hits its reorder point, and restocks/closes it on receipt. Implemented in `edge/features/F05-inventory/index.js` exporting `createInventory`.

## User stories
- As a maintenance planner, I want reservations to fail gracefully with a reported shortfall instead of going negative, so that I know what's missing. (AC-F05-1)
- As a technician, I want to release or consume a reservation, so that stock levels reflect returned or used parts. (AC-F05-2)
- As a procurement coordinator, I want exactly one open requisition per low-stock SKU, so that I don't double-order. (AC-F05-3)
- As a warehouse clerk, I want receiving a requisition to restock and close it automatically, so that inventory stays accurate. (AC-F05-4)
- As a system integrator, I want unknown SKUs to throw, so that bad data is caught early. (AC-F05-5)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F05-1 | Reservations never drive availability negative; shortfall reported | `reserve()` |
| AC-F05-2 | `release` returns stock; `consume` reduces on-hand, clears reservation | `release()`, `consume()` |
| AC-F05-3 | Exactly one open requisition per SKU at/below reorder point | `reserve()`/`consume()` triggering requisition logic |
| AC-F05-4 | Receiving a requisition restocks qty and closes it | `receive()` |
| AC-F05-5 | Unknown SKUs throw | all SKU-accepting methods |

## Contract
Exports: `createInventory`.

```
createInventory(parts?) → {
  reserve(sku, qty, ref): { ok, reserved, shortfall },
  release(ref),
  consume(ref),
  receive(reqId),
  available(sku),
  list(),
  lowStock(),
  requisitions(),
  reservations()
}
```

## Dependencies
None.

## Non-goals
Multi-site stock tracking; inventory valuation.

## Risks
Long-lead parts (e.g. impellers, anti-surge valve trim) need visibility before the work order is raised; reorder-point logic alone may not surface lead-time risk.

## Telemetry & evals
- Behavioural eval: 6-fault scenario replay must never show negative availability (AC-F05-1).
- Telemetry and logs reference only SKU/asset ids and pseudonymous team ids, never operator or technician names, per org privacy standard.
- Numeric telemetry rounded to 3 decimals; timestamps ISO-8601 UTC.

## Definition of done
- `createInventory` implemented and exported from `edge/features/F05-inventory/index.js`.
- All AC-F05-1..5 covered by passing tests in `specs/features/F05-inventory.acceptance.test.js`.
- No negative availability in behavioural replay eval.
- No PII/operator names in telemetry or logs.
