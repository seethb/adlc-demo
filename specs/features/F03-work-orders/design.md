# F03 · Automated work orders — Design

## Module structure (`edge/features/F03-work-orders/index.js`)

Exported factory: `createWorkOrderService({ inventory })`.

Internal state (closure, in-memory, per-gateway; not persisted beyond process/cache):
- `woStore: Map<id, WO>` — all work orders, keyed by id.
- `openIndex: Map<'${assetId}::${failureMode}', id>` — dedup lookup for open WOs.
- `seq` — counter for `WO-####` id generation.

Internal helpers (not exported):
- `mapSeverityToPriority(severity)` → `'P1'|'P2'|'P3'|null` (AC-F03-1).
- `slaForPriority(priority)` → hours (P1 shortest, P3 longest).
- `playbookFor(assetType, failureMode)` → `{ tasks[], parts:[{sku,qty}] }` — static lookup table.
- `reserveParts(partsNeeded)` → calls `inventory.reserve(sku, qty)` per line, returns `{ parts, waiting }` marking `shortfall` when reservation partial.
- `nextId()` → `'WO-' + (1000+seq++)`.
- `touchHistory(wo, event)` → appends `{ at, event }` to `wo.history`.

## Contract signatures

```
createWorkOrderService({ inventory: InventoryService }) → {
  fromAnomaly(anomaly: {
    assetId: string, assetType: string, failureMode: string,
    severity: 'critical'|'high'|'medium'|'low', id?: string
  }): WO | null,
  close(id: string): WO,
  list(): WO[],
  get(id: string): WO | undefined
}

WO = {
  id, assetId, assetType, failureMode, priority: 'P1'|'P2'|'P3',
  slaHours, status: 'open'|'waiting_parts'|'closed',
  title, tasks: string[],
  parts: [{ sku, qty, reserved, shortfall }],
  occurrences, anomalyIds: string[],
  createdAt, lastSeen, history: [{at, event}], deduplicated: boolean
}
```

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F03-1 | `mapSeverityToPriority` returns null for `low` (⇒ `fromAnomaly` returns null, no WO created); critical/high/medium map to P1/P2/P3. |
| AC-F03-2 | `openIndex` keyed by `assetId::failureMode`; existing open WO → increment `occurrences`, push `anomalyIds`, update `lastSeen`, escalate `priority` only if new mapped priority is numerically higher severity (min of P-rank); `deduplicated=true`. |
| AC-F03-3 | On create, `playbookFor` supplies `tasks`/`title`; `reserveParts` calls `inventory.reserve`; status set to `waiting_parts` if any `shortfall>0`, else `open`. |
| AC-F03-4 | `close(id)` calls `inventory.consume`/release per reserved part, sets `status='closed'`, removes entry from `openIndex` so a subsequent `fromAnomaly` for same asset+failure mode opens a fresh WO. |

## Security & data classification
- WO records are **C2 Confidential** (reveal process/plant weakness); edge holds them only as a **cache**, cloud CMMS is system of record — module must not claim authority beyond local cache.
- No PII: only `assetId`/`assetType`, never operator/technician names, per org privacy standard; any accidental name-like field is stripped before storage.
- Strictly **read-only toward OT**: this module never writes to control systems, PLCs, or actuators — it only reads anomaly input and writes to inventory/CMMS-facing state.
- Input validation: `fromAnomaly` rejects anomalies missing `assetId`/`assetType`/`failureMode`/`severity`, unknown severities, or non-string ids; `close(id)` throws for unknown id or already-closed WO; inventory SKU/qty validated by F05 before use here.

## Reused team decisions
- Reused exact WO shape and contract signature from feature spec / Sentinel's implementation location (`edge/features/F03-work-orders/index.js`, exports `createWorkOrderService`).
- Reused F05 `createInventory` at `edge/features/F05-inventory/index.js` as the `inventory` dependency for reservation/consumption.
- Applied org privacy standard (asset ids only, no technician/operator names) and C2 classification + edge-cache/cloud-authoritative rule from security design KB.
