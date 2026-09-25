# F05 test report

Run f05-mugr6vsw · 2026-09-25T09:26:19.979Z

| | Acceptance criterion | Result |
|---|---|---|
| ✅ | AC-F05-1 | reservations never drive availability negative; shortfall is reported |
| ✅ | AC-F05-2 | release returns stock; consume reduces on-hand |
| ❌ | AC-F05-3 | one open requisition per SKU when at or below reorder point |
| ❌ | AC-F05-4 | receiving a requisition restocks and closes it |
| ✅ | AC-F05-5 | unknown SKUs throw |

**Behavioural eval:** 500 random operations · 0 negative states · 0 duplicate requisitions
