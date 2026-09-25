# F05 · Spare-parts inventory tracking — Design

## Module structure
`edge/features/F05-inventory/index.js`, pure ES module, no third-party deps (per org standard).

Internal state, held in closure over `parts` seed:
- `stock: Map<sku, { onHand, reserved, reorderPoint }>`
- `reservationsMap: Map<ref, { sku, qty }>`
- `requisitionsMap: Map<reqId, { sku, qty, open: true }>`
- `reqCounter` for id generation.

Functions:
- `assertKnownSku(sku)` — throws `Error('unknown sku: ' + sku)` if not in `stock`.
- `available(sku)` — `onHand - reserved`.
- `maybeRequisition(sku)` — internal helper called after `reserve`/`consume`; if `available(sku) <= reorderPoint` and no open requisition exists for that sku, creates one (qty = reorderPoint - available, min 1).
- `reserve(sku, qty, ref)` — validates sku, computes shortfall = `max(0, qty - available(sku))`; reserves `qty - shortfall`; updates `reserved`; records reservation keyed by `ref`; calls `maybeRequisition`; returns `{ ok: shortfall === 0, reserved: qty - shortfall, shortfall }`.
- `release(ref)` — looks up reservation, decrements `reserved` by qty, deletes reservation. No-op if ref unknown.
- `consume(ref)` — looks up reservation, decrements both `onHand` and `reserved` by qty, deletes reservation, calls `maybeRequisition`.
- `receive(reqId)` — looks up requisition, adds qty to `onHand` for its sku, marks requisition closed (removed from open set).
- `list()` — returns array of `{ sku, onHand, reserved, available }` snapshots.
- `lowStock()` — returns skus where `available(sku) <= reorderPoint`.
- `requisitions()` — returns array of open requisitions `{ id, sku, qty }`.
- `reservations()` — returns array of `{ ref, sku, qty }`.

## Contract signatures
```
createInventory(parts?: Array<{ sku: string, onHand: number, reorderPoint: number }>)
→ {
  reserve(sku: string, qty: number, ref: string): { ok: boolean, reserved: number, shortfall: number },
  release(ref: string): void,
  consume(ref: string): void,
  receive(reqId: string): void,
  available(sku: string): number,
  list(): Array<{ sku, onHand, reserved, available }>,
  lowStock(): Array<string>,
  requisitions(): Array<{ id, sku, qty }>,
  reservations(): Array<{ ref, sku, qty }>
}
```

## AC → design mapping
| AC id | Design element |
|---|---|
| AC-F05-1 | `reserve()` clamps to `available(sku)`, computes shortfall, never lets `available` go negative |
| AC-F05-2 | `release()` decrements `reserved` only; `consume()` decrements `onHand` and `reserved` and deletes reservation |
| AC-F05-3 | `maybeRequisition()` checks for an existing open requisition per sku before creating a new one |
| AC-F05-4 | `receive(reqId)` adds qty to `onHand` and removes requisition from open set |
| AC-F05-5 | `assertKnownSku()` called at entry of every sku-accepting method, throws on unknown sku |

## Security & data classification
Stock levels, reservations and requisitions are **C1 internal** (per org data classification: "part catalogue and stock levels" is explicitly C1). Work-order references embedded in reservations may reveal maintenance activity classified **C2**; treat `ref` strings as opaque and avoid logging raw WO content beyond the ref id. This module is edge-resident, pure computation with no network/OT I/O — it is inherently read-only towards OT (no PLC/OPC-UA writes), consistent with the advisory nature of requisitions/work orders. Input validation: every sku-taking call rejects unknown skus (throw), quantities must be finite numbers (reject NaN/Infinity per telemetry-untrusted-input standard) before mutating state.

## Reused team decisions
- Data classification model (C0–C3) from `specs/02-design/security.md` applied: stock levels are C1.
- Edge analytics read-only towards OT — this module never writes to PLC/OPC-UA, only advisory requisitions/reservations.
- No third-party dependencies added, per firmware/edge module standard.
- Untrusted-input rejection pattern (reject non-finite values, unknown ids) reused for sku/qty validation.
