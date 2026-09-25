# F03 · Automated work orders — Design

## Module structure (`edge/features/F03-work-orders/index.js`)

Internal state (module-private, held in closure per service instance):
- `orders: Map<id, WO>` — all work orders, keyed by id.
- `openIndex: Map<'assetId|failureMode', id>` — dedup lookup for open/waiting_parts WOs.
- `seq` — counter for `WO-1001`-style ids.

Exported factory: `createWorkOrderService({ inventory })`.

Internal helpers (not exported):
- `severityToPriority(severity)` → `'P1'|'P2'|'P3'|null` (low → null).
- `priorityRank(p)` — for escalation comparison.
- `slaFor(priority)` → hours.
- `playbookFor(assetType, failureMode)` → `{ title, tasks[], parts[] }` (static lookup table).
- `reserveParts(parts)` — calls `inventory.reserve`, returns parts with `reserved`/`shortfall` filled in; never throws on shortfall.
- `validateAnomaly(anomaly)` — throws `TypeError` on malformed input.
- `nextId()`.

## Contract signatures

```
createWorkOrderService({ inventory: InventoryService }) → {
  fromAnomaly(anomaly: Anomaly): WO | null,
  close(id: string): WO,
  list(): WO[],
  get(id: string): WO | undefined
}

Anomaly = { assetId, assetType, failureMode, severity: 'critical'|'high'|'medium'|'low', id, ts }

WO = {
  id, assetId, assetType, failureMode,
  priority: 'P1'|'P2'|'P3',
  slaHours, status: 'open'|'waiting_parts'|'closed',
  title, tasks: string[],
  parts: [{ sku, qty, reserved, shortfall }],
  occurrences, anomalyIds: string[],
  createdAt, lastSeen, history: [{ ts, event, detail }],
  deduplicated: boolean
}
```

`inventory` is the F05 `createInventory()` service (`edge/features/F05-inventory/index.js`), used only via `reserve`/`consume`.

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F03-1 | `severityToPriority` maps critical→P1, high→P2, medium→P3; returns `null` for low, causing `fromAnomaly` to return `null` (no WO). |
| AC-F03-2 | `openIndex` keyed by `assetId+failureMode` restricts to one open/waiting_parts WO; repeat anomaly increments `occurrences`, appends `anomalyIds`/`history`; if new severity's priority rank is higher, `priority` is escalated and event logged. |
| AC-F03-3 | `playbookFor` supplies `title`/`tasks`; `reserveParts` calls `inventory.reserve` at creation time, populating `parts[]`. |
| AC-F03-4 | `close(id)` calls `inventory.consume` for reserved parts, sets `status='closed'`, removes the entry from `openIndex`, allowing a subsequent `fromAnomaly` for the same asset+failure mode to open a fresh WO. |

## Security & data classification
- WO records are **C2 Confidential** (per org data classification): they reveal fault patterns and plant weaknesses. They may live on the edge gateway only as a **cache**; the cloud CMMS is the system of record. No raw telemetry is stored in WO objects.
- The module is **strictly read-only toward OT systems**: it never writes to PLCs/sensors/control loops; its only external effect is calling the F05 inventory service (also edge-local, non-OT) and emitting events for cloud sync.
- Input validation: `fromAnomaly` validates `assetId`, `assetType`, `failureMode`, `severity` (enum), and `id` are present and correctly typed before use; malformed anomalies throw and are never partially persisted. `close(id)` validates the id exists and is not already closed.
- Per org privacy standard, WO records reference only `assetId` — never operator/technician names.

## Reused team decisions
- Reused the exact `WO` shape and contract signatures from the F03 spec/plan (Nova, Atlas).
- Reused F05's `createInventory` reserve/consume contract (Rigel) as the inventory dependency.
- Applied the org's C0–C3 data classification scheme and edge/cloud residency rules (Meko KB) marking WOs as C2, cache-only at the edge.
- Applied the org privacy standard: asset ids only, never operator/technician names.
