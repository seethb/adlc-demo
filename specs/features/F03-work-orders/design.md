# F03 · Automated work orders — Design

## Module structure (`edge/features/F03-work-orders/index.js`)

Internal state (closed over, per service instance):
- `woStore: Map<id, WO>` — all work orders.
- `openIndex: Map<'assetId::failureMode', id>` — lookup for open (non-closed) WOs, for dedup.
- `seq` — counter for `WO-####` ids.

Functions:
- `createWorkOrderService({ inventory } = {})` — factory, returns the public API.
- `priorityFor(severity)` — internal: severity → `P1..P3` / `null` for low.
- `playbookFor(assetType, failureMode)` — internal: returns `{ title, tasks[], parts[] }` from a static playbook table.
- `reserveParts(woId, parts)` — internal: calls `inventory.reserve` per part (or fabricates `reserved` if `inventory` absent), returns parts array with `reserved`/`shortfall`, and whether any shortfall exists.
- `fromAnomaly(anomaly)` — public: validate → map severity → dedup/escalate or create WO → reserve parts → set status.
- `close(id)` — public: consumes reservations, sets `status: 'closed'`, removes from `openIndex`.
- `list()` — public: `Array.from(woStore.values())`.
- `get(id)` — public: `woStore.get(id) ?? null`.

## Contract signatures

```
createWorkOrderService({ inventory } = {}) => {
  fromAnomaly(anomaly: Anomaly) => WO | null,
  close(id: string) => WO | null,
  list() => WO[],
  get(id: string) => WO | null
}

WO = { id, assetId, assetType, failureMode, priority: 'P1'|'P2'|'P3', slaHours,
       status: 'open'|'waiting_parts'|'closed', title, tasks: string[],
       parts: [{ sku, qty, reserved, shortfall }], occurrences, anomalyIds: string[],
       createdAt, lastSeen, history: [{ ts, event, detail }], deduplicated: boolean }
```

## AC → design mapping

| AC | Design element |
|---|---|
| AC-F03-1 | `priorityFor`: critical→P1, high→P2, medium→P3, low→`null` ⇒ `fromAnomaly` returns `null`, no WO created/stored. |
| AC-F03-2 | `openIndex` keyed by `assetId::failureMode`; on match, increment `occurrences`, push `anomalyIds`/`history`, and escalate `priority` if new severity's priority is numerically higher (P1<P2<P3), never de-escalate; `deduplicated: true` set. |
| AC-F03-3 | `playbookFor` supplies `title`/`tasks`; `reserveParts` calls `inventory.reserve(sku, qty, woId)` per part immediately on creation, storing `reserved`/`shortfall`. |
| AC-F03-4 | `close(id)` calls `inventory.consume(woId)`, sets `status: 'closed'`, deletes entry from `openIndex` so a subsequent anomaly for the same asset+failureMode opens a fresh WO. |

Shortfall handling: if any part has `shortfall > 0`, WO `status` is `waiting_parts` instead of `open`; creation is never blocked (Risk in plan).

## Security & data classification

- **Data class**: Work orders are **C2 Confidential** (per org classification) — they reveal fault modes, asset weaknesses, and production impact.
- **Residency**: Edge holds a **cache** copy only; the cloud CMMS is the system of record. This module must not assume it is authoritative — it produces/updates the edge cache that syncs upstream over MQTT/mTLS.
- **Read-only toward OT**: F03 never writes to OT/control systems; it only consumes `Anomaly` objects from F02 and calls F05's inventory API (itself read/reserve, not OT-writing). No actuator or setpoint calls of any kind.
- **Privacy**: WO records carry `assetId` only — never operator or technician names, per org privacy standard.
- **Input validation**: `fromAnomaly` must validate presence of `assetId`, `assetType`, `failureMode`, `severity` (enum), and reject/ignore malformed anomalies (no throw, return `null`) rather than raising a corrupt WO. `close(id)` validates `id` exists before touching inventory.

## Reused team decisions
- Exact `WO` shape, method names, and inventory call signatures (`reserve(sku,qty,ref)`, `consume(ref)`, `release(ref)`) taken verbatim from the F03 feature spec and plan, keyed by WO id.
- Security section structure (data class, residency, read-only OT, input validation) follows the recalled Vega convention applied uniformly to F02/F03/F05 designs.
- Data classification values (C2 for work orders, cache-at-edge/authoritative-in-cloud) taken from the org's Security design KB doc.
- Privacy rule (asset id only, no personal names) taken from org standard.
