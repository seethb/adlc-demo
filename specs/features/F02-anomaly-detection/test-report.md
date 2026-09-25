# F02 test report

Run f02-mugscbf0 · 2026-09-25T10:02:16.086Z

| | Acceptance criterion | Result |
|---|---|---|
| ✅ | AC-F02-1 | no anomalies on a healthy fleet after warm-up (false-positive rate < 1%) |
| ✅ | AC-F02-2 | ISO 10816 zones: A ≤ 2.8 < B ≤ 4.5 < C ≤ 7.1 < D |
| ❌ | AC-F02-3 | each injected fault is detected on the right asset within 30 ticks |
| ❌ | AC-F02-4 | anomalies carry a failure mode matching the injected fault |
| ❌ | AC-F02-5 | anomaly shape and severity escalate with degradation |
| ❌ | AC-F02-6 | non-finite telemetry is rejected and does not corrupt baselines |

**Behavioural eval:** precision 0.00 · recall 0.00 over 6 faults
