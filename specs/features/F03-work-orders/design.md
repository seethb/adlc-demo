# F03 · Automated work orders — Design

## Module structure (`edge/features/F03-work-orders/index.js`)

**Exported factory:** `createWorkOrderService({ inventory })`

Returned API:
- `fromAnomaly(anomaly)` — main entry, returns `WO|null`
- `close(id)` — closes a WO, consumes reserved parts
- `list()` — returns array of all WOs (snapshot)
- `get(id)` — returns single WO or undefined

**Internal helpers:**
- `priorityFor(severity)` — severity→priority map, returns `null` for low
- `playbookFor(assetType, failureMode)` — returns `{ tasks[], parts[] }` from static playbook table
- `findOpenWO(assetId, failureMode)` — dedup lookup over internal store
- `escalate(wo, newPriority)` — raises priority if more severe, appends `history`
- `nextId()` — `WO-1000`-style sequence counter
- `validateAnomaly(anomaly)` — input validation guard

**Internal state (module-closure, per service instance):**
- `store: Map<id, WO>` — all WOs, keyed by id
- `openIndex: Map<'assetId::failureMode', id>` — dedup index, cleared on close
- `seq: number` — id counter

## Contract signatures

```
createWorkOrderService({ inventory: InventoryAPI }) => {
  fromAnomaly(anomaly: { assetId, assetType, failureMode, severity, id }) => WO | null,
  close(id: string) => WO,
  list() => WO[],
  get(id: string) => WO | undefined
}

WO = { id, assetId, assetType, failureMode, priority: 'P1'|'P2'|'P3', slaHours,
       status: 'open'|'waiting_parts'|'closed', title, tasks: string[],
       parts: [{ sku, qty, reserved, shortfall }], occurrences: number,
       anomalyIds: string[], createdAt, lastSeen, history: object[], deduplicated: boolean }
```

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F03-1 | `priorityFor` maps critical→P1, high→P2, medium→P3; returns `null` for low, causing `fromAnomaly` to return `null` (no WO created) |
| AC-F03-2 | `findOpenWO` via `openIndex` enforces one open WO per (assetId, failureMode); repeat anomalies increment `occurrences`, append `anomalyIds`, and call `escalate` if severity's priority outranks current |
| AC-F03-3 | `playbookFor` supplies `tasks[]`; `inventory.reserve(sku, qty)` called per part, populating `parts[].reserved`/`shortfall`; shortfall sets `status: 'waiting_parts'` without blocking creation |
| AC-F03-4 | `close(id)` calls `inventory.consume` for each reserved part, sets `status: 'closed'`, removes entry from `openIndex` so a subsequent anomaly opens a fresh WO |

## Security & data classification

- **Data class:** Work orders are **C2 Confidential** (per org classification) — they reveal process/failure knowledge and must not be publicly disclosed.
- **Residency:** Edge holds a **cache** copy only; the cloud CMMS is the system of record. This module implements the edge-side cache/service, not the CMMS itself.
- **OT posture:** Strictly **read-only towards OT/CMMS** — the module consumes anomalies (from F02) and reserves inventory (via F05) but never writes back to OT control systems; all writes are confined to its internal WO store.
- **Privacy:** WOs reference `assetId` only, never operator/technician names, per org privacy standard.
- **Input validation:** `validateAnomaly` rejects anomalies missing `assetId`, `assetType`, `failureMode`, or `severity`; unknown severities are treated as low (no WO); `close(id)` throws/returns error on unknown id; part reservation quantities must be positive integers.

## Reused team decisions
- WO shape and contract signature taken verbatim from the feature spec / Meko-recalled contract.
- F05 `createInventory` (edge/features/F05-inventory/index.js) is the sole parts backend; F02 (edge/features/F02-anomaly-detection/index.js) is the sole anomaly source.
- Data classification and edge/cloud residency table (C2, cloud-authoritative, edge cache) reused from Security design KB.
- Privacy standard (asset ids only, no personal names) applied to WO records.
