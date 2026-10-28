# F04 · Corrective Action Reports (CAR) — Design

## Module structure
`edge/features/F04-corrective-action/index.js` exports `createCarService()`.

Internal state (closure, in-memory, not persisted across process restarts):
- `cars: Map<string, CAR>` keyed by `CAR-nnn` id.
- `byKey: Map<string /* assetId|failureMode */, string /* CAR id */>` — enforces AC-F04-3 dedup.
- `seq: number` — next CAR sequence number.

Internal helpers:
- `keyOf(wo)` → `` `${wo.assetId}|${wo.failureMode}` ``.
- `isCritical(wo)` → `wo.priority === 'P1'`.
- `isRecurrent(group)` → `group.length >= 2 || group.some(wo => wo.occurrences >= 3)`.
- `groupByKey(workOrders)` → Map of key → WO[].
- `lookupRootCause(failureMode)` → reads from `edge/reference/car.js` (failure-mode handbook); returns handbook text or a placeholder string tagged `(unconfirmed)` if no entry — never fabricated prose.
- `buildCar(key, group, trigger)` → assembles the 8D fields (D1–D8) per the reference procedure and mints `CAR-${String(seq).padStart(3,'0')}`.
- `evaluate(workOrders)` → groups WOs, determines trigger per key (critical takes precedence), skips keys already in `byKey`, creates CARs for the rest, registers them, returns only the newly created ones.
- `list()` → `[...cars.values()]`.

## Contract
```
createCarService() → {
  evaluate(workOrders: WO[]): CAR[],   // newly created only, per AC-F04-3
  list(): CAR[]
}

CAR = {
  id: 'CAR-001',
  assetId, failureMode,
  trigger: 'critical-failure' | 'recurrence',
  woIds: string[],
  createdAt: ISOString,
  d1_team, d2_problem, d3_containment, d4_rootCause,
  d5_correctiveActions, d6_verify, d7_preventive, d8_closure
}
```
`evaluate` is pure with respect to already-seen keys: idempotent on repeated/overlapping input.

## AC → design mapping
| AC | Design mechanism |
|---|---|
| AC-F04-1 | `isCritical` flags any WO with `priority==='P1'`; such a key always yields trigger `critical-failure`, checked before recurrence logic. |
| AC-F04-2 | `isRecurrent` requires group length ≥2 or any WO `occurrences>=3`; else no CAR opens for that key (e.g. single P2 WO). |
| AC-F04-3 | `byKey` map keyed by `assetId|failureMode`; `evaluate` skips keys already present, guaranteeing at most one CAR per key, ever. |
| AC-F04-4 | `buildCar` always sets id via zero-padded `seq` (`CAR-nnn`) and fills D1–D8 from WO fields + handbook lookup; no field left blank. |

## Security & data classification
- CAR data (asset id, failure mode, WO ids, root-cause text) is **C2 Confidential** per org classification — reveals process/plant weaknesses, same class as work orders and anomalies.
- Data lives only on the edge node in process memory; no cloud sync, no external write inside this module. Any later sync is out of scope and must go through the plant's approved C2 transport path.
- The module is strictly **read-only toward OT**: it only reads WO objects passed by the caller (sourced from F03); it never writes to OT systems or issues work orders itself.
- Input validation: `evaluate` ignores WO entries missing `assetId`, `failureMode`, or `priority`; unknown `priority` values are treated as non-critical; `occurrences` defaults to 1 if absent/non-numeric.
- Per org privacy standard, CARs carry asset ids only — never operator/technician names.

## Reused team decisions
- AC-F04-4's `CAR-nnn` id format and mandatory full 8D fields, as recorded by nova/sentinel/atlas.
- Org privacy standard: reference people by pseudonymous id/role; CARs carry asset ids, never operator names.
- F03 WO shape (`assetId`, `failureMode`, `priority`, `occurrences`, `id`, `tasks`) consumed as-is; no anomaly/inventory access, per the plan's stated dependency boundary.
- Data classification table (C2 for CARs/work orders) from the security design doc.
