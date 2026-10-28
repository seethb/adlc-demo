---
id: CR-003
type: change
feature: F05
title: Create a alert for spare parts below 2 items
priority: medium
---

# CR-003 · Create a alert for spare parts below 2 items (F05)

## Why
this has to indicate whether parts are going beyond the minimum order level.

## Acceptance criteria
- **AC-CR003-1** Below 2 items should be alerted.
- **AC-CR003-2** Regression: AC-F05-1, AC-F05-2, AC-F05-3, AC-F05-4, AC-F05-5 still pass unchanged.

## Rollout
Released to `edge-staging` by Helm after human approval; the edge gateway restarts on the new build.
