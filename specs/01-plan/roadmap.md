# Roadmap

| Sprint | Feature | Owner agent | Human owner | Depends on |
|---|---|---|---|---|
| 1 | F01 IoT telemetry simulator | Orion | Elena | — |
| 1 | F05 Spare-parts inventory | Rigel | Sofia | — |
| 1 | F02 Streaming anomaly detection | Lyra | Kenji | F01 |
| 2 | F03 Automated work orders | Nova | Amara | F02, F05 |
| 2 | F04 Corrective Action Reports | Nova | Amara | F03 |
| 2 | F06 Natural-language asset queries | Sage | Liam | F02, F03, F05 |

Cross-cutting agents: Atlas (plan, Priya), Vega (design, Marcus), Quill (test, Noor),
Sentinel (review, Theo), Helm (deploy, Grace).

## Definition of done
All six gates green on the feature PR, human approval recorded, PR merged, and a
successful `edge-staging` deployment on GitHub.

## Sequencing rationale
F01 and F05 have no dependencies and unblock everything else. F02 needs F01's reading
shape; F03 needs F02's anomaly shape and F05's reservation API. Those shapes are written
to Meko as decisions by Vega, so downstream agents recall them instead of re-reading
upstream specs.
