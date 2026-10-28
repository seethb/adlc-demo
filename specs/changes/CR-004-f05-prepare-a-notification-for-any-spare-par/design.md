# CR-004 Design Delta — F05 notification for parts count < 10

## Changed functions / internal state
- `list(sku)` (via `list()` entries): add field `alerts` (array) replacing/extending any prior single-flag approach. Each entry now carries three independent boolean tiers: `lowStockAlert` (<10, new, AC-CR004), `criticalAlert` (<5, CR-002), `severeAlert` (<2, CR-003). Existing `low` (reorder-threshold flag from CR-001) is unchanged.
- New pure helper `computeAlertTiers(avail)` → `{ lowStockAlert: avail < 10, criticalAlert: avail < 5, severeAlert: avail < 2 }`, called from `list()` for every SKU. No mutation, no new Map; stateless derivation from `onHand - reserved`.
- `lowStock()` unchanged in signature; now also includes items where only `lowStockAlert` is true (i.e., broadens membership, since it already filters on `i.low` from CR-001 — CR-004 adds `i.lowStockAlert` to the filter predicate: `i.low || i.lowStockAlert`).
- No new exported function; no new Maps; reservation/requisition/receive logic untouched.

## Exact data shapes (changed returns)
`list()` item:
```js
{ sku, name, onHand, reserved, available, reorderPoint, leadTimeDays,
  low: boolean,              // CR-001 reorder threshold
  lowStockAlert: boolean,    // CR-004: available < 10
  criticalAlert: boolean,    // CR-002: available < 5
  severeAlert: boolean       // CR-003: available < 2
}
```
`lowStock()` → `Array<list-item>` filtered by `low || lowStockAlert || criticalAlert || severeAlert`.

## AC → design mapping
- **AC-CR004-1**: `computeAlertTiers` sets `lowStockAlert = available < 10`, surfaced via `list()`/`lowStock()`; tested at available=9 (true) and available=10 (false).
- **AC-CR004-2**: `reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations` bodies unchanged; `createInventory` signature unchanged; full AC-F05-1..5 regression suite re-run unmodified.

## Backward compatibility
`createInventory(parts?)` signature and returned method set (`reserve, release, consume, receive, available, list, lowStock, requisitions, reservations`) unchanged. `list()`/`lowStock()` items gain additive fields only (`lowStockAlert`); existing consumers reading `low`, `onHand`, `available`, etc. are unaffected. CR-002 (`criticalAlert`) and CR-003 (`severeAlert`) callers continue to read their respective fields unchanged.

## Security & data classification
Alert tiers are derived in-memory from existing operational (non-PII, non-secret) inventory counts — same classification as CR-002/CR-003. No new storage, no outbound transport added; module remains pure/no-I/O. Read-only toward OT: no new writes to physical assets, only internal derived state exposed via existing getters.

## Reused team decisions
Builds directly on CR-002's and CR-003's established pattern of additive boolean alert fields on `list()`/`lowStock()` rather than new exports, keeping `createInventory` contract stable per Rigel/Sentinel/Vega's recorded F05 design constraints.
