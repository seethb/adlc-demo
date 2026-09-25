# F03 · Automated work orders — Plan

## Summary
`createWorkOrderService({ inventory })` converts qualifying anomalies from F02 into deduplicated work orders (WO), attaches playbook tasks, reserves parts via F05, and handles close-out. Asset/technician identity stays pseudonymous; no PII in WO records.

## User stories
- As a planner, I want anomalies mapped to correctly prioritized WOs so I triage the right faults first. (AC-F03-1)
- As a planner, I want repeated faults on the same asset to update one WO instead of spamming duplicates, escalating priority if severity worsens. (AC-F03-2)
- As a technician, I want a WO to include its playbook tasks and already-reserved parts so I can act immediately. (AC-F03-3)
- As an inventory owner, I want closing a WO to consume reserved stock and free the asset/failure-mode slot for a new WO. (AC-F03-4)

## Acceptance criteria traceability
| AC | Description | Covered by |
|---|---|---|
| AC-F03-1 | critical→P1, high→P2, medium→P3; low raises none | `fromAnomaly` severity→priority map |
| AC-F03-2 | one open WO per asset+failure mode; occurrences increment; escalate on more severe repeat | `fromAnomaly` dedup lookup by (assetId, failureMode, status=open) |
| AC-F03-3 | WO carries playbook tasks and reserves parts | `fromAnomaly` playbook lookup + `inventory.reserve` |
| AC-F03-4 | closing consumes reserved parts; new WO can open after | `close(id)` calling `inventory.consume`, then status=closed frees dedup slot |

## Contract
```
createWorkOrderService({ inventory }) → {
  fromAnomaly(anomaly): WO|null,
  close(id): WO,
  list(): WO[],
  get(id): WO
}
WO = { id, assetId, assetType, failureMode, priority, slaHours, status,
       title, tasks[], parts:[{sku,qty,reserved,shortfall}], occurrences,
       anomalyIds[], createdAt, lastSeen, history[], deduplicated }
```

## Dependencies
- F02 (Streaming anomaly detection): source of anomalies passed to `fromAnomaly`.
- F05 (Spare-parts inventory tracking): `inventory.reserve`/`consume` for parts lifecycle.

## Non-goals
Technician scheduling; ERP integration.

## Risks
Parts shortfall must not block WO creation — WO status becomes `waiting_parts` with `shortfall` recorded on affected parts; escalation logic must not double-increment `occurrences` when just updating priority.

## Telemetry & evals
Behavioural eval: 6-fault scenario replay must raise exactly one WO per faulted asset with zero duplicates and zero stray records (matches Sentinel's test report: 6 WOs / 4 assets, 0 dup, 0 stray). Emit `wo.created`, `wo.escalated`, `wo.closed` events keyed by asset id only — no operator/technician names.

## Definition of done
All 4 ACs pass acceptance suite; module exports match contract exactly; dedup and escalation verified via replay eval; parts reservation/consumption round-trips with F05; no PII in any WO field; design doc's read-only OT posture and input validation honored.
