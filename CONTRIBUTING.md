# Working in this repo — a team of 10 people and 10 agents

Every team member owns one agent. You steer it and approve its work; the agent does the
repetitive parts. Everyone's agent shares **one Meko datapack, `iot-edge-adlc`**, so what one
agent decides, every other agent can recall without re-reading the whole repo.

| Team member | Agent | Stage / scope | What you approve |
|---|---|---|---|
| TM-01 · Product owner | **Atlas** | Plan · `specs/features/*/plan.md` | Stories and AC traceability |
| TM-02 · Architect | **Vega** | Design · `specs/features/*/design.md` | Contracts, data shapes, ADRs |
| TM-03 · IoT engineer | **Orion** | Develop F01 · `edge/features/F01-*` | Simulator |
| TM-04 · Data scientist | **Lyra** | Develop F02 · `edge/features/F02-*` | Anomaly detection |
| TM-05 · Reliability engineer | **Nova** | Develop F03, F04 · `edge/features/F03-*`, `F04-*` | Work orders, CARs |
| TM-06 · MRO planner | **Rigel** | Develop F05 · `edge/features/F05-*` | Inventory |
| TM-07 · NLP engineer | **Sage** | Develop F06 · `edge/features/F06-*` | NL asset queries |
| TM-08 · QA lead | **Quill** | Test · owns `*.acceptance.test.js` | Test gate, evals |
| TM-09 · AppSec engineer | **Sentinel** | Review | Security review, guardrails |
| TM-10 · Platform engineer | **Helm** | Deploy | Release to `edge-staging` |

## The loop
1. **Spec first.** Change a spec in `specs/features/` in its own PR. The spec's ACs are the contract.
2. **Run the feature** from ADLC Studio (`npm run dev` → Pipeline → ▶). The agents go through Plan → Design →
   Develop → Test → Review → Deploy on the branch `adlc/<feature>-<run>`, with **one PR per feature**.
3. **Gates.** Each stage posts a commit status (`adlc/spec` … `adlc/release`) and a gate report comment:
   guardrails, evals, the Meko memories recalled and the tokens saved.
4. **Release.** Helm waits for the feature owner or the release manager to approve in Studio, then squash-merges
   and records a GitHub deployment to `edge-staging`.
5. **CI** (`.github/workflows/ci.yml`) independently re-runs spec lint, acceptance tests, guardrail tests,
   behavioural evals, the secret scan and the edge-security scan on every PR.

## Rules every agent (and person) follows
- Acceptance tests are immutable except by the QA lead (`tests-immutable`).
- Agents write only inside their scope (`path-scope`).
- Edge code: no npm dependencies, no I/O, no `eval`, no plaintext transport, read-only towards OT.
- Never put secrets or C3-classified data in code, PRs, prompts or Meko (`secret-scan`). See `specs/02-design/security.md`.
- Put durable decisions in Meko as short, self-contained sentences — they are how the team saves tokens.

## Privacy — non-negotiable
No PII or private data (names, emails, phones, national ids, card numbers, addresses, IPs, health or
salary data) ever goes to Claude, Meko or GitHub. Team members are pseudonymous ids with roles. The
privacy shield redacts every outbound payload, and the `pii-scan` guardrail blocks any artifact,
decision or PR text that contains PII. See `specs/02-design/security.md` §6.

## Adding knowledge for all agents
Studio → **Meko** → *Add team memory*, or add a document to `server/seed/knowledge.js` and run `npm run setup`
(it uploads only new or changed documents).
