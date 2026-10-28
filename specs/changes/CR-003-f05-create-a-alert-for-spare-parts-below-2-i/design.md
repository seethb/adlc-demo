# CR-003 Design Delta — Spare-parts alert below 2 items

## Changed functions & internal state
No new internal state (no new Maps/counters). Changes are computation-only:

- `list()` — each item gains a new field `alert: boolean`, computed as `avail < 2`, independent of `low` (reorder-point flag, untouched, unaffected by CR-002's sub-5 notify field if present).
- `lowStock()` unchanged in signature; still filters on `low`. New alert visibility is via `list()`/new `alerts()`.
- New exported function `alerts()`: returns SKUs currently below 2 items, re-derived live from `list()` on every call — no caching, no mutation hooks needed in `reserve`/`release`/`consume`/`receive` since all read current `onHand`/`reserved` at call time.

## Exact data shapes
`list()` item (changed):
```
{ sku, name, onHand, reserved, available, reorderPoint, leadTimeDays, low: boolean, alert: boolean }
```
`alerts()` (new):
```
Array<{ sku, name, available, reorderPoint, leadTimeDays }>
```
filtered from `list()` where `available < 2`.

`lowStock()` (unchanged shape): `Array<item>` filtered on `low`.

## AC → design mapping
- **AC-CR003-1** (below 2 items alerted): satisfied by `alert: avail < 2` in `list()` and by new `alerts()` function recomputed after every `reserve`, `release`, `consume`, `receive` call since it reads live state, not a snapshot.
- **AC-CR003-2** (regression AC-F05-1..5): `reserve`, `release`, `consume`, `receive`, `available`, SKU validation, requisition logic (`maybeRequisition`, `threshold`) are byte-for-byte unchanged; only `list()` gains an additive field and `alerts()` is a new pure derived function. Full F05 suite reruns unchanged.

## Backward compatibility
`createInventory(parts?)` signature and all existing return shapes of `reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations` are untouched. `list()` is additive-only (`alert` field appended); callers destructuring known fields are unaffected. `lowStock()` behavior and filter criteria (`low`) unchanged — CR-003's threshold is deliberately separate from reorder-point `low` per CR-003 plan, avoiding conflation. New `alerts()` export is additive; no existing caller is required to use it.

## Security & data classification
Inventory counts remain **operational/internal** classification, no PII or credentials. Module stays pure ES (no I/O, no network), consistent with the read-only-toward-OT posture — this module tracks spares metadata, never writes to OT devices. Any future transport of `alerts()` output to a gateway dashboard must use mutual TLS 1.2+ over MQTT 8883 with per-device X.509 identity, per org IoT security standard; no credentials are embedded in this module.

## Reused team decisions
- AC-F05-5 unknown-SKU-throws behavior (Atlas) preserved unchanged.
- `available = onHand - reserved` formula (MRO spare-parts policy) reused for the new alert threshold.
- CR-002's precedent of adding a derived low-stock-style field without changing `createInventory`'s contract shape is followed here for `alert`/`alerts()`.
