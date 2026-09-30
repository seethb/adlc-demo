# CR-001 Design Delta — edge/features/F05-inventory/index.js

## Changed internal state
Each stock entry gains `leadTimeDays` (from `p.leadTimeDays ?? 0`), read-only after construction. No other new maps.

## Changed functions

**Helper `isLongLead(s)`**: returns `s.leadTimeDays >= 14`.

**Helper `threshold(s)`**: returns `s.reorderPoint + (isLongLead(s) ? 1 : 0)`.

**`maybeRequisition(sku)`**: trigger becomes `avail <= threshold(s)` instead of `avail <= s.reorderPoint`. When opening a requisition, sets:
```
{ id, sku, qty, status: 'open',
  priority: isLongLead(s) ? 'expedite' : 'normal',
  etaDays: isLongLead(s) ? Math.ceil(s.leadTimeDays / 2) : s.leadTimeDays,
  reason: isLongLead(s) ? 'critical-spare-early-reorder' : 'reorder-point' }
```
One-open-requisition-per-SKU guard unchanged.

**`createInventory(parts)`**: after building `stock`, calls `maybeRequisition(sku)` for every sku so parts already at/below threshold get one open requisition immediately (AC-CR001-3).

**`list()`**: return shape becomes
```
{ sku, name, onHand, reserved, available, reorderPoint, leadTimeDays, low }
```
where `name` comes from part master (`p.name ?? sku`), `low = available <= threshold(s)`.

**`lowStock()`**: now filters using `list()`'s `low` field (same threshold), unchanged signature.

**`requisitions()`**: returned objects now include `priority`, `etaDays`, `reason` alongside `id, sku, qty, status`.

## AC → Design mapping
- **AC-CR001-1**: `threshold(s)` in `maybeRequisition`, applied on reserve/consume/construction.
- **AC-CR001-2**: requisition literal in `maybeRequisition` sets `priority`/`etaDays`/`reason` per formula.
- **AC-CR001-3**: constructor loop calling `maybeRequisition` for every sku after stock init.
- **AC-CR001-4**: new `list()` shape with `reorderPoint`, `leadTimeDays`, `low` using `threshold`.
- **AC-CR001-5**: `reserve`, `release`, `consume`, `receive`, `available` bodies untouched; existing tests rerun as regression gate.

## Backward compatibility
`createInventory(parts?)` signature and returned method set (`reserve, release, consume, receive, available, list, lowStock, requisitions, reservations`) unchanged. `list()`/`requisitions()` changes are additive field extensions only — existing consumers reading `sku/onHand/reserved/available` or `id/sku/qty/status` keep working. F03's reserve/release/consume-by-ref usage is untouched.

## Security & data classification
Requisition and stock data remain **operational/internal** classification, in-memory only, no persistence beyond process lifetime, no PII. Module stays pure ES, no I/O — read-only toward OT is preserved since no function issues control commands. Any transport of this data off-gateway must go over mutual TLS 1.2+ per org IoT standard. Input validation unchanged: unknown SKUs throw (AC-F05-5); `leadTimeDays` treated as trusted part-master data, defaulted to 0 if absent.

## Reused team decisions
Long-lead threshold (`leadTimeDays >= 14`, `available <= reorderPoint + 1`) per atlas's CR-001 decision. Contract shape of `createInventory` preserved per rigel/sentinel prior recordings.
