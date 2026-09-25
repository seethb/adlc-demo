# F01 test report

Run f01-mugtcd6t · 25 Sept 2026, 15:55:24 IST

| | Acceptance criterion | Result |
|---|---|---|
| ✅ | AC-F01-1 | every tick emits one reading per asset with all nominal metrics |
| ✅ | AC-F01-2 | the same seed reproduces the same stream |
| ✅ | AC-F01-3 | healthy readings stay within 4σ of nominal |
| ✅ | AC-F01-4 | an injected fault degrades its signature metrics and is labelled |
| ✅ | AC-F01-5 | rejects unknown assets and faults that do not apply |

**Behavioural eval:** 9400 samples, 0 outside the 4.5σ band
