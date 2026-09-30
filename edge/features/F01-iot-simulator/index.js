// F01 · IoT telemetry simulator
//
// SECURITY / DATA CLASSIFICATION (per org IoT security standard, IEC 62443, OWASP IoT I5):
//   - Output readings are C2 Confidential telemetry, edge-resident only. This module
//     performs no I/O, no network egress, and no cloud/OT communication of any kind.
//   - Read-only towards OT: this module never writes to, commands, or actuates any
//     device, PLC register, coil or OPC-UA node — it only synthesizes sensor readings
//     for downstream consumers (analytics, maintenance, query features).
//   - Telemetry is treated as untrusted input even when synthetic: all numeric output
//     is checked for finiteness before being returned; unknown asset ids and faults
//     that do not apply to an asset's type are rejected (thrown) rather than silently
//     accepted, per the org IoT security standard (reject non-finite/garbage values,
//     reject unknown identifiers).
//
// Pure ES module. No npm dependencies. No process.env. No eval. No child_process.
// Clock and RNG are fully deterministic and injected via `seed`/`startTs` (ADR-001).

import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

// --- internal helpers -------------------------------------------------------

// mulberry32 deterministic PRNG — AC-F01-2 (same seed ⇒ same stream)
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform, optionally clamped to `clampSigma` * sigma from mean.
// AC-F01-3: healthy readings stay within 4.5 sigma of nominal.
function gaussian(rng, mean, sigma, clampSigma = Infinity) {
  let u1 = rng();
  let u2 = rng();
  if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  let value = mean + z * sigma;

  // Untrusted-input hygiene (IoT security standard): guard against non-finite
  // PRNG edge cases before they ever leave this module.
  if (!Number.isFinite(value)) value = mean;

  if (Number.isFinite(clampSigma)) {
    const lo = mean - clampSigma * sigma;
    const hi = mean + clampSigma * sigma;
    if (value < lo) value = lo;
    if (value > hi) value = hi;
  }
  return value;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// Monotonic drift curve for a signature metric under an active fault.
// `effect` is a per-tick fractional drift (positive = grows, negative = decays
// toward zero); compounding keeps the curve monotonic without overshoot.
function degrade(mean, effect, elapsedTicks) {
  const factor = Math.pow(1 + effect, elapsedTicks);
  return mean * factor;
}

// --- factory -----------------------------------------------------------------

export function createSimulator({ seed, assets, startTs, stepMs = 1000 } = {}) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new RangeError('createSimulator requires a finite numeric seed');
  }

  const resolvedAssets = assets ?? FLEET;
  const assetIndex = new Map(resolvedAssets.map(a => [a.id, a]));

  const rng = makeRng(seed);
  let clock = startTs ? Date.parse(startTs) : Date.parse('2024-01-01T00:00:00.000Z');
  if (Number.isNaN(clock)) {
    throw new RangeError(`invalid startTs: ${startTs}`);
  }

  let tickCount = 0;
  // faultState: assetId -> { fault, since }  (since = tickCount at injection)
  const faultState = new Map();

  function validateAsset(assetId) {
    const a = assetIndex.get(assetId);
    if (!a) {
      throw new RangeError(`unknown asset: ${assetId}`);
    }
    return a;
  }

  function validateFault(assetId, fault) {
    const a = validateAsset(assetId);
    const def = FAULTS[fault];
    if (!def) {
      throw new RangeError(`unknown fault: ${fault}`);
    }
    if (!def.appliesTo.includes(a.type)) {
      throw new RangeError(`fault ${fault} does not apply to asset type ${a.type}`);
    }
    return def;
  }

  function inject(assetId, fault) {
    validateFault(assetId, fault);
    faultState.set(assetId, { fault, since: tickCount });
  }

  function clear(assetId) {
    validateAsset(assetId);
    faultState.delete(assetId);
  }

  function activeFaults() {
    const out = {};
    for (const a of resolvedAssets) {
      out[a.id] = faultState.has(a.id) ? faultState.get(a.id).fault : null;
    }
    return out;
  }

  function tick() {
    const ts = new Date(clock).toISOString();
    const readings = [];

    for (const asset of resolvedAssets) {
      const nominal = ASSET_TYPES[asset.type].nominal;
      const active = faultState.get(asset.id);
      const faultDef = active ? FAULTS[active.fault] : null;
      const elapsed = active ? Math.max(0, tickCount - active.since) : 0;

      const metrics = {};
      for (const [metricName, [mean, sigma]] of Object.entries(nominal)) {
        let value;
        if (faultDef && Object.prototype.hasOwnProperty.call(faultDef.effects, metricName)) {
          const effect = faultDef.effects[metricName];
          const degradedMean = degrade(mean, effect, elapsed);
          const jitterMult = faultDef.jitter?.[metricName] ?? 1;
          value = gaussian(rng, degradedMean, sigma * jitterMult, Infinity);
        } else {
          // AC-F01-3: healthy metrics clamped to +/-4.5 sigma of nominal.
          value = gaussian(rng, mean, sigma, 4.5);
        }

        if (!Number.isFinite(value)) {
          // Untrusted-input hygiene: never emit non-finite telemetry.
          value = mean;
        }
        metrics[metricName] = round3(value);
      }

      readings.push({
        ts,
        assetId: asset.id,
        type: asset.type,
        metrics,
        fault: active ? active.fault : null,
      });
    }

    tickCount += 1;
    clock += stepMs;
    return readings;
  }

  return {
    tick,
    inject,
    clear,
    activeFaults,
    assets: resolvedAssets,
  };
}
