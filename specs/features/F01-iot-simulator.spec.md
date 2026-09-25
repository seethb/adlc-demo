---
id: F01
slug: F01-iot-simulator
title: IoT telemetry simulator
owner: orion
priority: must
depends: []
module: edge/features/F01-iot-simulator/index.js
reference: edge/reference/simulator.js
exports: createSimulator
---

# F01 · IoT telemetry simulator

## Problem
The analytics, maintenance and query features need a realistic, repeatable stream of
telemetry from rotating equipment before any real plant is connected. Edge gateways
publish one reading per asset per second.

## Scope
- The eight assets in `edge/reference/fleet.js` (motors, centrifugal pumps, drive shafts,
  a centrifugal compressor and a gearbox) with the nominal metrics defined there.
- Injectable fault scenarios: bearing wear, winding overheat, cavitation, misalignment,
  imbalance, compressor surge, lubrication breakdown.

**Non-goals:** a physics model; MQTT or OPC-UA transport (the edge bus is out of scope).

## Contract
`createSimulator({ seed, assets?, startTs?, stepMs? })` returns
`{ tick(): Reading[], inject(assetId, fault), clear(assetId), activeFaults(), assets }`.

```
Reading = { ts: ISO-8601, assetId, type, metrics: { [metric]: number }, fault: string|null }
```

## Acceptance criteria
- **AC-F01-1** Every `tick()` emits exactly one reading per asset, carrying every nominal metric for its type; `fault` is `null` when healthy.
- **AC-F01-2** The same seed reproduces an identical stream.
- **AC-F01-3** Healthy readings stay within 4.5 σ of nominal.
- **AC-F01-4** An injected fault progressively degrades its signature metrics and labels readings with the fault; `clear` restores health.
- **AC-F01-5** Unknown assets, and faults that do not apply to the asset type, throw.

## Telemetry & evals
Behavioural eval: a 200-tick replay stays within the 4.5 σ band on every metric.

## Risks
Noise too low makes detection trivial; too high creates false positives. σ values are
owned by the reliability team (see Meko memory "nominal operating bands").
