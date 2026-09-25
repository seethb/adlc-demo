# F03 · Automated work orders — Plan

## Summary
`createWorkOrderService` converts F02 anomalies into deduplicated, prioritized work orders (WOs), attaching playbook tasks and reserving parts via F05 inventory. WOs go through raise → (waiting_parts) → close, with escalation and occurrence tracking for repeat faults.

## User stories
- As a planner, I want critical/high/medium anomalies auto-raised as P1/P2/P3 WOs, and low severity ignored, so that I don't triage noise. (AC-F03-1)
- As a planner, I want repeat faults on the same asset/failure mode to update one open WO instead of spawning duplicates, escalating priority if severity worsens. (AC-F03-2)
- As a technician, I want each WO to include playbook tasks and pre-reserved parts so I can act immediately. (AC-F03-3)
- As a planner, I want closing a WO to consume reserved parts and allow a fresh WO to open for a new occurrence. (AC-F03-4)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F03-1 | Severity→priority mapping; low raises nothing | `fromAnomaly` severity switch |
| AC-F03-2 | Dedup per asset+failureMode; occurrences increment; escalation | open-WO lookup index |
| AC-F03-3 | Playbook tasks + part reservation | `fromAnomaly` → `inventory.reserve` |
| AC-F03-4 | Close consumes reserved parts; reopen allowed | `close` → `inventory.consume` |

## Contract
`createWorkOrderService({ inventory })` → `{ fromAnomaly(anomaly): WO|null, close(id), list(), get(id) }`. `inventory` optional (defaults to fully-reserved parts). Reservation/consumption always keyed by WO id (`reserve(sku, qty, woId)`, `consume(woId)`, `release(woId)`), never by sku+qty directly.

## Dependencies
- F02 (`createDetector`) supplies `Anomaly` objects consumed by `fromAnomaly`.
- F05 (`createInventory`) supplies reservation/consumption; F03 must call it exactly per its contract, storing `reserved`/`shortfall` per part.

## Non-goals
Technician scheduling; ERP integration.

## Risks
Parts shortfall must not block WO creation; such WOs enter `waiting_parts` status with `shortfall` recorded per part, not rejected.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay must raise exactly one WO per faulted asset (no duplicates, no stray records). Track WO counts by priority and shortfall occurrences for ops dashboards; no operator/technician names in WO records, only asset ids.

## Definition of done
- All 4 ACs pass acceptance suite with exact method/field names per contract.
- Dedup logic verified: only one open WO per asset+failureMode; occurrences and escalation correct.
- Reservation/consume/release calls match F05 contract exactly, keyed by WO id.
- Shortfall handling sets `waiting_parts` without blocking WO creation.
- Design doc's Security & Data Classification constraints (read-only OT, asset-id-only records) respected in implementation.
