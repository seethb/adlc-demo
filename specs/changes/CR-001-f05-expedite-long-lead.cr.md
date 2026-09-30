---
id: CR-001
type: change
feature: F05
title: Expedite long-lead critical spares
priority: high
requestedBy: TM-06
tests: specs/changes/CR-001-f05-expedite-long-lead.acceptance.test.js
---

# CR-001 · Expedite long-lead critical spares (F05)

## Why
F05 is live on edge-staging. Its spec already names the risk: long-lead parts (impellers,
anti-surge valve trim, winding varnish) need visibility before the work order is raised.
Today a long-lead part is reordered only when it reaches its reorder point, so a 21–30 day
lead time leaves the plant exposed, and a part that is already short when the gateway
starts is not reordered at all until someone touches it.

## Change
- Long-lead parts (`leadTimeDays ≥ 14`) are critical spares: they reorder one unit early,
  at `available ≤ reorderPoint + 1`.
- Every requisition carries a `priority`, an `etaDays` and a `reason`. Critical spares are
  `expedite` with the lead time halved (`etaDays = ceil(leadTimeDays / 2)`); everything
  else is `normal` with `etaDays = leadTimeDays`.
- When the inventory is created, any part already at or below its threshold gets its one
  open requisition straight away.
- `list()` returns the part-master fields the edge UI shows.

**Unchanged:** the F05 contract (`createInventory`) and AC-F05-1 … AC-F05-5. F03 still
reserves, releases and consumes by work-order id.

## Acceptance criteria
- **AC-CR001-1** Long-lead parts (leadTimeDays ≥ 14) reorder one unit early: a requisition is raised once available ≤ reorderPoint + 1; other parts still reorder at available ≤ reorderPoint.
- **AC-CR001-2** Requisitions carry `priority`, `etaDays` and `reason`: `expedite` with etaDays = ceil(leadTimeDays / 2) for long-lead parts, `normal` with etaDays = leadTimeDays otherwise.
- **AC-CR001-3** On creation, every part already at or below its reorder threshold gets exactly one open requisition immediately.
- **AC-CR001-4** `list()` returns `sku, name, onHand, reserved, available, reorderPoint, leadTimeDays, low`, where `low` uses the same threshold as AC-CR001-1.
- **AC-CR001-5** Regression: AC-F05-1 … AC-F05-5 still pass unchanged.

## Rollout
Released to `edge-staging` by Helm after human approval. The edge gateway restarts on the
new build; the Edge Ops inventory and requisitions show the expedited critical spares.
Rollback: switch the gateway back to the previous build.
