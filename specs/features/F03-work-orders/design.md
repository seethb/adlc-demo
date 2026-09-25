# F03 · Automated work orders — design

## Module structure (`edge/features/F03-work-orders/index.js`)

Internal state (closed over, not exported):
- `woStore: Map<id, WO>` — all work orders, id sequence `WO-1000+n`.
- `dedupIndex: Map<'assetId|failureMode', id>` — tracks the single open WO per asset+failure mode.
- `PLAYBOOKS: Map<'assetType|failureMode', { title, tasks[], parts[] }>` — static lookup table.
- `SEVERITY_PRIORITY = { critical: 'P1', high: 'P2', medium: 'P3' }` (low → no WO).
- `SLA_BY_PRIORITY = { P1: 4, P2: 24, P3: 72 }` hours.

Functions:
- `nextId()` — increments internal counter.
- `mapPriority(severity)` — returns priority or `null`.
- `lookupPlaybook(assetType, failureMode)` — returns `{ title, tasks, parts }` or generic fallback.
- `reserveParts(parts, woId)` — calls `inventory.reserve(sku, qty, woId)` per part, returns `{ parts: [...], hasShortfall }`.
- `fromAnomaly(anomaly)` — validates input, maps priority, dedups, reserves parts, upserts WO.
- `close(id)` — consumes reserved parts via `inventory.consume`, sets status `closed`, removes dedup slot.
- `list()`, `get(id)` — read accessors returning shallow copies.

## Contract

```
createWorkOrderService({ inventory }) => {
  fromAnomaly(anomaly: { assetId, assetType, failureMode, severity, id }): WO | null,
  close(id: string): WO,
  list(): WO[],
  get(id: string): WO | undefined
}
```
WO shape exactly as in spec (`id, assetId, assetType, failureMode, priority, slaHours, status, title, tasks[], parts[], occurrences, anomalyIds[], createdAt, lastSeen, history[], deduplicated`).

## AC → design mapping

| AC | Design |
|---|---|
| AC-F03-1 | `mapPriority` via `SEVERITY_PRIORITY`; `low`/unknown severity returns `null`, `fromAnomaly` short-circuits without creating a WO. |
| AC-F03-2 | `dedupIndex` keyed by `assetId|failureMode`; on hit, `fromAnomaly` increments `occurrences`, appends `anomalyIds`/`history`, escalates `priority` only if new mapped priority is numerically stronger (P1<P2<P3). |
| AC-F03-3 | `lookupPlaybook` supplies `title`/`tasks`; `reserveParts` calls `inventory.reserve` per part and records `reserved`/`shortfall` per sku. |
| AC-F03-4 | `close(id)` calls `inventory.consume(sku, qty, id)` for each reserved part, sets `status: 'closed'`, deletes the `dedupIndex` entry so a new WO can open for that asset+failure mode. |

## Security & data classification

- Work orders are **C2 Confidential** (per shared classification): they reveal failure modes, asset weaknesses and maintenance state. WOs may be cached at the edge but the cloud CMMS is the system of record — this module only produces/caches the edge-side copy.
- No PII: WOs reference `assetId` only, never operator/technician identity (org privacy standard); any `technicianId` field, if ever added, must be a pseudonymous team id.
- Read-only towards OT: this module never writes PLC/OPC-UA/setpoints; it only reads anomaly events and writes to the F05 inventory service and its own in-memory store. WOs are advisory outputs.
- Input validation: `fromAnomaly` rejects anomalies missing `assetId`, `assetType`, or `failureMode`, and treats unmapped/unknown `severity` as no-op (returns `null`), consistent with treating upstream telemetry-derived data as untrusted.
- Parts shortfall must never throw or block creation — `status` becomes `waiting_parts`, per spec risk note.

## Reused team decisions
- Reused F05's `createInventory` contract (`reserve`, `consume`) at `edge/features/F05-inventory/index.js` exactly as recalled from Rigel/Atlas memories — no new inventory shape invented.
- Applied the org data-classification table (WOs = C2, edge cache / cloud authoritative) recalled from the security-design knowledge base.
- Applied org privacy standard: asset ids only, no operator/technician names anywhere in WO or telemetry.
- Applied IoT security standard: edge analytics/WOs are read-only and advisory towards OT.
