# F03 · Automated work orders — Plan

## Summary
Automates raising, deduplicating, and closing CMMS work orders (WOs) from F02 anomalies, mapping severity to priority, attaching playbook tasks, and reserving parts via F05 inventory.

## User stories
- As a planner, I want medium+ severity anomalies to auto-raise a prioritized WO so that I don't manually re-key alarms. (AC-F03-1)
- As a planner, I want repeated faults on the same asset/failure mode to update one WO instead of creating duplicates so that my queue stays clean. (AC-F03-2)
- As a technician, I want the WO to include playbook tasks and reserved parts so that I can start work immediately. (AC-F03-3)
- As a planner, I want closing a WO to consume reserved parts and allow a new WO to open on recurrence so that inventory and status stay accurate. (AC-F03-4)

## Acceptance criteria traceability

| AC id | Description | Covered by |
|---|---|---|
| AC-F03-1 | critical→P1, high→P2, medium→P3; low raises none | `fromAnomaly` severity map |
| AC-F03-2 | one open WO per asset+failure mode; occurrences increment; escalation on repeat | `fromAnomaly` dedup lookup |
| AC-F03-3 | WO carries playbook tasks and reserves parts | `fromAnomaly` playbook + inventory reserve |
| AC-F03-4 | closing consumes reserved parts; reopen allowed | `close(id)` |

## Contract
`createWorkOrderService({ inventory })` → `{ fromAnomaly(anomaly): WO|null, close(id), list(), get(id) }`.

`WO = { id, assetId, assetType, failureMode, priority: P1..P3, slaHours, status, title, tasks[], parts: [{sku, qty, reserved, shortfall}], occurrences, anomalyIds[], createdAt, lastSeen, history[], deduplicated }`.

## Dependencies
- F02 (streaming anomaly detection): source of anomalies fed into `fromAnomaly`.
- F05 (spare-parts inventory): `inventory.reserve`/`consume` used for parts; must handle shortfall without blocking WO creation.

## Non-goals
Technician scheduling; ERP integration; operator/technician identity in WO records (asset ids only, per privacy standard).

## Risks
- Parts shortfall must not block WO creation — WO enters `waiting_parts` status with `shortfall` recorded per part.
- Escalation logic must not create a second WO; must escalate existing open WO's priority in place.
- Reference to OT/CMMS systems is read-only; no write-back beyond internal WO store.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay must raise exactly one WO per faulted asset, with occurrences correctly incremented, zero duplicates, zero stray records (confirmed by Sentinel's report: 6 WOs / 4 assets, 0 duplicates).

## Definition of done
- `edge/features/F03-work-orders/index.js` exports `createWorkOrderService` per contract.
- AC-F03-1..4 all pass in acceptance suite (4/4 confirmed by Sentinel).
- Dedup and escalation logic verified against repeat-fault fixtures.
- Parts reservation/consumption verified against F05 `createInventory`.
- Design doc includes Security & Data Classification section (read-only OT posture, input validation, asset-id-only records).
