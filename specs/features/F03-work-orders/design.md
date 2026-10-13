# F03 · Automated work orders — Design

## Module structure (`edge/features/F03-work-orders/index.js`)

Internal state (closed over by `createWorkOrderService`):
- `wosById: Map<id, WO>` — all work orders, open and closed.
- `openIndex: Map<'${assetId}::${failureMode}', id>` — dedup lookup for open WOs only.
- `seq` — counter for id generation (`WO-1001`, `WO-1002`, ...).

Exported factory: `createWorkOrderService`.

Internal helpers:
- `priorityFor(severity)` → `P1|P2|P3|null` (low → null).
- `slaFor(priority)` → hours (P1 shortest).
- `playbookFor(assetType, failureMode)` → `{ title, tasks[], parts[] }` static lookup table.
- `reserveParts(woId, parts, inventory)` → calls `inventory.reserve(sku, qty, woId)` per part, returns `parts[]` with `reserved`/`shortfall`; if `inventory` absent, marks all `reserved: qty, shortfall: 0`.
- `statusFor(parts)` → `'open'` if no shortfalls else `'waiting_parts'`.
- `escalate(wo, newPriority)` → lowers numeric priority value, pushes `history` entry.
- `validateAnomaly(anomaly)` → throws on missing `id/assetId/assetType/failureMode/severity`.

## Contract signatures

```
createWorkOrderService({ inventory } = {}) => {
  fromAnomaly(anomaly: Anomaly): WO | null,
  close(id: string): WO,
  list(): WO[],
  get(id: string): WO | undefined
}

WO = {
  id, assetId, assetType, failureMode,
  priority: 'P1'|'P2'|'P3', slaHours: number,
  status: 'open'|'waiting_parts'|'closed',
  title, tasks: string[],
  parts: [{ sku, qty, reserved, shortfall }],
  occurrences: number, anomalyIds: string[],
  createdAt, lastSeen, history: [{ ts, event, detail }],
  deduplicated: boolean
}
```

`inventory` calls used exactly as F05 specifies: `reserve(sku, qty, woId)` on raise, `consume(woId)` on close, `release(woId)` on cancel (not exposed yet via public API, reserved for future use).

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F03-1 | `priorityFor` maps critical→P1, high→P2, medium→P3; low→null short-circuits `fromAnomaly` to return `null`, no WO created. |
| AC-F03-2 | `openIndex` keyed by `assetId::failureMode`; existing open WO bumps `occurrences`, pushes `anomalyIds`, sets `deduplicated: true`; `escalate` runs if new severity's priority is stronger. |
| AC-F03-3 | `playbookFor` supplies `title`/`tasks`; `reserveParts` reserves each part via `inventory.reserve(sku, qty, woId)`, recording `reserved`/`shortfall`. |
| AC-F03-4 | `close(id)` calls `inventory.consume(woId)`, sets `status: 'closed'`, removes entry from `openIndex` so a new WO can open for the same key. |

## Security & data classification

- Data class: **C2 Confidential** (work orders reveal process/failure know-how). WO objects must never carry operator/technician names — only asset ids, per org privacy standard.
- Residency: edge gateway holds a **cache** copy only; cloud CMMS is the authoritative system of record. No raw telemetry is embedded in WOs (only derived anomaly/failureMode fields).
- Transport: when forwarded to cloud, use MQTT/mTLS as for other C2 data (anomalies, aggregates).
- OT posture: this module is **strictly read-only toward OT** — it only consumes `Anomaly` objects from F02 and never writes to control systems or asset firmware.
- Input validation: `validateAnomaly` rejects anomalies missing `id`, `assetId`, `assetType`, `failureMode`, or `severity`; unknown severities are treated as no-op (no WO, no throw); `close(id)` throws for unknown WO id.

## Reused team decisions
- Followed F05's exact inventory contract (`reserve(sku, qty, ref)`, `consume(ref)`, `release(ref)`) with WO id as reference, per shared contract recalled from F05 design work.
- Applied org privacy standard: WOs reference asset ids only, never technician/operator names.
- Applied C2 classification and edge-cache/cloud-authoritative residency rule from the security design knowledge base section for work orders.
