---
id: CR-004
type: change
feature: F05
title: Prepare a notification for any spare parts requests from the inventory when the spare part
priority: medium
---

# CR-004 · Prepare a notification for any spare parts requests from the inventory when the spare part (F05)

## Why
This is to maintain the reorder quantitylevel and tracking how we are performing the inventory

## Acceptance criteria
- **AC-CR004-1** Less than 10 parts count.
- **AC-CR004-2** Regression: AC-F05-1, AC-F05-2, AC-F05-3, AC-F05-4, AC-F05-5 still pass unchanged.

## Rollout
Released to `edge-staging` by Helm after human approval; the edge gateway restarts on the new build.
