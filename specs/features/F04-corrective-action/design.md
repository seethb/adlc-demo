# F04 · Corrective Action Reports (CAR) — Design

## Module structure
`edge/features/F04-corrective-action/index.js` exports `createCarService()`.

Internal state (closure, in-memory, not persisted):
- `cars: CAR[]` — all CARs created across calls, insertion order.
- `seenKeys: Set<string>` — `assetId|failureMode` keys already covered (AC-F04-3).
- `seq: number` — counter for `CAR-nnn` ids.

Internal helpers (not exported):
- `keyOf(wo)` → `${wo.assetId}|${wo.failureMode}`.
- `isCritical(wo)` → `wo.priority === 'P1'`.
- `isRecurrence(group)` → group of WOs sharing a key has `length >= 2` OR any single WO has `occurrences >= 3`.
- `nextId()` → `CAR-${String(++seq).padStart(3,'0')}`.
- `lookupRootCause(failureMode)` → queries reliability failure-mode handbook (static map/table bundled with module); falls back to a clearly-marked hypothesis string `"hypothesis: <failureMode> — unconfirmed, pending inspection"` if no handbook entry, per the risk note — never fabricated as fact.
- `buildCar(wo, trigger, groupWos)` → assembles the 8D object.

## Contract signatures
```
createCarService() → { evaluate(workOrders), list() }

evaluate(workOrders: WO[]) → CAR[]   // only newly created CARs this call
list() → CAR[]                      // all CARs ever created

CAR = {
  id: 'CAR-001', assetId, failureMode,
  trigger: 'critical-failure' | 'recurrence',
  workOrderIds: string[], createdAt: ISOString,
  d1_team: 'reliability engineering',
  d2_problem: string,        // asset, failure mode, WO count, occurrence count
  d3_containment: string,    // P1 → load reduction/standby; else increase inspection
  d4_rootCause: string,      // handbook text or marked hypothesis
  d5_correctiveActions: string[],  // playbook tasks from WO.tasks
  d6_verify: string,         // '7 days without recurrence'
  d7_preventive: string      // monitoring/procedure change text
}
```
`evaluate` groups input WOs by `keyOf`, checks each group against trigger rules, skips any key already in `seenKeys`, builds at most one CAR per new key, adds it to `cars`/`seenKeys`, returns the new ones.

## AC → design mapping
| AC id | Design element |
|---|---|
| AC-F04-1 | `isCritical(wo)` true for any WO in group → `trigger: 'critical-failure'`, checked before recurrence rule |
| AC-F04-2 | `isRecurrence(group)`: group.length>=2 or any wo.occurrences>=3 → `trigger: 'recurrence'`; single P2 WO with occurrences<3 fails both checks → no CAR |
| AC-F04-3 | `seenKeys` guard in `evaluate`: once a key has a CAR, later groups with same key are skipped, no duplicates across calls |
| AC-F04-4 | `nextId()` guarantees `CAR-nnn`; `buildCar` always sets all seven D-fields, never undefined/empty |

## Security & data classification
CARs are **C2 Confidential** (per org data classification: work orders, CARs reveal process/plant weaknesses). Module:
- Reads only `assetId`/`failureMode`/`priority`/`occurrences`/`id`/`tasks` from F03 WOs — never operator/technician names (org privacy standard: asset ids only).
- Read-only toward OT: this module never writes to OT systems or work orders; it only consumes WO data and produces CARs for the reliability team.
- All state stays on-edge in-memory (C2 data must not leave edge boundary without explicit cloud sync policy, out of scope here).
- Input validation: `evaluate` defensively skips WOs missing `assetId`/`failureMode`; does not throw on malformed input, simply excludes it from grouping.
- No secrets, no PII, no raw telemetry handled by this module.

## Reused team decisions
- Followed F03's exact WO shape (`assetId`, `failureMode`, `priority`, `occurrences`, `id`, `tasks`) as the sole input contract.
- Applied org privacy standard: CARs carry asset ids only, never technician/operator names.
- Applied C2 classification from the security design doc to CARs/work orders.
- Used the 8D procedure field definitions (D1–D7) from the recalled reliability knowledge-base section verbatim for `buildCar`.
