# F03 · Automated work orders — Design

## Module structure (`edge/features/F03-work-orders/index.js`)

Exports: `createWorkOrderService({ inventory })`.

Internal state (closure-scoped, in-memory, per-gateway):
- `workOrders: Map<id, WO>` — all WOs, open and closed.
- `openIndex: Map<`${assetId}::${failureMode}`, id>` — dedup lookup for open WOs.
- `seq` — counter for `WO-xxxx` id generation.

Internal helpers:
- `mapSeverity(severity) → priority|null` — critical→P1, high→P2, medium→P3, low→null.
- `slaFor(priority) → hours` — static lookup table.
- `playbookFor(assetType, failureMode) → { tasks[], parts[] }` — static/reference playbook table (from `edge/reference/workorders.js`).
- `validateAnomaly(anomaly)` — throws/returns false on missing/invalid `assetId`, `assetType`, `failureMode`, `severity`.
- `escalate(wo, newPriority)` — only raises priority (P2→P1 etc.), never lowers it; pushes `history` entry.
- `reserveParts(parts)` — calls `inventory.reserve(sku, qty)` per part, marks `shortfall` on partial reservation, sets `status = 'waiting_parts'` if any shortfall.
- `nextId()` — `WO-${1000+seq++}`.

Exported functions:
- `fromAnomaly(anomaly): WO|null`
- `close(id): WO`
- `list(): WO[]`
- `get(id): WO`

## Contract signatures

```
createWorkOrderService({ inventory: InventoryService }) → {
  fromAnomaly(anomaly: {
    assetId: string, assetType: string,
    failureMode: string, severity: 'low'|'medium'|'high'|'critical'
  }): WO | null,
  close(id: string): WO,
  list(): WO[],
  get(id: string): WO
}

WO = {
  id, assetId, assetType, failureMode,
  priority: 'P1'|'P2'|'P3', slaHours: number,
  status: 'open'|'waiting_parts'|'closed',
  title: string, tasks: string[],
  parts: [{ sku, qty, reserved, shortfall }],
  occurrences: number, anomalyIds: string[],
  createdAt, lastSeen, history: [{ at, event, detail }],
  deduplicated: boolean
}
```

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F03-1 | `mapSeverity` returns null for `low` → `fromAnomaly` returns `null`; otherwise sets `priority`/`slaHours` via `slaFor`. |
| AC-F03-2 | `openIndex` keyed by assetId+failureMode; hit increments `occurrences`, appends `anomalyIds`, calls `escalate` only if new severity maps higher. |
| AC-F03-3 | `playbookFor` supplies `tasks`/parts list; `reserveParts` calls `inventory.reserve` and populates `parts[]` with reservation results. |
| AC-F03-4 | `close(id)` calls `inventory.consume(sku, qty)` per reserved part, sets `status='closed'`, removes entry from `openIndex` so a new anomaly reopens a fresh WO. |

## Security & data classification

- Work orders are **C2 Confidential** data (per org data classification standard): they reveal process/failure detail and must not be treated as public/internal.
- Edge holds a **cache** copy only; the cloud CMMS is the system of record — this module does not assume edge storage is durable or authoritative.
- Strict **read-only towards OT**: this module never writes to PLC/SCADA/OT systems; it only reads anomaly events (from F02) and calls F05's inventory API (reserve/consume), never actuates equipment.
- Input validation: `fromAnomaly` rejects/ignores anomalies missing `assetId`, `assetType`, `failureMode`, or an unrecognized `severity`; `close`/`get` validate `id` exists and throw a typed error otherwise; no free-text fields are persisted beyond controlled `title`/`tasks` from the static playbook.
- No operator/technician identities are stored — WOs reference `assetId` only, per privacy standard.

## Reused team decisions
- Followed vega's recalled requirement to include Module structure, exact contract signatures, AC mapping, and Security & Data Classification sections.
- Applied org privacy standard: WOs carry asset ids only, never technician/operator names.
- Applied KB data classification: work orders are C2, edge is cache only, cloud CMMS is authoritative system of record.
- Reused exact WO shape and contract from the F03 spec/plan without altering field names.
