// edge/features/F01-iot-simulator/index.js
//
// F01 · IoT telemetry simulator
//
// Security & data classification (see org IoT security standard, org security-standard
// memory, and F01 design doc "Security & data classification"):
//   - Simulated readings are treated as Class C2 (Confidential) telemetry, identical in
//     classification to real raw telemetry, and never leave this edge process (no I/O,
//     no network, no persistence — ADR-001).
//   - This module is strictly read-only toward OT: it only synthesizes data in memory and
//     never opens any connection to a gateway, PLC or OT network (IEC 62443 posture).
//   - Per OWASP IoT I5 (telemetry is untrusted input, applied here even to synthetic data):
//     `inject`/`clear` validate asset ids and fault applicability before mutating state,
//     and every emitted metric value is checked to be finite before being returned.
//   - No operator/technician identifiers are ever included in a Reading (asset id only).
//
// Exports: createSimulator (AC-F01-1..5)

import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

/** Deterministic mulberry32 PRNG (AC-F01-2: same seed -> same stream). */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform drawing from the supplied rng. */
function gaussianRaw(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Healthy gaussian sample clamped to +/- 4.5 sigma (AC-F01-3). */
function gaussianClamped(rng, mu, sigma) {
  const z = gaussianRaw(rng);
  const clampedZ = Math.max(-4.5, Math.min(4.5, z));
  return mu + clampedZ * sigma;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function validateAsset(assets, assetId) {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`F01: unknown asset "${assetId}"`);
  return asset;
}

function validateFault(asset, fault) {
  const def = FAULTS[fault];
  if (!def) throw new Error(`F01: unknown fault "${fault}"`);
  if (!def.appliesTo.includes(asset.type)) {
    throw new Error(`F01: fault "${fault}" does not apply to asset type "${asset.type}"`);
  }
  return def;
}

/**
 * Progressive degradation of a single metric under an active fault
 * (AC-F01-4): monotonic drift scaled by elapsed ticks since injection.
 */
function applyFaultDrift(rng, mean, sigma, def, metric, elapsedTicks) {
  const fraction = def.effects?.[metric];
  const jitterMult = def.jitter?.[metric] ?? 1;
  const driftedMean = fraction != null ? mean * (1 + fraction * elapsedTicks) : mean;
  const noise = gaussianRaw(rng) * sigma * jitterMult;
  return driftedMean + noise;
}

export function createSimulator(opts = {}) {
  const { seed, assets: assetsOpt, startTs, stepMs = 1000 } = opts;
  if (typeof seed !== 'number') throw new Error('F01: createSimulator requires a numeric seed');

  const assets = Object.freeze((assetsOpt ?? FLEET).map((a) => ({ ...a })));
  const rng = makeRng(seed);
  const clock = { ts: startTs ?? Date.now() };
  /** Map<assetId, { fault: string, startedTick: number }> */
  const faults = new Map();
  let tickCount = 0;

  function tick() {
    tickCount += 1;
    const ts = new Date(clock.ts).toISOString();
    clock.ts += stepMs;

    const readings = [];
    for (const asset of assets) {
      const nominal = ASSET_TYPES[asset.type].nominal;
      const activeFault = faults.get(asset.id);
      const def = activeFault ? FAULTS[activeFault.fault] : null;
      const elapsed = activeFault ? tickCount - activeFault.startedTick : 0;

      const metrics = {};
      for (const [metric, [mean, sigma]] of Object.entries(nominal)) {
        let value;
        if (def && def.effects && metric in def.effects) {
          value = applyFaultDrift(rng, mean, sigma, def, metric, elapsed);
        } else {
          value = gaussianClamped(rng, mean, sigma);
        }
        if (!Number.isFinite(value)) {
          throw new Error(`F01: non-finite value generated for ${asset.id}.${metric}`);
        }
        metrics[metric] = round3(value);
      }

      readings.push({
        ts,
        assetId: asset.id,
        type: asset.type,
        metrics,
        fault: activeFault ? activeFault.fault : null,
      });
    }
    return readings;
  }

  function inject(assetId, fault) {
    const asset = validateAsset(assets, assetId);
    validateFault(asset, fault);
    faults.set(assetId, { fault, startedTick: tickCount });
  }

  function clear(assetId) {
    validateAsset(assets, assetId);
    faults.delete(assetId);
  }

  function activeFaults() {
    const out = {};
    for (const [assetId, { fault }] of faults.entries()) out[assetId] = fault;
    return out;
  }

  return { tick, inject, clear, activeFaults, assets };
}
