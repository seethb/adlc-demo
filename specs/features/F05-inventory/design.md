# F05 · Spare-parts inventory tracking — Design

## Module structure (`edge/features/F05-inventory/index.js`)

Internal state (closure, in-memory, per-process, not persisted to OT):
- `stock: Map<sku, { onHand, reserved, reorderPoint, reorderQty }>` seeded from `parts` arg.
- `reservationsBySku: Map<sku, Map<ref, qty>>` — active reservations keyed by WO ref.
- `openRequisitions: Map<sku, { reqId, qty, sku }>` — at most one per SKU.
- `reqSeq: number` — counter for generating `reqId`.

Internal helpers (not exported):
- `assertKnownSku(sku)` — throws if `sku` not in `stock` (AC-F05-5).
- `availableQty(sku)` — `onHand - reserved`.
- `maybeRequisition(sku)` — creates a requisition iff `availableQty(sku) <= reorderPoint` and none open for that SKU (AC-F05-3).
- `findReservation(ref)` — locates sku/qty for a WO ref, throws if unknown ref.

## Contract: `createInventory(parts?)`

Input `parts` (optional array): `[{ sku: string, onHand: number, reorderPoint: number, reorderQty: number }]`.

Returns:
```
{
  reserve(sku, qty, ref) -> { ok: boolean, reserved: number, shortfall: number }
  release(ref) -> void
  consume(ref) -> void
  receive(reqId) -> void
  available(sku) -> number
  list() -> [{ sku, onHand, reserved, available }]
  lowStock() -> [{ sku, available, reorderPoint }]
  requisitions() -> [{ reqId, sku, qty }]
  reservations() -> [{ ref, sku, qty }]
}
```
All sku-taking methods call `assertKnownSku` first. `reserve` caps `reserved` at `onHand` (never negative available); `shortfall = max(0, qty - grantedQty)`.

## AC → design mapping

| AC | Design |
|---|---|
| AC-F05-1 | `reserve()` computes `grant = min(qty, onHand - reserved)`, increments `reserved` by `grant` only, returns `shortfall = qty - grant`; availability never below 0. |
| AC-F05-2 | `release(ref)` looks up reservation, decrements `reserved` by its qty, deletes entry. `consume(ref)` decrements both `onHand` and `reserved` by the reserved qty, deletes entry, then calls `maybeRequisition`. |
| AC-F05-3 | `maybeRequisition(sku)` guarded by `openRequisitions.has(sku)` check; invoked after `reserve`/`consume` mutate stock, ensuring exactly one open requisition per SKU. |
| AC-F05-4 | `receive(reqId)` finds requisition, adds its `qty` to `onHand`, removes it from `openRequisitions` (closes it). |
| AC-F05-5 | Every method accepting a `sku` or `ref` runs `assertKnownSku`/`findReservation` first and throws `Error` on miss. |

## Security & data classification
- Data class: **C1 Internal** (part catalogue and stock levels), per org classification table — no PII, no OT control data.
- Storage: edge in-memory only; may be persisted to internal C1 stores, never to public/C0 surfaces; never sent as raw OT control data.
- Read-only toward OT: this module only tracks logical inventory counters; it issues no commands to OT/PLC equipment and has no write path into control systems.
- Input validation: reject unknown SKUs and unknown reservation refs (throw); reject non-finite/negative quantities; `reserve` qty must be a positive finite number; no operator/technician names accepted anywhere — only asset/SKU/WO ids, per privacy standard.

## Reused team decisions
- Followed vega's recalled requirement to detail module structure (functions, helpers, state) and exact `createInventory` I/O shapes.
- Applied vega's security/classification pattern (data class, storage location, OT read-only, input validation) as used for F03/F04/F06.
- Used org data-classification table: part catalogue/stock levels = C1 Internal.
- Applied org privacy standard: only asset/SKU/WO ids referenced, never operator names.
