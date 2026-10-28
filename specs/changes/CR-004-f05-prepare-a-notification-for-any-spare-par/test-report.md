# CR-004 test report

Run cr-004-mvrzd0ob · 28 Oct 2026, 16:10:01 IST

| | Criterion | Suite | Result |
|---|---|---|---|
| ✅ | AC-F05-1 | F05 regression | reservations never drive availability negative; shortfall is reported |
| ✅ | AC-F05-2 | F05 regression | release returns stock; consume reduces on-hand |
| ✅ | AC-F05-3 | F05 regression | one open requisition per SKU when at or below reorder point |
| ✅ | AC-F05-4 | F05 regression | receiving a requisition restocks and closes it |
| ✅ | AC-F05-5 | F05 regression | unknown SKUs throw |

**Behavioural eval:** 500 random operations · 0 negative states · 0 duplicate requisitions
