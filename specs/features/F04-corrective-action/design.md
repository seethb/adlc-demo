# F04 · Corrective Action Reports (CAR) — Design

## Module structure (`edge/features/F04-corrective-action/index.js`)

Internal state (module-closure, in-memory, edge-resident):
- `cars: CAR[]` — all CARs created so far, append-only.
- `index: Map<string, string>` — dedup map keyed by `${asset}::${failureMode}` → CAR id (AC-F04-3).
- `seq: number` — counter for `CAR-nnn` id generation (AC-F04-4).

Functions:
- `createCarService()` → returns `{ evaluate, list }`.
- `evaluate(workOrders)` (exported via closure) — `// AC-F04-1 // AC-F04-2 // AC-F04-3`: validates input, groups WOs by asset+failureMode, applies trigger rules, calls `openCar` for new cases only, returns newly created CARs.
- `list()` — returns a shallow copy of `cars`.
- `groupByAssetFailureMode(workOrders)` (internal helper) — builds `{ asset, failureMode, wos, occurrences }` groups.
- `decideTrigger(group)` (internal helper) — `// AC-F04-1 // AC-F04-2`: returns `"critical-failure"` if any WO priority is `P1`; else `"recurrence"` if `wos.length >= 2` or any single WO has `occurrences >= 3`; else `null`.
- `buildCar(group, trigger)` (internal helper) — `// AC-F04-4`: allocates `CAR-nnn` id, fills D1–D7 from the group and the reliability knowledge base (D4, D7), never invents text.
- `validateWorkOrder(wo)` (internal helper) — rejects malformed WOs: missing `asset`/`failureMode`, non-finite counts, unknown priority values.

## Contract signatures

```js
createCarService() → {
  evaluate(workOrders: WorkOrder[]): CAR[],  // newly created CARs only
  list(): CAR[]
}

WorkOrder (from F03) = {
  id: string, asset: string, failureMode: string,
  priority: "P1"|"P2"|"P3", occurrences: number, status: string, ...
}

CAR = {
  id: "CAR-nnn",
  asset: string,
  failureMode: string,
  trigger: "critical-failure" | "recurrence",
  d1: string, // team: reliability engineering
  d2: string, // problem: asset, failure mode, WO/occurrence count
  d3: string, // containment
  d4: string, // root-cause hypothesis, from KB
  d5: string, // corrective actions, from WO playbook
  d6: string, // verify (7 days no recurrence)
  d7: string  // preventive action
}
```

## AC → design mapping

| AC id | Design element |
|---|---|
| AC-F04-1 | `decideTrigger` returns `"critical-failure"` when any WO in group has `priority === "P1"`; `evaluate` opens a CAR for it |
| AC-F04-2 | `decideTrigger` recurrence branch: `wos.length >= 2` or any `occurrences >= 3`; single P2 with no repeat yields `null`, no CAR |
| AC-F04-3 | `index` map keyed by `asset::failureMode` checked before `openCar`; re-running `evaluate` on same input creates no duplicates (idempotent) |
| AC-F04-4 | `buildCar` allocates sequential `CAR-nnn` via `seq`, and populates d1..d7 all non-empty before pushing to `cars` |

## Security & data classification
CARs and work orders are **C2 Confidential** (production capacity/process-weakness data). They live edge-resident only, in module memory — no cloud sync, no OT write path. Per org privacy standard, CARs reference **asset ids and failure-mode ids only**, never operator/technician names — d1 "team" is a role label, not a person. All inputs (`workOrders`) are treated as untrusted per IoT security standard: `validateWorkOrder` rejects non-finite `occurrences`, unknown priority values, and missing asset/failureMode before grouping. Module is strictly read-only towards OT: `evaluate`/`list` never write PLC registers, coils or setpoints; CAR output is advisory only. D4/D7 text must be sourced from the reliability knowledge base/failure-mode handbook, never generated inline, per the feature's risk note.

## Reused team decisions
- CAR shape and field set reused verbatim from `adlc:atlas · F04/plan`.
- F03's `createWorkOrderService` output shape (`adlc:atlas · F03/plan`) is the sole input contract for `evaluate`.
- Data classification (C2 confidential for CARs/work orders) and read-only-towards-OT stance reused from the org IoT security standard and F01's precedent (`adlc:orion`).
- Pseudonymous-id-only privacy rule applied to all CAR fields per org privacy standard.
