---
id: F04
slug: F04-corrective-action
title: Corrective Action Reports (CAR)
owner: nova
priority: should
depends: [F03]
module: edge/features/F04-corrective-action/index.js
reference: edge/reference/car.js
exports: createCarService
---

# F04 · Corrective Action Reports (CAR)

## Problem
Repeat failures get fixed but never root-caused. Critical failures and recurring
failure modes must open an 8D-style CAR for the reliability team automatically.

## Scope
Trigger rules, de-duplication, pre-filled 8D fields (D2 problem, D3 containment,
D4 root-cause hypothesis, D5 corrective actions, D7 preventive action).

**Non-goals:** CAR approval workflow; supplier CARs.

## Contract
`createCarService()` → `{ evaluate(workOrders): CAR[] /* newly created */, list() }`.

## Acceptance criteria
- **AC-F04-1** Any P1 work order opens a CAR with trigger `critical-failure`.
- **AC-F04-2** Recurrence — two or more WOs, or one WO seen three or more times, for the same asset + failure mode — opens a CAR with trigger `recurrence`; a single P2 does not.
- **AC-F04-3** At most one CAR per asset + failure mode.
- **AC-F04-4** A CAR has id `CAR-nnn` and every 8D field filled in.

## Telemetry & evals
Behavioural eval: a replay with one critical and one recurring fault opens exactly two CARs.

## Risks
Root-cause text must come from the reliability knowledge base, not be invented.
