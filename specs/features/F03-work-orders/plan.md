# F03 · Automated work orders — plan

## Summary
Service that converts anomalies into work orders (WOs): maps severity to priority, de-duplicates per asset+failure mode, attaches playbook tasks, reserves parts via F05 inventory, and handles close-out consumption.

## User stories
- As a planner, I want anomalies to auto-generate correctly prioritized WOs so I don't triage severity manually. (AC-F03-1)
- As a planner, I want repeated faults on the same asset to update one WO instead of spawning duplicates, escalating priority if severity worsens. (AC-F03-2)
- As a technician, I want a WO to arrive with playbook tasks and reserved parts so I can start work immediately. (AC-F03-3)
- As a technician, I want closing a WO to consume reserved parts and free the asset/failure mode for a future WO. (AC-F03-4)

## AC traceability
| AC | Covered by |
|---|---|
| AC-F03-1 | `fromAnomaly` severity→priority map (critical→P1, high→P2, medium→P3, low→null) |
| AC-F03-2 | dedup index keyed by `assetId+failureMode`; increments `occurrences`; escalates `priority` on worse repeat |
| AC-F03-3 | playbook lookup by failureMode+assetType attaches `tasks`; `inventory.reserve` populates `parts` |
| AC-F03-4 | `close(id)` calls `inventory.consume` per reserved part, sets status closed, clears dedup slot |

## Contract
`createWorkOrderService({ inventory })` → `{ fromAnomaly(anomaly): WO|null, close(id), list(), get(id) }`.

```
WO = { id, assetId, assetType, failureMode, priority: P1..P3, slaHours, status,
       title, tasks[], parts: [{ sku, qty, reserved, shortfall }], occurrences, anomalyIds[],
       createdAt, lastSeen, history[], deduplicated }
```
Status includes `open`, `waiting_parts`, `closed`. `status` becomes `waiting_parts` if `inventory.reserve` reports shortfall; WO creation must never fail on shortfall.

## Dependencies
- F02 (anomaly detection) supplies `anomaly` objects with `severity`, `assetId`, `assetType`, `failureMode`.
- F05 (`createInventory`) supplies `reserve(sku, qty, woId)` and `consume(...)` used for parts lifecycle.

## Non-goals
Technician scheduling; ERP integration.

## Risks
- Parts shortfall must not block WO creation — WO goes to `waiting_parts` (per spec).
- Playbook/task catalogue completeness for all failure modes is assumed, not validated here.
- Race between concurrent anomalies for same asset+failureMode must not create two open WOs.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay raises exactly one WO per faulted asset, verifying dedup (AC-F03-2) and priority mapping (AC-F03-1). WO ids and asset ids only — no operator/technician names in telemetry (per org privacy standard).

## Definition of done
- `edge/features/F03-work-orders/index.js` exports `createWorkOrderService` per contract.
- AC-F03-1..4 covered by passing acceptance tests.
- 6-fault replay eval produces exactly one WO per faulted asset.
- Integrates with F05 inventory via `reserve`/`consume`; no negative availability introduced.
