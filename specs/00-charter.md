# Charter — Edge Asset Intelligence

## Vision
Plant reliability teams see equipment degrading **before** it trips, and the paperwork —
work orders, corrective action reports, parts reservations — happens by itself.

## Users
- **Reliability engineer** — needs early warning and root cause.
- **Maintenance planner** — needs correctly-prioritised, de-duplicated work orders with parts.
- **MRO / stores** — needs to know which spares will be consumed and when to reorder.
- **Developers** — need to ask the fleet questions in plain language while building.

## Outcomes (and how we measure them)
| Outcome | Metric | Target |
|---|---|---|
| Earlier detection | ticks from fault onset to first anomaly | ≤ 30 |
| Fewer false alarms | false-positive rate on healthy fleet | < 1 % |
| No manual WO entry | anomalies ≥ medium that raise or update a WO | 100 % |
| No stock-outs surprise | WOs whose parts shortfall is visible at creation | 100 % |
| Self-serve insight | golden NL questions answered correctly | 100 % |

## How the team builds it
Ten people, each paired with an agent (see `agents/roster.json`). All agents share one
Meko datapack, **iot-edge-adlc**: architecture decisions, standards, domain knowledge and
lessons learnt are written once and recalled by whoever needs them. The programme goal
is to prove that shared memory **cuts LLM tokens per shipped feature** while every change
still passes the same guardrails and evals.
