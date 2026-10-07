# Design Delta — CR-001 (F05 Expedite Long-Lead Critical Spares)
Target: `edge/features/F05-inventory/index.js`

## Changed functions & internal state
- `isLongLead(s)` (new helper): `s.leadTimeDays >= 14`.
- `threshold(s)` (new helper): `s.reorderPoint + (isLongLead(s) ? 1 : 0)`. Single source of truth for reorder trigger and `low`.
- `maybeRequisition(sku)`: trigger condition changed to `avail <= threshold(s)`; requisition object now includes `priority`, `etaDays`, `reason`, derived from `isLongLead`.
- `createInventory(parts)`: after populating `stock`, loop calls `maybeRequisition(sku)` for every SKU so already-short parts get an open requisition at construction time.
- `list()`: adds `low: avail <= threshold(s)` field alongside existing part-master fields.
- No change to internal `Map` shapes (`stock`, `reservationsMap`, `requisitionsMap`) beyond the three new requisition fields.

## Data shapes
`requisitions()` item:
```
{ id, sku, qty, status: 'open'|'received',
  priority: 'expedite'|'normal',
  etaDays: number,
  reason: 'critical-spare-early-reorder'|'reorder-point' }
```
`list()` item:
```
{ sku, name, onHand, reserved, available, reorderPoint, leadTimeDays,
  low: boolean, notification: boolean }
```
(`notification`, from CR-002, unchanged.)

## AC → design mapping
- **AC-CR001-1**: `threshold()` + `isLongLead()` gate `maybeRequisition`; long-lead fires at `reorderPoint+1`, others at `reorderPoint`.
- **AC-CR001-2**: `maybeRequisition` sets `priority`/`etaDays`/`reason` from `isLongLead(s)`.
- **AC-CR001-3**: post-construction loop over `stock.keys()` calling `maybeRequisition` before any caller interaction.
- **AC-CR001-4**: `list()` emits `low` using `threshold()`, plus unchanged part-master fields.
- **AC-CR001-5**: `reserve/release/consume/receive`, `assertKnownSku`, and the one-open-requisition-per-SKU guard are untouched — AC-F05-1..5 regress unchanged.

## Backward compatibility
`createInventory(parts?)` contract and returned method set (`reserve, release, consume, receive, available, list, lowStock, requisitions, reservations`) are unchanged. All new fields (`priority`, `etaDays`, `reason`, `low`) are additive on existing objects; no field removed or renamed. Callers reading `requisitions()`/`list()` positionally or via spread remain compatible; callers relying on exact key sets must tolerate new keys (existing F05/F03 callers only read named fields, per contract).

## Security & data classification
Module remains pure, dependency-free, I/O-free. Data handled (sku, quantities, lead times, requisition metadata) is operational/non-sensitive and stays in-memory on the edge gateway — no new storage or network egress introduced. Still read-only toward OT: no control commands issued; requisitions are informational records for Edge Ops/UI consumption. Input validation unchanged: `assertKnownSku` rejects unknown SKUs (AC-F05-5); `reserve` keeps qty/ref validation.

## Reused team decisions
- Long-lead definition and early-reorder threshold (`leadTimeDays >= 14`, `available <= reorderPoint+1`) — Atlas decision, CR-001.
- Requisition fields `priority`/`etaDays`/`reason` with `etaDays = ceil(leadTimeDays/2)` for long-lead — Atlas decision, CR-001.
- One-open-requisition-per-SKU invariant — reused from F05 baseline design (AC-F05-3).
