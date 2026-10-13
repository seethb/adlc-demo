# F05 test report

Run f05-mv6oq8ac · 13 Oct 2026, 18:28:46 IST

| | Acceptance criterion | Result |
|---|---|---|
| ✅ | AC-F05-1 | reservations never drive availability negative; shortfall is reported |
| ✅ | AC-F05-2 | release returns stock; consume reduces on-hand |
| ✅ | AC-F05-3 | one open requisition per SKU when at or below reorder point |
| ✅ | AC-F05-4 | receiving a requisition restocks and closes it |
| ✅ | AC-F05-5 | unknown SKUs throw |

**Behavioural eval:** eval crashed: F05-inventory: unknown reservation ref "WO-7"
