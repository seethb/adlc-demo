# Specs — the source of truth

This repository is **spec-driven**. Nothing is built that is not traced to a spec, and
nothing merges until the spec's acceptance criteria pass.

```
00-charter.md            why we are building this, who for, success metrics
01-plan/roadmap.md       epics, milestones, owners, sequencing
02-design/architecture.md system design, event contracts, ADRs
features/Fxx-*.spec.md   one spec per feature: contract + acceptance criteria (AC-Fxx-n)
features/Fxx-*.acceptance.test.js   executable ACs — immutable to feature agents
features/Fxx-*/plan.md   written by Atlas at the Plan stage
features/Fxx-*/design.md written by Vega at the Design stage
agents/roster.json       the 10 agents, their human owners, scopes, guardrails, evals
gates/gates.json         the six stage gates and what each one checks
```

## Lifecycle

| Stage | Agent | Output | Gate | GitHub status |
|---|---|---|---|---|
| Plan | Atlas | `features/Fxx/plan.md` | G1 spec gate | `adlc/spec` |
| Design | Vega | `features/Fxx/design.md` | G2 design gate | `adlc/design` |
| Develop | feature agent | `edge/features/Fxx/index.js` | G3 build gate | `adlc/build` |
| Test | Quill | acceptance + behavioural eval report | G4 test gate | `adlc/test` |
| Review | Sentinel | PR review + LLM-judge score | G5 review gate | `adlc/review` |
| Deploy | Helm | merge + `edge-staging` deployment | G6 release gate (human approval) | `adlc/release` |

Every stage commits to the feature branch `adlc/<Fxx-slug>-<run>` and comments on
that feature's single PR, so the PR is the full audit trail.

## Traceability rules
1. AC ids (`AC-F02-3`) are stable. A plan, design and implementation cite the ACs they cover.
2. A spec change is its own PR, reviewed by the owner agent's human.
3. Acceptance tests can only be changed by the QA lead (Quill's owner) — `tests-immutable`.
