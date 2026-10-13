# F03 · Automated work orders — Plan

## Summary
Automatically raise, deduplicate, and close work orders (WOs) from F02 anomalies, with priority derived from severity, playbook tasks attached, and parts reserved/consumed via F05 inventory.

## User stories
- As a planner, I want medium+ severity anomalies to raise a prioritized WO automatically, so that I don't re-key alarms. (AC-F03-1)
- As a planner, I want repeat faults on the same asset/failure mode to update one WO instead of spawning duplicates, so that the CMMS stays clean. (AC-F03-2)
- As a technician, I want each WO to include the right playbook tasks and reserved parts, so that I can start work immediately. (AC-F03-3)
- As an inventory manager, I want closing a WO to consume its reserved parts and free the asset for a new WO, so that stock stays accurate. (AC-F03-4)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F03-1 | critical→P1, high→P2, medium→P3; low raises none | `fromAnomaly` severity→priority map |
| AC-F03-2 | ≤1 open WO per asset+failureMode; `occurrences` increments; escalation on more severe repeat | `fromAnomaly` dedup lookup + escalation logic |
| AC-F03-3 | WO carries playbook tasks and reserves parts | `fromAnomaly` playbook lookup + `inventory.reserve` |
| AC-F03-4 | Close consumes reserved parts; reopens allowed | `close(id)` calling `inventory.consume(woId)` |

## Contract
`createWorkOrderService({ inventory })` → `{ fromAnomaly(anomaly): WO|null, close(id), list(), get(id) }`.
`WO = { id, assetId, assetType, failureMode, priority: P1..P3, slaHours, status, title, tasks[], parts: [{ sku, qty, reserved, shortfall }], occurrences, anomalyIds[], createdAt, lastSeen, history[], deduplicated }`.
Inventory calls: `reserve(sku, qty, woId)` on raise, `consume(woId)` on close, `release(woId)` on cancel. No `inventory` → treat parts as fully reserved.

## Dependencies
- **F02** supplies `Anomaly` objects (severity, failureMode, assetId, assetType) consumed by `fromAnomaly`.
- **F05** supplies `createInventory` instance passed into `createWorkOrderService({ inventory })`; reservation reference is always the WO id.

## Non-goals
Technician scheduling; ERP integration.

## Risks
Parts shortfall must not block WO creation — WO status becomes `waiting_parts` with `shortfall` recorded per part; de-duplication keying must be exact on (assetId, failureMode) to avoid duplicate CMMS entries.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay raises exactly one WO per faulted asset, zero duplicates. Track counts of WOs by priority and `waiting_parts` incidence.

## Definition of done
All 4 ACs pass in acceptance suite; `createWorkOrderService` exported with exact method/field names; eval scenario produces 1 WO per faulted asset with 0 duplicates; no technician or operator names appear in WO records, only asset ids.
