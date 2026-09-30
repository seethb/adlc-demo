---
id: CR-002
type: change
feature: F05
title: add notification whenever parts count goes below 5
priority: medium
---

# CR-002 · add notification whenever parts count goes below 5 (F05)

## Why
this is required to raise an alert.

## Acceptance criteria
- **AC-CR002-1** notification should pop up when we look the inventory when it goes below 5
- **AC-CR002-2** Regression: AC-F05-1, AC-F05-2, AC-F05-3, AC-F05-4, AC-F05-5 still pass unchanged.

## Rollout
Released to `edge-staging` by Helm after human approval; the edge gateway restarts on the new build.
