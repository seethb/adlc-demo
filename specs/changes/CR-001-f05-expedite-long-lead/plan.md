# CR-001 Impact Analysis — F05 Expedite Long-Lead Critical Spares

## Summary
CR-001 adds early reorder and expedite metadata for long-lead critical spares (leadTimeDays ≥ 14) in `edge/features/F05-inventory/index.js`, plus immediate requisitioning of already-short parts on creation and richer `list()` output.

## Motivation
F05 reorders only at `available ≤ reorderPoint`, leaving 21–30 day lead-time parts (impeller, valve trim, varnish) exposed, and parts already short at startup get no requisition until touched. CR-001 closes both gaps.

## Impact
**Changes:**
- Reorder trigger becomes SKU-conditional: long-lead parts (leadTimeDays ≥ 14) trigger at `available ≤ reorderPoint + 1`; others unchanged at `available ≤ reorderPoint`.
- Requisition objects gain `priority` (`expedite`/`normal`), `etaDays` (`ceil(leadTimeDays/2)` or `leadTimeDays`), and `reason`.
- `createInventory(parts)` now scans all parts at construction and raises one open requisition for any already at/below threshold.
- `list()` adds `low` flag computed with the same threshold logic.

**Stays the same:**
- `createInventory` contract shape: `reserve, release, consume, receive, available, list, lowStock, requisitions, reservations`.
- Reservation, release, consume, receive mechanics (AC-F05-1/2/4).
- Unknown-SKU error behavior (AC-F05-5).
- Never more than one open requisition per SKU.

## AC Traceability
| AC | Covered by |
|---|---|
| AC-CR001-1 | Threshold branch: long-lead (≥14d) uses reorderPoint+1, else reorderPoint |
| AC-CR001-2 | Requisition builder sets priority/etaDays/reason per leadTimeDays |
| AC-CR001-3 | Constructor-time scan raising requisitions for already-short parts |
| AC-CR001-4 | `list()` mapping includes `low` using CR-001-1 threshold |
| AC-CR001-5 | Regression suite rerun, no logic change to reserve/release/consume/receive paths |
| AC-F05-1 | `reserve()` unchanged, shortfall reporting intact |
| AC-F05-2 | `release()`/consume restock logic untouched |
| AC-F05-3 | Single open-requisition-per-SKU invariant preserved, extended with new fields |
| AC-F05-4 | `receive()` restock/close logic untouched |
| AC-F05-5 | Unknown SKU validation untouched |

## Risks & Rollback
Risk: threshold change could double-fire requisitions if not guarded by existing "one open requisition per SKU" invariant — mitigated by reusing that check. Rollback: redeploy previous gateway build on edge-staging; no data migration needed since requisition schema is additive.

## Rollout
Deploy to `edge-staging` via Helm after human approval; edge gateway restarts to pick up new build. Edge Ops UI should show expedite priority/etaDays on critical-spare requisitions post-restart.

## Definition of Done
All AC-CR001-1..5 and AC-F05-1..5 pass in `specs/changes/CR-001-f05-expedite-long-lead.acceptance.test.js`; contract shape unchanged; deployed and verified on edge-staging.
