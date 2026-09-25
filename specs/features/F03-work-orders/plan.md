# F03 · Automated work orders — Plan

## Summary
Automatically convert F02 anomalies into prioritized, de-duplicated work orders (WO) carrying playbook tasks and reserved F05 inventory parts, so planners no longer hand-key CMMS entries.

## User stories
- As a planner, I want anomalies mapped to WO priority by severity so I triage correctly. (AC-F03-1)
- As a planner, I want repeat faults on the same asset to update one WO instead of spawning duplicates so my queue stays clean. (AC-F03-2)
- As a technician, I want the WO to already include tasks and reserved parts so I can start work immediately. (AC-F03-3)
- As a planner, I want closing a WO to consume reserved parts and free the asset/failure-mode slot so a new fault can raise a fresh WO. (AC-F03-4)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F03-1 | critical→P1, high→P2, medium→P3, low→no WO | `fromAnomaly` severity mapping |
| AC-F03-2 | one open WO per asset+failure mode; repeats increment `occurrences`, escalate priority | `fromAnomaly` dedup lookup |
| AC-F03-3 | WO carries playbook tasks and reserves parts | `fromAnomaly` playbook + inventory reservation |
| AC-F03-4 | close consumes reserved parts, allows new WO | `close(id)` |

## Contract
`createWorkOrderService({ inventory })` → `{ fromAnomaly(anomaly): WO|null, close(id), list(), get(id) }`

```
WO = { id, assetId, assetType, failureMode, priority: P1..P3, slaHours, status,
       title, tasks[], parts: [{ sku, qty, reserved, shortfall }], occurrences,
       anomalyIds[], createdAt, lastSeen, history[], deduplicated }
```
Module: `edge/features/F03-work-orders/index.js`, exports `createWorkOrderService`.

## Dependencies
- F02 (anomaly stream, severity classification) — input to `fromAnomaly`.
- F05 (`createInventory`) — used to reserve parts on create and release/consume on close.

## Non-goals
Technician scheduling; ERP integration.

## Risks
Parts shortfall must not block WO creation — WO status becomes `waiting_parts` with `shortfall` recorded per part; no PII (technician/operator names) ever stored on WO, asset ids only.

## Telemetry & evals
Behavioural eval: 6-fault replay across faulted assets raises exactly one WO per asset+failure-mode pair, with 0 duplicates and 0 stray records (per Sentinel's 4/4 pass report: 6 WOs for 4 faulted assets).

## Definition of done
- All AC-F03-1..4 pass acceptance tests.
- `createWorkOrderService` exported per contract shape.
- Dedup verified against F02 replay scenario.
- Parts reservation/consumption round-trips correctly with F05 `createInventory`.
- No technician/operator PII in WO records.
