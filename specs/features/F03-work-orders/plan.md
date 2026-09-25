# F03 · Automated work orders — Plan

## Summary
`createWorkOrderService` converts qualifying anomalies (medium+ severity) into de-duplicated work orders (WO) with priority, playbook tasks, and reserved parts, integrating with F02 (anomaly source) and F05 (inventory).

## User stories
- As a planner, I want anomalies mapped to correct priority so I triage the right faults first. (AC-F03-1)
- As a planner, I want duplicate faults on the same asset to merge into one WO so I'm not spammed. (AC-F03-2)
- As a technician, I want the WO to already list tasks and reserved parts so I can start work immediately. (AC-F03-3)
- As a planner, I want closing a WO to consume its parts and free the asset/failure-mode for a future WO. (AC-F03-4)

## AC traceability table
| AC | Covered by |
|---|---|
| AC-F03-1 | severity→priority mapping in `fromAnomaly`; low severity returns `null` |
| AC-F03-2 | open-WO lookup keyed by `assetId`+`failureMode`; `occurrences++`, priority escalation |
| AC-F03-3 | playbook lookup + `inventory.reserve(...)` populates `tasks`, `parts` |
| AC-F03-4 | `close(id)` calls `inventory.consume(...)`, sets status closed, unblocks new WO |

## Contract
```
createWorkOrderService({ inventory }) → {
  fromAnomaly(anomaly): WO|null,
  close(id): WO,
  list(): WO[],
  get(id): WO
}
```
WO shape as specified in spec, including `priority`, `status`, `tasks[]`, `parts[]`, `occurrences`, `history[]`, `deduplicated`.

## Dependencies
- **F02** Streaming anomaly detection — supplies `anomaly` objects (assetId, assetType, failureMode, severity) consumed by `fromAnomaly`.
- **F05** Spare-parts inventory tracking — `inventory.reserve`/`inventory.consume` used for parts lifecycle; shortfalls set WO status `waiting_parts` but never block creation.

## Non-goals
Technician scheduling; ERP integration; low-severity anomaly handling.

## Risks
- Parts shortfall must not block WO creation — WO enters `waiting_parts` status instead.
- Race conditions between concurrent anomalies for same asset+failure mode could create duplicate WOs if dedup lookup isn't atomic.
- Escalation logic must not downgrade priority on a less severe repeat.

## Telemetry & evals
Behavioural eval: replay a 6-fault scenario across 4 assets; expect exactly one open WO per (asset, failure mode) pair, zero duplicates, zero stray records (confirmed by sentinel test report: 6 WOs / 4 assets / 0 dupes).

## Definition of done
- All 4 ACs pass acceptance suite exactly (method names, return shapes, field names as specified).
- `fromAnomaly` correctly no-ops on low severity.
- Dedup and escalation verified via repeated-anomaly tests.
- Parts reservation/consumption round-trips verified against F05 `createInventory`.
- No technician/operator names appear in WO records — asset ids only.
