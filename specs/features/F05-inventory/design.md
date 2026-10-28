# F05 · Spare-parts inventory tracking — Design

## Module structure
`edge/features/F05-inventory/index.js` exports `createInventory(parts?)`. Internal state (closure, not shared):
- `stock: Map<sku, { onHand, reserved, reorderPoint, reorderQty }>` seeded from `parts` arg.
- `reservations: Map<ref, { sku, qty }>` — one active reservation per WO ref.
- `requisitions: Map<reqId, { sku, qty, open }>` — at most one open per SKU.
- `reqSeq` counter for id generation.

Internal helpers (not exported): `assertKnownSku(sku)`, `availableQty(sku)`, `maybeRequisition(sku)` (checks reorder point, opens requisition if none open for that SKU), `closeRequisition(reqId)`.

Exported closure methods: `reserve`, `release`, `consume`, `receive`, `available`, `list`, `lowStock`, `requisitions`, `reservations`.

## Contract signatures
```
createInventory(parts?: Array<{ sku: string, onHand: number, reorderPoint: number, reorderQty: number }>) => {
  reserve(sku: string, qty: number, ref: string) => { ok: boolean, reserved: number, shortfall: number },
  release(ref: string) => void,
  consume(ref: string) => void,
  receive(reqId: string) => void,
  available(sku: string) => number,
  list() => Array<{ sku, onHand, reserved, available }>,
  lowStock() => Array<string>,          // SKUs at/below reorder point
  requisitions() => Array<{ reqId, sku, qty, open }>,
  reservations() => Array<{ ref, sku, qty }>
}
```
All SKU-accepting methods call `assertKnownSku` first (AC-F05-5).

## AC → design mapping
| AC | Design |
|---|---|
| AC-F05-1 | `reserve` computes `availableQty(sku)`; reserves `min(qty, available)`, sets `ok=false` and `shortfall = qty - reserved` when partial; never decrements below zero available. |
| AC-F05-2 | `release(ref)` looks up reservation, adds qty back to available (decrements `reserved`), deletes reservation entry. `consume(ref)` decrements `onHand` and `reserved` by reserved qty, deletes reservation, then calls `maybeRequisition`. |
| AC-F05-3 | `maybeRequisition(sku)` runs after `consume`/`reserve`; if `availableQty(sku) <= reorderPoint` and no open requisition exists for sku, creates one with `reorderQty`; otherwise no-op, guaranteeing singularity. |
| AC-F05-4 | `receive(reqId)` validates requisition open, adds `qty` to `onHand`, sets `open=false` via `closeRequisition`. |
| AC-F05-5 | `assertKnownSku` throws `Error` if sku absent from `stock` map; invoked by all SKU-facing entry points. |

## Security & data classification
- Data handled: part catalogue, stock levels and requisitions — classified **C1 Internal** (low impact if disclosed). Reservation `ref` is a work-order id only, no operator/technician names (org privacy standard).
- Storage: in-memory module state on the edge gateway only; no raw OT telemetry is read or written by this module.
- Read-only toward OT: this module never issues commands to OT devices/controllers; it only reflects WO-driven consumption passed in by the calling feature, consistent with strict read-only OT posture.
- Input validation: every method validates `sku` against known stock (throws otherwise); `qty` must be a finite positive number (reject NaN/Infinity, per IoT untrusted-input standard); unknown `ref`/`reqId` on `release`/`consume`/`receive` throw.

## Reused team decisions
- Module path/export fixed by rigel: `edge/features/F05-inventory/index.js` exporting `createInventory` (AC-F05-1..5).
- Contract shapes reused verbatim from upstream plan/spec.
- Security section structure (data class, storage, read-only OT, input validation) follows vega's standard pattern applied across F03/F05/F06.
- Privacy standard: identifiers are SKU/asset/WO ids only, never operator names.
