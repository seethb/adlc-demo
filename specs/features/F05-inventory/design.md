# F05 · Spare-parts inventory tracking — Design

## Module structure (`edge/features/F05-inventory/index.js`)

**Internal state** (closure, not exported):
- `catalog: Map<sku, { onHand, reserved, reorderPoint, reorderQty }>` seeded from `parts` arg.
- `reservations: Map<ref, { sku, qty }>` — open reservations keyed by WO reference.
- `requisitions: Map<reqId, { sku, qty, status: 'open'|'closed' }>` plus `openReqBySku: Map<sku, reqId>` to enforce one open requisition per SKU.
- `nextReqId`: monotonically incrementing counter.

**Internal helpers** (not exported):
- `assertKnownSku(sku)` — throws if `sku` not in catalog (AC-F05-5).
- `availableOf(sku)` — returns `onHand - reserved`.
- `maybeRequisition(sku)` — opens a requisition if `availableOf(sku) <= reorderPoint` and none open.

**Exported factory**: `createInventory(parts)` returns the object below; no module-level mutable state — each call yields an isolated instance.

## Contract signatures

```
createInventory(parts?: Array<{ sku: string, onHand: number, reorderPoint: number, reorderQty: number }>)
  → {
    reserve(sku: string, qty: number, ref: string): { ok: boolean, reserved: number, shortfall: number },
    release(ref: string): void,
    consume(ref: string): void,
    receive(reqId: string|number): void,
    available(sku: string): number,
    list(): Array<{ sku, onHand, reserved, available }>,
    lowStock(): Array<{ sku, available, reorderPoint }>,
    requisitions(): Array<{ reqId, sku, qty, status }>,
    reservations(): Array<{ ref, sku, qty }>
  }
```

All functions validate `sku`/`ref`/`reqId` existence before mutating state; unknown references throw `Error`.

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F05-1 | `reserve` computes `shortfall = max(0, qty - availableOf(sku))`, reserves only `qty - shortfall`, never lets `reserved > onHand` |
| AC-F05-2 | `release(ref)` decrements `reserved` and deletes reservation entry; `consume(ref)` decrements both `onHand` and `reserved` by reserved qty, deletes entry, then calls `maybeRequisition` |
| AC-F05-3 | `maybeRequisition` checks `openReqBySku` before inserting; invoked after `reserve`/`consume` state changes |
| AC-F05-4 | `receive(reqId)` adds `requisitions.get(reqId).qty` to `onHand`, sets status `closed`, removes from `openReqBySku` |
| AC-F05-5 | `assertKnownSku` called in `reserve`, `available`; `release`/`consume` validate `ref` exists; `receive` validates `reqId` exists |

## Security & data classification
Inventory data (SKU, quantities, reorder thresholds) is **C1 Internal** per the org data classification standard — low impact if disclosed, may live on edge gateway storage and be synced to cloud/Meko without extra encryption-at-rest beyond standard controls. The module never touches OT control paths: it has no network or MQTT client and is purely in-memory/read computation on data it owns — it is not merely read-only toward OT, it has zero OT dependency. All quantities are validated as finite non-negative numbers (reject NaN/Infinity per IoT standard, applied here as general input hygiene); unknown SKU/ref/reqId values throw rather than silently defaulting. No operator or technician identity is accepted or stored anywhere in this module, only SKU and WO reference strings, per the org privacy standard.

## Reused team decisions
- Followed `createInventory` exact contract shape recalled from plan/spec, unmodified.
- Applied C1 classification for stock levels per the security-design data classification memory.
- Enforced read-only-toward-OT / no-OT-dependency posture as required for all F0x modules.
- Applied org privacy standard: no operator/technician names, only SKU and WO refs.
