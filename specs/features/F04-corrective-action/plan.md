# F04 · Corrective Action Reports (CAR) — Plan

## Summary
Automatically open 8D-style CARs when work orders indicate a critical failure (P1) or a recurring failure mode, de-duplicated per asset + failure mode, for the reliability team to act on.

## User stories
- As a reliability engineer, I want any P1 work order to immediately open a CAR with trigger `critical-failure`, so that critical issues get root-caused without manual tracking. (AC-F04-1)
- As a reliability engineer, I want recurring failures (same asset + failure mode, 2+ WOs or 1 WO seen 3+ times) to open a CAR with trigger `recurrence`, so that systemic issues surface even without a single critical event. (AC-F04-2)
- As a reliability engineer, I want at most one CAR per asset + failure mode, so that I'm not flooded with duplicate reports. (AC-F04-3)
- As a reliability engineer, I want each CAR to have a stable id and fully populated 8D fields, so that it's immediately actionable and auditable. (AC-F04-4)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F04-1 | P1 WO → CAR trigger `critical-failure` | `evaluate()` critical-failure rule |
| AC-F04-2 | Recurrence (2+ WOs or 1 WO seen 3+ times) → CAR trigger `recurrence`; single P2 doesn't | `evaluate()` recurrence rule |
| AC-F04-3 | At most one CAR per asset + failure mode | de-dup key = assetId+failureMode |
| AC-F04-4 | CAR id `CAR-nnn`, all 8D fields filled | CAR builder populates D1-D7 |

## Contract
Exports `createCarService()` → `{ evaluate(workOrders): CAR[] /* newly created */, list() }`.

```
CAR = { id: 'CAR-001', assetId, failureMode, trigger: 'critical-failure'|'recurrence',
        workOrderIds[], createdAt,
        d1_team, d2_problem, d3_containment, d4_rootCause,
        d5_correctiveActions, d6_verify, d7_preventive }
```
- `evaluate(workOrders)` scans input WOs (shape from F03), applies trigger rules, skips assets/failure modes already covered (AC-F04-3), returns only newly created CARs.
- `list()` returns all CARs created so far, including from prior `evaluate` calls.

## Dependencies
F03 `createWorkOrderService` — CARs are derived from WO objects (`assetId`, `failureMode`, `priority`, `occurrences`, `id`); F04 does not call F03 directly but consumes its WO shape as input to `evaluate`.

## Non-goals
CAR approval workflow; supplier CARs.

## Risks
D4 root-cause must be sourced from the reliability failure-mode handbook, not invented by the service; if no handbook entry exists, field must still be filled with a clearly-marked hypothesis, not left blank.

## Telemetry & evals
Behavioural eval: replay containing one critical and one recurring fault opens exactly two CARs. Track count of CARs opened per trigger type for dashboarding.

## Definition of done
- `evaluate` and `list` implemented per contract shapes.
- AC-F04-1..4 covered by acceptance tests and passing.
- De-dup logic verified with mixed P1/P2/recurrence scenarios.
- 8D fields never contain empty/undefined values.
- No operator/technician names in CAR records (asset ids only).
