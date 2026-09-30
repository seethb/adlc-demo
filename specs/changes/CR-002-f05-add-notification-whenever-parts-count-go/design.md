# Design delta — CR-002: low-stock notification (F05)

## Changed functions & internal state
- `list()`: each item gains `notify: boolean` computed as `available < 5` (fixed constant, not `reorderPoint`).
- `available(sku)`: unchanged numeric return, but module adds internal helper `isLowStock(avail) => avail < 5` reused by both `list()` and new `notifications()`.
- New exported function `notifications()`: derived read, no new stored state — iterates `stock` and returns entries where `available < 5`.
- No changes to `stock`, `reservationsMap`, `requisitionsMap`, `reqCounter`; `maybeRequisition` and `reorderPoint` logic untouched.

## Exact data shapes

`list()` →
```js
[{ sku: string, onHand: number, reserved: number, available: number, notify: boolean }]
```

`notifications()` (new) →
```js
[{ sku: string, available: number, message: string }] // message e.g. "Low stock: SKU A has 3 available"
```

`createInventory(parts?)` return object now:
```js
{ reserve, release, consume, receive, available, list, lowStock, requisitions, reservations, notifications }
```
All prior fields keep identical signatures and shapes.

## AC → design mapping
- **AC-CR002-1**: `list()` and `notifications()` compute `available < 5` per SKU on every "view" call (no caching, no side effects); UI/caller triggers popup when `notify === true` or `notifications()` is non-empty. Threshold is the fixed constant `5`, per team decision, independent of `reorderPoint`.
- **AC-CR002-2**: `reserve`, `release`, `consume`, `receive`, `requisitions`, `reservations`, `lowStock`, SKU validation (`assertKnownSku`) are untouched byte-for-byte; existing AC-F05-1..5 tests run unmodified against same code paths.

## Backward compatibility
`createInventory` signature (`parts?` input shape) is unchanged. All existing returned functions keep prior signatures and return shapes exactly; `notify` on `list()` items and `notifications()` are additive fields/functions only. Any caller destructuring the returned object or reading `list()` items by known keys continues to work unmodified; callers must explicitly opt into reading `notify`/`notifications()` for the new behavior.

## Security & data classification
- Data classification unchanged: operational inventory counts (SKU, quantities) — internal/operational, not PII, not OT control data.
- Read-only toward OT: notification logic only reads existing in-memory `stock` state; adds no writes, no new I/O, no network/storage calls — module remains pure ES, no deps.
- Input validation: `notifications()`/`list()` never take untrusted external input; reuses `assertKnownSku` guard pathway already enforced by AC-F05-5 for any sku-keyed call.
- No credentials, transport, or TLS surface introduced (no change to mTLS/8883 posture per org IoT standard, since this is in-process derived data).

## Reused team decisions
- Threshold fixed at 5, decided by adlc:atlas for CR-002, decoupled from per-SKU `reorderPoint`.
- Module remains the sole file `edge/features/F05-inventory/index.js`, pure ES module, no I/O (org/team standard).
