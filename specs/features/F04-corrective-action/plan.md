# F04 · Corrective Action Reports (CAR) — Plan

## Summary
CAR service inspects F03 work orders and automatically opens 8D-style Corrective Action Reports for critical failures and recurring failure modes, de-duplicated per asset + failure mode.

## User stories
- As a reliability engineer, I want any P1 work order to immediately open a CAR, so that critical failures get root-caused without manual triage. (AC-F04-1)
- As a reliability engineer, I want recurring failure modes (≥2 WOs, or one WO seen ≥3 times) on the same asset to open a CAR, so that chronic issues surface even without a single critical event. (AC-F04-2)
- As a reliability engineer, I want only one CAR per asset + failure mode, so that I'm not flooded with duplicate reports. (AC-F04-3)
- As a reliability engineer, I want each CAR pre-filled with all 8D fields and a stable `CAR-nnn` id, so that I can act on it immediately and reference it consistently. (AC-F04-4)

## Acceptance criteria traceability
| AC id | Story | Verified by |
|---|---|---|
| AC-F04-1 | critical-failure trigger | P1 WO → CAR with trigger `critical-failure` |
| AC-F04-2 | recurrence trigger | ≥2 WOs or 1 WO occurrences≥3 same asset+failure mode → trigger `recurrence`; single P2 → no CAR |
| AC-F04-3 | dedup | second evaluate() call for same asset+failure mode yields no new CAR |
| AC-F04-4 | CAR shape | id matches `CAR-nnn`, D1–D7 fields all non-empty |

## Contract (exports: createCarService)
`createCarService()` → `{ evaluate(workOrders): CAR[] /* newly created */, list(): CAR[] }`

```
CAR = { id: 'CAR-001', assetId, failureMode, trigger: 'critical-failure'|'recurrence',
        woIds[], createdAt,
        d1_team, d2_problem, d3_containment, d4_rootCause,
        d5_correctiveActions, d6_verify, d7_preventive, d8_closure }
```
`evaluate` is idempotent: re-running with the same/overlapping work orders returns only newly created CARs (AC-F04-3).

## Dependencies
F03 (`createWorkOrderService`) — CARs are derived solely from WO objects (`assetId`, `failureMode`, `priority`, `occurrences`, `id`, `tasks`); no direct anomaly or inventory access.

## Non-goals
CAR approval workflow; supplier CARs.

## Risks
D4 root-cause text must be sourced from the reliability failure-mode handbook/knowledge base, never invented; if no matching entry exists, use a clearly marked placeholder rather than fabricated text.

## Telemetry & evals
Behavioural eval: replay containing one critical (P1) WO and one recurring failure mode (per AC-F04-2 thresholds) must open exactly two CARs, each with correct trigger and no duplicates.

## Definition of done
- `createCarService` implemented at edge/features/F04-corrective-action/index.js exporting exactly this contract.
- AC-F04-1..4 covered by automated acceptance tests with exact field/method names.
- Privacy standard respected: CARs reference asset ids only, never operator/technician names.
- Behavioural eval in Telemetry section passes.
- Design doc (design.md) reflects this plan; no undocumented deviations.
