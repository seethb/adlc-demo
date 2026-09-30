# Design Delta — CR-002: Low-stock notification (F05)
Module: `edge/features/F05-inventory/index.js`

## Changed functions & internal state
- `list()`: behavior extended (not signature) — each returned item gains a `notification` field. No new internal state (`stock`, `reservationsMap`, `requisitionsMap`, `reqCounter` unchanged); notification is derived purely from existing `onHand`/`reserved`, no mutation.
- `lowStock()`: unchanged filter logic (`available <= reorderPoint`), still used for requisition triggering — NOT reused for the CR-002 threshold since the notification uses a fixed threshold of 5, independent of `reorderPoint`.
- No new exported functions; `createInventory` return object shape unchanged (`reserve, release, consume, receive, available, list, lowStock, requisitions, reservations`).

## Exact data shapes (changed)
`list()` item, previously:
```
{ sku, onHand, reserved, available }
```
Now:
```
{ sku, onHand, reserved, available, notification: string | null }
```
`notification` is `` `low stock: ${sku} (${available} < 5)` `` when `available < 5`, else `null`. Array order and all other fields unchanged. `lowStock()` output shape is untouched: `{ sku, onHand, reserved, available }[]`.

## AC → design mapping
- **AC-CR002-1**: Viewing inventory (`list()`) computes `available(sku) < 5` per item and sets `notification`; a UI/consumer polling `list()` on each view sees the alert without new API surface.
- **AC-CR002-2**: `reserve`, `release`, `consume`, `receive`, `available`, `requisitions`, `reservations`, and `lowStock` bodies are byte-for-byte unchanged; only `list()` gains an additive field. Full AC-F05-1..5 suite re-run unmodified confirms no regression.

## Backward compatibility
`createInventory(parts?)` signature and returned method set are identical. All existing callers destructuring `{ sku, onHand, reserved, available }` from `list()` continue to work — `notification` is an additive field, ignored by callers unaware of it. No caller of `lowStock()`, `reserve()`, `release()`, `consume()`, `receive()`, `available()`, `requisitions()`, `reservations()` is affected.

## Security & data classification
- Same data class as F05 baseline: operational inventory counts (non-PII, low sensitivity), stored only in-memory, no persistence added.
- Read-only posture toward OT preserved: notification computation reads existing counters, never writes to `stock`/OT-adjacent state.
- Input validation unchanged: `assertKnownSku` still guards all sku-keyed operations (AC-F05-5); notification path only runs over already-known SKUs from `stock`.
- No new external transport; notification is an in-process data field, not a network event — no new attack surface.

## Reused team decisions
- CR-002 notification is `available(sku) < 5`, surfaced via the existing `list()`/`lowStock()` view path, per atlas's decision, without changing `createInventory`'s signature.
- ISO-8601 UTC timestamp and 3-decimal numeric rounding conventions from F05 baseline are unaffected (no timestamps/numerics added here).
