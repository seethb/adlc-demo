# F04 · Corrective Action Reports (CAR) — Plan

## Summary
`createCarService()` evaluates work orders from F03 and automatically opens 8D-style CARs for critical (P1) or recurring failures, at most one per asset + failure mode, so reliability engineering gets consistent root-cause tracking without manual triage.

## User stories
- As a reliability engineer, I want any P1 work order to open a CAR immediately, so that critical failures are root-caused without delay. (AC-F04-1)
- As a reliability engineer, I want recurring failures on the same asset + failure mode to open a CAR automatically, so that patterns aren't missed. (AC-F04-2)
- As a reliability engineer, I want only one active CAR per asset + failure mode, so that I don't triage duplicate reports. (AC-F04-3)
- As a reliability engineer, I want each CAR to have a stable id and all 8D fields pre-filled, so that I can act on it without re-gathering context. (AC-F04-4)

## Acceptance criteria traceability
| AC id | Description | Covered by |
|---|---|---|
| AC-F04-1 | P1 WO → CAR trigger `critical-failure` | `evaluate()` critical-failure rule |
| AC-F04-2 | ≥2 WOs, or 1 WO ×≥3 occurrences, same asset+failure mode → trigger `recurrence`; single P2 does not | `evaluate()` recurrence rule |
| AC-F04-3 | ≤1 CAR per asset+failure mode | dedup key check before create |
| AC-F04-4 | CAR id `CAR-nnn`, all 8D fields filled | CAR factory / id sequencer |

## Contract
`createCarService()` → `{ evaluate(workOrders): CAR[] /* newly created */, list(): CAR[] }`.
CAR shape: `{ id: "CAR-nnn", asset, failureMode, trigger: "critical-failure"|"recurrence", d1..d7 }`, all D1–D7 fields non-empty. No operator/technician names anywhere — only pseudonymous ids and asset ids, per org PII standard.

## Dependencies
F03 (work orders, priorities, failure modes) is the sole input source.

## Non-goals
CAR approval workflow; supplier CARs.

## Risks
Root-cause (D4) and preventive (D7) text must be sourced from the reliability knowledge base / failure-mode handbook, never invented by the model. Recurrence counting logic must correctly distinguish "≥2 WOs" vs "1 WO ×≥3 occurrences" to avoid false positives (e.g. a single P2).

## Telemetry & evals
Behavioural eval: replay with one critical and one recurring fault must open exactly two CARs, each with correct trigger and all 8D fields non-empty. All timestamps ISO-8601 UTC.

## Definition of done
All four ACs pass under QA's immutable acceptance tests; `evaluate()` is idempotent (re-running on same WOs doesn't create duplicate CARs, satisfying AC-F04-3); every function implementing an AC carries a `// AC-F04-n` comment; no PII/operator names present in CAR output.
