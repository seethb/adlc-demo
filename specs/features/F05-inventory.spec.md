---
id: F05
slug: F05-inventory
title: Spare-parts inventory tracking
owner: rigel
priority: must
depends: []
module: edge/features/F05-inventory/index.js
reference: edge/reference/inventory.js
exports: createInventory
---

# F05 · Spare-parts inventory tracking

## Problem
Work orders stall because the part is not on the shelf, and nobody knew stock was low.
Reservations, consumption and reorder must be tracked as work orders move.

## Scope
Per-SKU on-hand, reserved and available quantities; reservations by WO reference;
release and consume; automatic purchase requisitions at the reorder point; receipt.

**Non-goals:** multi-site stock, valuation.

## Contract
`createInventory(parts?)` → `{ reserve(sku, qty, ref): { ok, reserved, shortfall }, release(ref),
consume(ref), receive(reqId), available(sku), list(), lowStock(), requisitions(), reservations() }`.

## Acceptance criteria
- **AC-F05-1** Reservations never drive availability negative; the shortfall is reported.
- **AC-F05-2** `release` returns stock; `consume` reduces on-hand and clears the reservation.
- **AC-F05-3** Exactly one open requisition per SKU once available ≤ reorder point.
- **AC-F05-4** Receiving a requisition restocks by its quantity and closes it.
- **AC-F05-5** Unknown SKUs throw.

## Telemetry & evals
Behavioural eval: a 6-fault scenario replay never shows negative availability.

## Risks
Long-lead parts (impellers, anti-surge valve trim) need visibility before the WO is raised.
