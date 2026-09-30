# CR-001 test report

Run cr-001-munvoeel · 30 Sept 2026, 14:34:40 IST

| | Criterion | Suite | Result |
|---|---|---|---|
| ✅ | AC-CR001-1 | CR-001 | long-lead parts reorder one unit early; others at the reorder point |
| ✅ | AC-CR001-2 | CR-001 | requisitions carry priority, etaDays and reason |
| ✅ | AC-CR001-3 | CR-001 | parts already at or below threshold get one requisition on creation |
| ✅ | AC-CR001-4 | CR-001 | list() exposes the part-master fields the edge UI shows |
| ✅ | AC-F05-1 | F05 regression | reservations never drive availability negative; shortfall is reported |
| ✅ | AC-F05-2 | F05 regression | release returns stock; consume reduces on-hand |
| ✅ | AC-F05-3 | F05 regression | one open requisition per SKU when at or below reorder point |
| ✅ | AC-F05-4 | F05 regression | receiving a requisition restocks and closes it |
| ✅ | AC-F05-5 | F05 regression | unknown SKUs throw |

**Behavioural eval:** 500 random operations · 0 negative states · 0 duplicate requisitions
