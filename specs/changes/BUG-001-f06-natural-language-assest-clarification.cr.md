---
id: BUG-001
type: bug
feature: F06
title: Natural Language Assest clarification
priority: medium
---

# BUG-001 · Natural Language Assest clarification (F06)

## Defect
It should help to get the latest status whenever status related queries comes

## Acceptance criteria
- **AC-BUG001-1** Latest status (e.g. Asset 1- Live or Asset 2- Not Live)
- **AC-BUG001-2** Regression: AC-F06-1, AC-F06-2, AC-F06-3, AC-F06-4 still pass unchanged.

## Rollout
Released to `edge-staging` by Helm after human approval; the edge gateway restarts on the new build.
