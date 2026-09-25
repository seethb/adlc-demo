---
id: F03
slug: F03-work-orders
title: Automated work orders
owner: nova
priority: must
depends: [F02, F05]
module: edge/features/F03-work-orders/index.js
reference: edge/reference/workorders.js
exports: createWorkOrderService
---

# F03 · Automated work orders (WO)

## Problem
Planners re-key alarms into the CMMS by hand, hours late, and raise duplicates for the
same fault. Anomalies of medium severity or above should raise a WO immediately, with
the right playbook tasks and parts already reserved.

## Scope
Severity → priority mapping, de-duplication, playbook tasks per failure mode and asset
type, part reservation through the F05 inventory service, close-out.

**Non-goals:** technician scheduling; ERP integration.

## Contract
`createWorkOrderService({ inventory })` → `{ fromAnomaly(anomaly): WO|null, close(id), list(), get(id) }`.

```
WO = { id: 'WO-1001', assetId, assetType, failureMode, priority: P1..P3, slaHours, status,
       title, tasks[], parts: [{ sku, qty, reserved, shortfall }], occurrences, anomalyIds[],
       createdAt, lastSeen, history[], deduplicated }
```

### Inventory interface used (from F05 — do not guess)
The service receives an F05 inventory instance and uses exactly these calls, with the
**work-order id as the reservation reference**:

| When | Call | Notes |
|---|---|---|
| WO raised | `inventory.reserve(sku, qty, woId)` for each playbook part | returns `{ ok, reserved, shortfall }`; store `reserved` and `shortfall` on the WO part |
| WO closed | `inventory.consume(woId)` | issues every part reserved under `woId`: on-hand and reserved both drop |
| WO cancelled | `inventory.release(woId)` | returns reservations to stock |

There is no `consume(sku, qty)` — consumption is always by reference. `inventory` may be
omitted (tests pass one); when absent, treat every part as fully reserved.

## Acceptance criteria
- **AC-F03-1** critical → P1, high → P2, medium → P3; low severity raises no WO.
- **AC-F03-2** At most one open WO per asset + failure mode; repeats increment `occurrences`, and a more severe repeat escalates priority.
- **AC-F03-3** A WO carries the playbook tasks and reserves its parts in inventory.
- **AC-F03-4** Closing a WO consumes its reserved parts; a new WO may then open.

## Telemetry & evals
Behavioural eval: a 6-fault scenario replay raises exactly one WO per faulted asset.

## Risks
Parts shortfall must not block WO creation — the WO goes to `waiting_parts`.
