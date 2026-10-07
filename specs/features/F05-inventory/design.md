# F05 · Spare-parts inventory tracking — Design

## Module structure
File: `edge/features/F05-inventory/index.js`, pure ES module, exports `createInventory`.

Internal state (closure, in-memory):
- `parts: Map<sku, { onHand, reserved, reorderPoint }>` seeded from optional `parts` arg.
- `reservations: Map<ref, { sku, qty }>`.
- `requisitions: Map<reqId, { sku, qty, open }>` — at most one open per sku.
- `reqSeq` counter for requisition ids.

Internal helpers (not exported): `assertKnownSku(sku)`, `availableOf(sku)`, `maybeRequisition(sku)` (checks reorder point, opens requisition if none open for sku), `nextReqId()`.

Exported factory `createInventory` returns object with: `reserve`, `release`, `consume`, `receive`, `available`, `list`, `lowStock`, `requisitions`, `reservations`.

## Contract signatures

```
createInventory(parts?: Array<{ sku: string, onHand: number, reorderPoint: number }>) 
  → Inventory

Inventory.reserve(sku: string, qty: number, ref: string)
  → { ok: boolean, reserved: number, shortfall: number }

Inventory.release(ref: string) → void
Inventory.consume(ref: string) → void
Inventory.receive(reqId: string) → void
Inventory.available(sku: string) → number
Inventory.list() → Array<{ sku, onHand, reserved, available }>
Inventory.lowStock() → Array<{ sku, available, reorderPoint }>
Inventory.requisitions() → Array<{ reqId, sku, qty, open }>
Inventory.reservations() → Array<{ ref, sku, qty }>
```

All `sku`/`ref`/`reqId` are non-empty strings; `qty` is a finite positive number.

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F05-1 | `reserve` computes `availableOf(sku)`; reserves `min(qty, available)`; `shortfall = qty - reserved`; `reserved` field on part only incremented by actual reserved amount, never driving available below 0 |
| AC-F05-2 | `release(ref)` decrements part's `reserved` by the reservation qty and deletes it; `consume(ref)` decrements `onHand` and `reserved` by the reservation qty, deletes reservation, then calls `maybeRequisition(sku)` |
| AC-F05-3 | `maybeRequisition(sku)` checks `requisitions` map for any open entry for sku before creating a new one; invoked after `reserve`/`consume` when `availableOf(sku) <= reorderPoint` |
| AC-F05-4 | `receive(reqId)` looks up requisition, throws if missing/already closed, adds `qty` to `onHand`, sets `open = false` |
| AC-F05-5 | `assertKnownSku` called at top of `reserve`/`available`; `release`/`consume`/`receive` validate ref/reqId existence and throw `Error` on unknown sku, ref, or reqId |

## Security & data classification
- Data handled is **C1 Internal** (part catalogue and stock levels) per org classification — no telemetry/PII, no C2/C3 process data.
- State lives only in edge-process memory; no cloud sync in this module, no persistence to disk mandated by this design.
- Module is **read-only toward OT**: it never issues commands or writes to control systems; inputs come from work-order/store events only, not live OT telemetry paths.
- Input validation: every entry point validates sku against known parts map (AC-F05-5), rejects non-finite/non-positive `qty`, rejects empty/unknown `ref`/`reqId`, and throws synchronously — no silent coercion of malformed input, consistent with org guidance to treat untrusted input strictly.
- No operator/technician names are stored or logged; only sku and work-order `ref` ids, per privacy standard.

## Reused team decisions
- Followed recalled contract shape for `createInventory` exactly as specified by rigel/atlas (same function names and signature).
- Applied org C0–C3 data classification scheme; F05 data classified C1.
- Applied org privacy standard: no technician/operator names, only ids.
- Applied org IoT security posture: treat all external input as untrusted, validate strictly, enforce read-only toward OT.
