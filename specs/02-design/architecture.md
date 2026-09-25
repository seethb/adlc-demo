# Architecture

```
┌──────────── Edge gateway (per line) ────────────┐        ┌──────── ADLC Studio ────────┐
│ F01 simulator → F02 detector → F03 WO service   │        │ React UI  ⇄  Node API (SSE)  │
│                       │            │    ↕       │        │   ├─ orchestrator (6 gates)  │
│                       └→ F04 CAR   └→ F05 inv.  │        │   ├─ guardrails / evals      │
│ F06 query planner ← fleet snapshot              │        │   ├─ Meko MCP client         │
└──────────────────────────────────────────────────┘        │   ├─ GitHub REST client      │
                                                            │   └─ Claude (Messages API)   │
                                                            └──────────────────────────────┘
```

## Event contracts
- **Reading** — `{ ts, assetId, type, metrics, fault }` (F01)
- **Anomaly** — `{ id, ts, assetId, assetType, severity, score, rule, failureMode, confidence, metrics[] }` (F02)
- **WorkOrder** — `{ id, assetId, failureMode, priority, status, tasks[], parts[], occurrences }` (F03)
- **CAR** — `{ id, assetId, failureMode, trigger, workOrders[], d2…d7 }` (F04)
- **Reservation** — `{ sku, qty, ref }`; **Requisition** — `{ id, sku, qty, status }` (F05)

## ADRs
- **ADR-001** Edge modules are pure ES modules with no I/O; transport is injected. Keeps them testable and safe to hot-load.
- **ADR-002** Only `node:` built-ins and `edge/reference/fleet.js` may be imported by edge modules.
- **ADR-003** Detection baselines freeze their spread after warm-up so slow degradation is not learnt as normal.
- **ADR-004** Severity scale is `low < medium < high < critical`; priority mapping is critical→P1, high→P2, medium→P3.
- **ADR-005** Agents share one Meko datapack. Each agent writes under `adlc:<agent>`; the org standards bucket is `adlc:org`. Decisions are small, atomic memories with `{feature, stage, kind}` metadata.
- **ADR-006** Stage artifacts are stored in Meko by content hash and referenced by a memory; a re-run whose spec hash is unchanged reuses the artifact instead of calling the LLM.
