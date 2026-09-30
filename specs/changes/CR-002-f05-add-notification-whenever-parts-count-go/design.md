# CR-002 Design Delta — F05 Spare-parts inventory tracking

## Changed functions & internal state
No new exports, no new internal state (no counters, maps, or fields added). Two functions gain additive logic:

- **`list()`**: for each item, add a `notification` boolean computed as `available < 5`. Existing fields (`sku`, `onHand`, `reserved`, `available`) unchanged.
- **`lowStock()`**: unchanged filter (`available <= reorderPoint`), but each returned item now also carries the `notification` field from `list()`'s shape (derived inline, not from new state).

## Exact data shapes (changed return values)

`list()` → `Array<{ sku: string, onHand: number, reserved: number, available: number, notification: boolean }>`

`lowStock()` → same item shape as `list()`, filtered subset.

All other return shapes (`reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations`) are **unchanged**.

## AC → design mapping

- **AC-CR002-1** (notification pops up when viewing inventory, count < 5): satisfied by the new `notification` field on `list()`/`lowStock()` items, computed as `available(sku) < 5`. "Viewing the inventory" = calling `list()` or `lowStock()`; no new I/O, module stays pure/synchronous.
- **AC-CR002-2** (regression AC-F05-1..5 unchanged): guaranteed because `reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations`, `assertKnownSku`, `maybeRequisition` are untouched — reservation math, requisition lifecycle, and unknown-SKU throw behavior are byte-identical to the current module.

## Backward compatibility

`createInventory(parts?)` signature and returned method set are unchanged. Every caller depending on `list()`/`lowStock()` item shape continues to work: `notification` is an **additive** field, not a replacement or rename, so destructuring or property access on existing fields (`sku`, `onHand`, `reserved`, `available`, `reorderPoint`-derived filters) is unaffected. No caller of `reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations` is impacted since those functions are not touched.

## Security & data classification

Notification field carries the same data classification as existing inventory counts (operational/internal, non-sensitive part-count data) — no new data class introduced. No new storage location: notification is computed on-the-fly from in-memory `stock` state, never persisted. Module remains read-only toward OT: no new writes, no new I/O, purely derived view data. Input validation unchanged — `available(sku)` still throws via `assertKnownSku` on unknown SKUs, and the notification threshold (`< 5`) uses only already-validated in-memory quantities, no new external input surface.

## Reused team decisions
Threshold is hardcoded at `< 5` per CR-002, intentionally distinct from the per-SKU `reorderPoint` used by AC-F05-3 requisition logic. Notification is implemented purely within `edge/features/F05-inventory/index.js` with zero changes to the `createInventory` contract signature or existing method shapes.
