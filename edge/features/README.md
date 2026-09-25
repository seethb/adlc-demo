# Agent-built edge modules

Each folder here is written by a feature agent through the ADLC pipeline and lands on
`main` only after all six gates pass and a human approves the release. The acceptance
suites in `specs/features/` run against these modules and against `edge/reference/`.
