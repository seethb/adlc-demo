# adlc-demo — Agentic Development Lifecycle with shared Meko memory

A **spec-driven** build of an **IoT edge analytics** product by a team of **10 people, each paired
with an AI agent**. All agents share one **Meko** datapack for memory and knowledge. Each feature
goes through **Plan → Design → Develop → Test → Review → Deploy**, and every stage is gated by
guardrails and evals and is visible live on **GitHub**.

**The key objective:** show how much LLM token cost Meko saves when agents recall each other's
decisions and the team's knowledge, compared with each agent re-reading the whole project.

## The product: Edge Asset Intelligence
| Feature | What it does | Agent |
|---|---|---|
| F01 IoT simulator | 1 Hz telemetry from motors, centrifugal pumps, drive shafts, a centrifugal compressor and a gearbox, with injectable faults | Orion |
| F02 Anomaly detection | Baseline z-score plus ISO 10816 and OEM limits; classifies the failure mode; rejects tampered telemetry | Lyra |
| F03 Work orders (WO) | Auto-raises de-duplicated, prioritised WOs with playbook tasks and reserved parts | Nova |
| F04 Corrective Action Reports (CAR) | 8D CARs on critical or recurring failures | Nova |
| F05 Inventory | Reservations, consumption, automatic purchase requisitions | Rigel |
| F06 NL asset queries | "How is motor MTR-101 performing?" — answered from live data plus Meko knowledge | Sage |

## ADLC Studio (React + Node)
- **Mission Control** — live KPIs: tokens and dollars saved, memory reuse, gates, deployments.
- **Pipeline** — the six gated stages for every feature: guardrails, evals, recalled memories, artifacts, GitHub links, human approval.
- **Agents** — the 10 agents, their owners, scopes, guardrails, and a graph of who reused whose memories.
- **Meko** — the live datapack: memories, knowledge, semantic search, and every MCP call on the wire.
- **GitHub** — live branches, PRs, commit statuses, Actions runs and deployments for this repo.
- **Economics** — Meko against a memory-less baseline, per stage, per agent, over time.
- **Edge Ops** — the running product: fleet health, fault injection, anomalies, WOs, CARs, inventory, security events.
- **Ask the fleet** — natural-language queries, with token cost with and without Meko.

## How token savings are measured
For every agent step the Studio records:
- **Meko input tokens** — what was actually sent to Claude: the task, the feature spec, and the top-k memories and knowledge chunks recalled from Meko.
- **Baseline input tokens** — what an agent without shared memory must read to make the same decisions: all specs and design docs, the knowledge base, the standards wiki, and every upstream artifact. Measured exactly with Claude `count_tokens`, never sent.
- **Artifact reuse** — stage outputs are stored in Meko by content hash. A re-run with an unchanged spec reuses them and makes no LLM call.

## Security and privacy guardrails
- **PII never leaves the system.** A privacy shield (`server/security/privacy.js`) redacts personal data from every outbound payload to Claude, Meko and GitHub. The blocking `pii-scan` guardrail runs at every gate, and team members appear only as pseudonymous ids with roles (`TM-01 · Product owner`).
- **Secrets:** `secret-scan` covers code, PR text and Meko memories; keys live only in `.env` (gitignored).
- **IoT/OT:** edge code is read-only towards OT (`ot-write-prohibited`). Every cross-zone link is TLS with certificates (`plaintext-transport`). Telemetry is untrusted input (AC-F02-6).
- **Data classification (C0–C3), Edge/Cloud residency and transport crypto:** [`specs/02-design/security.md`](specs/02-design/security.md). This is also in Meko, where every agent recalls it.
- **Agent memory hygiene:** recalled memories are screened for prompt injection and provenance before they reach a prompt.

## Run it
```bash
cp .env.example .env      # Meko key, Anthropic key; GitHub falls back to `gh auth token`
npm install
npm run setup             # Meko datapack: knowledge base + team standards (idempotent)
npm run dev               # Studio on http://localhost:5173, API on :8787
npm test                  # acceptance suites + guardrail tests
```

Specs start in [`specs/README.md`](specs/README.md). Team workflow: [`CONTRIBUTING.md`](CONTRIBUTING.md).
Security and data classification: [`specs/02-design/security.md`](specs/02-design/security.md).
