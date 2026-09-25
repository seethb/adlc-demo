# F03 test report

Run f03-muguqkgf · 25 Sept 2026, 16:38:01 IST

| | Acceptance criterion | Result |
|---|---|---|
| ✅ | AC-F03-1 | severity maps to priority; low severity raises no WO |
| ✅ | AC-F03-2 | one open WO per asset + failure mode; repeats are deduplicated |
| ✅ | AC-F03-3 | WO carries playbook tasks and reserves parts in inventory |
| ❌ | AC-F03-4 | closing a WO consumes its reserved parts; a new WO can then open |

**Behavioural eval:** 6 WO(s) for 4 faulted assets · 0 duplicates · 0 stray
